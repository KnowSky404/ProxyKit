/**
 * YouTube request adapter for Loon.
 *
 * Original logic: Maasea/sgmodule
 * Source: https://github.com/Maasea/sgmodule/blob/master/Script/Youtube/youtube.request.js
 * Loon adaptation: ProxyKit
 * Modified for Loon: 2026
 * SPDX-License-Identifier: Apache-2.0
 * License: ./LICENSE-APACHE-2.0
 * Notice: ./youtube.request.NOTICE
 *
 * Unlike the upstream Surge-oriented redirect, this adapter sends the
 * initplayback request to the Worker with Loon's $httpClient and relays the
 * binary response. This avoids cross-host $done({ url }) failures in Loon.
 */

(() => {
  "use strict";

  const STORAGE_KEY = "YouTubeConfig";
  const WORKER_URL = "https://init-stream.maasea.workers.dev/";
  const PLATFORM = {
    music: "youtubeMusic",
    video: "youtube",
  };

  const params = {
    captionLang: getArgument("captionLang", "off"),
    blockUpload: getBooleanArgument("blockUpload", true),
    blockImmersive: getBooleanArgument("blockImmersive", true),
    blockShorts: getBooleanArgument("blockShorts", false),
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
    if (typeof value === "string") {
      return value.toLowerCase() === "true";
    }
    return Boolean(value);
  }

  function debug(message) {
    if (params.debug) {
      console.log(`[YouTube Request] ${message}`);
    }
  }

  function cloneHeaders(headers) {
    return Object.assign({}, headers || {});
  }

  function findHeader(headers, name) {
    const wanted = name.toLowerCase();
    for (const key of Object.keys(headers || {})) {
      if (key.toLowerCase() === wanted) {
        return headers[key];
      }
    }
    return undefined;
  }

  function deleteHeader(headers, name) {
    const wanted = name.toLowerCase();
    for (const key of Object.keys(headers || {})) {
      if (key.toLowerCase() === wanted) {
        delete headers[key];
      }
    }
  }

  function readConfig() {
    try {
      const raw = $persistentStore.read(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (error) {
      debug(`failed to read cached config: ${String(error)}`);
      return {};
    }
  }

  function writeConfig(config) {
    return $persistentStore.write(JSON.stringify(config), STORAGE_KEY);
  }

  function getPlatformKey() {
    const userAgent = String(findHeader($request.headers, "user-agent") || "");
    return userAgent.toLowerCase().includes("music")
      ? PLATFORM.music
      : PLATFORM.video;
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

  function decodeBase64(value) {
    const alphabet =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    const lookup = Object.create(null);
    for (let index = 0; index < alphabet.length; index += 1) {
      lookup[alphabet[index]] = index;
    }
    lookup["-"] = lookup["+"];
    lookup["_"] = lookup["/"];

    const bytes = [];
    let buffer = 0;
    let bits = 0;
    for (const character of String(value)) {
      if (character === "=" || /\s/.test(character)) {
        continue;
      }
      const decoded = lookup[character];
      if (decoded === undefined) {
        throw new Error("invalid base64 string");
      }
      buffer = buffer * 64 + decoded;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push(Math.floor(buffer / 2 ** bits) & 0xff);
        buffer %= 2 ** bits;
      }
    }
    return new Uint8Array(bytes);
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
        return { value, offset };
      }
      multiplier *= 128;
    }
    throw new Error("invalid protobuf varint");
  }

  function readLengthDelimitedField(bytes, wantedField) {
    let offset = 0;
    while (offset < bytes.length) {
      const tag = readVarint(bytes, offset);
      offset = tag.offset;
      const fieldNumber = Math.floor(tag.value / 8);
      const wireType = tag.value % 8;

      if (wireType === 0) {
        offset = readVarint(bytes, offset).offset;
        continue;
      }
      if (wireType === 1) {
        offset += 8;
        continue;
      }
      if (wireType === 2) {
        const length = readVarint(bytes, offset);
        offset = length.offset;
        const end = offset + length.value;
        if (end > bytes.length) {
          throw new Error("invalid protobuf field length");
        }
        if (fieldNumber === wantedField) {
          return bytes.subarray(offset, end);
        }
        offset = end;
        continue;
      }
      if (wireType === 5) {
        offset += 4;
        continue;
      }
      throw new Error(`unsupported protobuf wire type: ${wireType}`);
    }
    return null;
  }

  function extractEncryptedClientKey(body) {
    const bodyBytes = toUint8Array(body);
    if (!bodyBytes) {
      return null;
    }
    const encryptedInnertubeRequest = readLengthDelimitedField(bodyBytes, 3);
    return encryptedInnertubeRequest
      ? readLengthDelimitedField(encryptedInnertubeRequest, 5)
      : null;
  }

  function bytesEqual(left, right) {
    if (!left || !right || left.length !== right.length) {
      return false;
    }
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        return false;
      }
    }
    return true;
  }

  function buildWorkerUrl(clientKey) {
    const query = [
      `ck=${encodeURIComponent(clientKey)}`,
      `target=${encodeURIComponent($request.url)}`,
      `captionLang=${encodeURIComponent(String(params.captionLang))}`,
      `blockUpload=${encodeURIComponent(String(params.blockUpload))}`,
      `blockImmersive=${encodeURIComponent(String(params.blockImmersive))}`,
      `blockShorts=${encodeURIComponent(String(params.blockShorts))}`,
    ];
    return `${WORKER_URL}?${query.join("&")}`;
  }

  function workerRequestHeaders() {
    const headers = cloneHeaders($request.headers);
    for (const name of [
      "host",
      ":authority",
      "content-length",
      "accept-encoding",
      "connection",
    ]) {
      deleteHeader(headers, name);
    }
    headers["Accept-Encoding"] = "identity";
    return headers;
  }

  function workerResponseHeaders(headers) {
    const result = cloneHeaders(headers);
    for (const name of [
      "content-length",
      "content-encoding",
      "transfer-encoding",
      "connection",
    ]) {
      deleteHeader(result, name);
    }
    return result;
  }

  function fallbackToPlayer(config, platformKey, reason) {
    if (config[platformKey]) {
      delete config[platformKey];
      writeConfig(config);
    }
    debug(`falling back to player API: ${reason}`);
    $done({
      response: {
        status: 200,
        headers: { "Content-Type": "text/plain" },
        body: new Uint8Array(0),
      },
    });
  }

  function forwardInitPlayback(config, platformKey, clientKey) {
    const body = toUint8Array($request.body);
    if (!body) {
      fallbackToPlayer(config, platformKey, "request body is not binary");
      return;
    }

    const url = buildWorkerUrl(clientKey);
    debug("forwarding initplayback to Worker with $httpClient");
    $httpClient.post(
      {
        url,
        headers: workerRequestHeaders(),
        body,
        timeout: 15000,
        "binary-mode": true,
        "auto-redirect": true,
        "auto-cookie": false,
      },
      (error, response, data) => {
        const status = Number(
          response && (response.status || response.statusCode || 0),
        );
        if (error || status < 200 || status >= 300) {
          fallbackToPlayer(
            config,
            platformKey,
            error ? String(error) : `Worker returned HTTP ${status}`,
          );
          return;
        }

        const responseBody = toUint8Array(data);
        if (!responseBody) {
          fallbackToPlayer(config, platformKey, "Worker response is not binary");
          return;
        }

        debug(`relaying Worker response: HTTP ${status}, ${responseBody.length} bytes`);
        $done({
          response: {
            status,
            headers: workerResponseHeaders(response.headers),
            body: responseBody,
          },
        });
      },
    );
  }

  function handleLogEvent(config, platformKey) {
    const headers = cloneHeaders($request.headers);
    deleteHeader(headers, "content-encoding");
    if (!(config[platformKey] && config[platformKey].clientKey)) {
      deleteHeader(headers, "x-youtube-hot-hash-data");
    }
    $done({ headers });
  }

  function handleInitPlayback(config, platformKey) {
    const keyConfig = config[platformKey];
    try {
      if (keyConfig && keyConfig.clientKey && keyConfig.encryptKey) {
        const requestKey = extractEncryptedClientKey($request.body);
        const cachedKey = decodeBase64(keyConfig.encryptKey);
        if (bytesEqual(requestKey, cachedKey)) {
          forwardInitPlayback(config, platformKey, keyConfig.clientKey);
          return;
        }
      }
      fallbackToPlayer(config, platformKey, "encrypted client key mismatch");
    } catch (error) {
      fallbackToPlayer(config, platformKey, String(error));
    }
  }

  const config = readConfig();
  const platformKey = getPlatformKey();
  if ($request.url.includes("log_event")) {
    handleLogEvent(config, platformKey);
  } else if ($request.url.includes("initplayback")) {
    handleInitPlayback(config, platformKey);
  } else {
    $done({});
  }
})();
