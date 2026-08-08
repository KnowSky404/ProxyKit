/**
 * YouTube protobuf response adapter for Loon.
 *
 * The current release only handles YouTube Music responses.
 * Player, GetWatch, and Guide protocol fields are based on the Apache-2.0
 * YouTube implementation from Maasea/sgmodule. Processing is performed fully
 * inside Loon and does not call an upstream script or third-party Worker.
 *
 * Source reference:
 * https://github.com/Maasea/sgmodule/blob/master/Script/Youtube/youtube.response.js
 * SPDX-License-Identifier: Apache-2.0
 * License: ./LICENSE-APACHE-2.0
 * Notice: ./NOTICE
 */

(() => {
  "use strict";

  const GUIDE_CONTAINER_PATH = [4, 117866661];
  const RENDERER_ITEM_FIELD = 1;
  const WATCH_CONTENT_FIELD = 1;
  const WATCH_PLAYER_FIELD = 2;
  const PLAYER_PLAYABILITY_FIELD = 2;
  const PLAYER_AD_FIELDS = new Set([7, 68]);
  const PLAYER_TRACKING_FIELD = 9;
  const PAGE_AD_TRACKING_FIELD = 18;
  const PIP_RENDERER_FIELD = 21;
  const BACKGROUND_RENDERER_FIELD = 11;
  const PIP_ABILITY_FIELD = 151635310;
  const BACKGROUND_ABILITY_FIELD = 64657230;

  const params = {
    blockImmersive: getBooleanArgument("blockImmersive", true),
    blockUpgrade: getBooleanArgument("blockUpgrade", true),
    debug: getBooleanArgument("debug", false),
  };

  function getArgument(name, fallback) {
    if (
      typeof $argument === "object" &&
      $argument !== null &&
      $argument[name] !== undefined
    ) {
      return $argument[name];
    }
    return fallback;
  }

  function getBooleanArgument(name, fallback) {
    const value = getArgument(name, fallback);
    return typeof value === "string"
      ? value.toLowerCase() === "true"
      : Boolean(value);
  }

  function findHeader(headers, name) {
    const wanted = name.toLowerCase();
    for (const key of Object.keys(headers || {})) {
      if (key.toLowerCase() === wanted) {
        return headers[key];
      }
    }
    return "";
  }

  function isYouTubeMusic() {
    return String(findHeader($request.headers, "user-agent"))
      .toLowerCase()
      .includes("music");
  }

  function debug(message) {
    if (params.debug) {
      console.log(`[YouTube Response] ${message}`);
    }
  }

  function toUint8Array(value) {
    if (value instanceof Uint8Array) {
      return value;
    }
    if (value instanceof ArrayBuffer) {
      return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    return null;
  }

  function readVarint(bytes, start) {
    let offset = start;
    let value = 0;
    let multiplier = 1;
    for (let count = 0; count < 10; count += 1) {
      if (offset >= bytes.length) {
        throw new Error("unexpected end of protobuf varint");
      }
      const byte = bytes[offset];
      offset += 1;
      value += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) {
        if (!Number.isSafeInteger(value)) {
          throw new Error("protobuf varint exceeds the safe integer range");
        }
        return { value, offset };
      }
      multiplier *= 128;
    }
    throw new Error("invalid protobuf varint");
  }

  function encodeVarint(value) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("invalid protobuf varint value");
    }
    const result = [];
    let remaining = value;
    while (remaining > 0x7f) {
      result.push((remaining % 128) | 0x80);
      remaining = Math.floor(remaining / 128);
    }
    result.push(remaining);
    return new Uint8Array(result);
  }

  function concatenate(parts) {
    const length = parts.reduce((total, part) => total + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  }

  function encodeLengthDelimited(fieldNumber, payload) {
    return concatenate([
      encodeVarint(fieldNumber * 8 + 2),
      encodeVarint(payload.length),
      payload,
    ]);
  }

  function encodeLengthDelimitedField(field, payload) {
    return concatenate([field.tag, encodeVarint(payload.length), payload]);
  }

  function parseFields(bytes) {
    const fields = [];
    let offset = 0;
    while (offset < bytes.length) {
      const start = offset;
      const tag = readVarint(bytes, offset);
      offset = tag.offset;
      const tagEnd = offset;
      const fieldNumber = Math.floor(tag.value / 8);
      const wireType = tag.value % 8;
      if (fieldNumber <= 0) {
        throw new Error("invalid protobuf field number");
      }

      let payload = null;
      if (wireType === 0) {
        offset = readVarint(bytes, offset).offset;
      } else if (wireType === 1) {
        offset += 8;
      } else if (wireType === 2) {
        const length = readVarint(bytes, offset);
        offset = length.offset;
        const end = offset + length.value;
        if (end > bytes.length) {
          throw new Error("invalid protobuf field length");
        }
        payload = bytes.subarray(offset, end);
        offset = end;
      } else if (wireType === 5) {
        offset += 4;
      } else {
        throw new Error(`unsupported protobuf wire type: ${wireType}`);
      }
      if (offset > bytes.length) {
        throw new Error("protobuf field exceeds response body");
      }
      fields.push({
        fieldNumber,
        wireType,
        payload,
        tag: bytes.subarray(start, tagEnd),
        raw: bytes.subarray(start, offset),
      });
    }
    return fields;
  }

  function rewriteMessage(bytes, rewriteField, appendedFields = []) {
    const parts = [];
    let changed = false;
    for (const field of parseFields(bytes)) {
      const rewritten = rewriteField(field);
      if (rewritten === null) {
        changed = true;
      } else if (rewritten instanceof Uint8Array) {
        parts.push(rewritten);
        changed = changed || rewritten !== field.raw;
      } else {
        parts.push(field.raw);
      }
    }
    if (appendedFields.length) {
      parts.push(...appendedFields);
      changed = true;
    }
    return { body: changed ? concatenate(parts) : bytes, changed };
  }

  function rewritePlaybackTracking(bytes) {
    return rewriteMessage(bytes, (field) =>
      field.fieldNumber === PAGE_AD_TRACKING_FIELD ? null : undefined,
    );
  }

  function pictureInPictureRenderer() {
    const ability = concatenate([
      encodeVarint(1 * 8),
      encodeVarint(1),
      encodeVarint(8 * 8),
      encodeVarint(1),
    ]);
    return encodeLengthDelimited(
      PIP_RENDERER_FIELD,
      encodeLengthDelimited(PIP_ABILITY_FIELD, ability),
    );
  }

  function backgroundRenderer() {
    const ability = concatenate([encodeVarint(1 * 8), encodeVarint(1)]);
    return encodeLengthDelimited(
      BACKGROUND_RENDERER_FIELD,
      encodeLengthDelimited(BACKGROUND_ABILITY_FIELD, ability),
    );
  }

  function rewritePlayability(bytes) {
    const appended = [pictureInPictureRenderer(), backgroundRenderer()];
    return rewriteMessage(
      bytes,
      (field) => {
        if (field.fieldNumber === PIP_RENDERER_FIELD) {
          return null;
        }
        if (field.fieldNumber === BACKGROUND_RENDERER_FIELD) {
          return null;
        }
        return undefined;
      },
      appended,
    );
  }

  function rewritePlayer(bytes) {
    let sawPlayability = false;
    const appended = [];
    const rewritten = rewriteMessage(bytes, (field) => {
      if (PLAYER_AD_FIELDS.has(field.fieldNumber)) {
        return null;
      }
      if (
        field.fieldNumber === PLAYER_PLAYABILITY_FIELD &&
        field.wireType === 2
      ) {
        sawPlayability = true;
        const result = rewritePlayability(field.payload);
        return result.changed
          ? encodeLengthDelimitedField(field, result.body)
          : undefined;
      }
      if (
        field.fieldNumber === PLAYER_TRACKING_FIELD &&
        field.wireType === 2
      ) {
        const result = rewritePlaybackTracking(field.payload);
        return result.changed
          ? encodeLengthDelimitedField(field, result.body)
          : undefined;
      }
      return undefined;
    });

    if (!sawPlayability) {
      const result = rewritePlayability(new Uint8Array(0));
      appended.push(encodeLengthDelimited(PLAYER_PLAYABILITY_FIELD, result.body));
    }
    if (!appended.length) {
      return rewritten;
    }
    return {
      body: concatenate([rewritten.body, ...appended]),
      changed: true,
    };
  }

  function rewriteWatchContent(bytes) {
    return rewriteMessage(bytes, (field) => {
      if (field.fieldNumber !== WATCH_PLAYER_FIELD || field.wireType !== 2) {
        return undefined;
      }
      const result = rewritePlayer(field.payload);
      return result.changed
        ? encodeLengthDelimitedField(field, result.body)
        : undefined;
    });
  }

  function rewriteWatch(bytes) {
    return rewriteMessage(bytes, (field) => {
      if (field.fieldNumber !== WATCH_CONTENT_FIELD || field.wireType !== 2) {
        return undefined;
      }
      const result = rewriteWatchContent(field.payload);
      return result.changed
        ? encodeLengthDelimitedField(field, result.body)
        : undefined;
    });
  }

  function encodeAscii(value) {
    const result = new Uint8Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
      result[index] = value.charCodeAt(index);
    }
    return result;
  }

  function includesBytes(haystack, needle) {
    if (!needle.length || needle.length > haystack.length) {
      return false;
    }
    outer: for (let index = 0; index <= haystack.length - needle.length; index += 1) {
      for (let offset = 0; offset < needle.length; offset += 1) {
        if (haystack[index + offset] !== needle[offset]) {
          continue outer;
        }
      }
      return true;
    }
    return false;
  }

  function menuTargets() {
    const targets = [];
    if (params.blockUpgrade) {
      targets.push(encodeAscii("SPunlimited"));
    }
    if (params.blockImmersive) {
      targets.push(encodeAscii("FEmusic_immersive"));
    }
    return targets;
  }

  function filterRendererItems(bytes, targets) {
    return rewriteMessage(bytes, (field) => {
      const remove =
        field.fieldNumber === RENDERER_ITEM_FIELD &&
        field.wireType === 2 &&
        targets.some((target) => includesBytes(field.payload, target));
      return remove ? null : undefined;
    });
  }

  function rewriteGuideAtPath(bytes, depth, targets) {
    return rewriteMessage(bytes, (field) => {
      if (
        field.fieldNumber !== GUIDE_CONTAINER_PATH[depth] ||
        field.wireType !== 2
      ) {
        return undefined;
      }
      const result =
        depth === GUIDE_CONTAINER_PATH.length - 1
          ? filterRendererItems(field.payload, targets)
          : rewriteGuideAtPath(field.payload, depth + 1, targets);
      return result.changed
        ? encodeLengthDelimitedField(field, result.body)
        : undefined;
    });
  }

  function rewriteGuide(bytes) {
    const targets = menuTargets();
    return targets.length
      ? rewriteGuideAtPath(bytes, 0, targets)
      : { body: bytes, changed: false };
  }

  try {
    const body = toUint8Array($response.body);
    if (!body || !isYouTubeMusic()) {
      $done({});
      return;
    }

    let result = { body, changed: false };
    if ($request.url.includes("get_watch")) {
      result = rewriteWatch(body);
    } else if ($request.url.includes("player")) {
      result = rewritePlayer(body);
    } else if ($request.url.includes("guide")) {
      result = rewriteGuide(body);
    }
    debug(result.changed ? "rewrote response locally" : "response unchanged");
    $done(result.changed ? { body: result.body } : {});
  } catch (error) {
    debug(`leaving response unchanged: ${String(error)}`);
    $done({});
  }
})();
