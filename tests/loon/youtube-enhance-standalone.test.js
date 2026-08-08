import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const requestScript = readFileSync(
  new URL(
    "../../loon/scripts/youtube.enhance.standalone.request.js",
    import.meta.url,
  ),
  "utf8",
);
const responseScript = readFileSync(
  new URL(
    "../../loon/scripts/youtube.enhance.standalone.response.js",
    import.meta.url,
  ),
  "utf8",
);
const plugin = readFileSync(
  new URL("../../loon/plugins/youtube-enhance-standalone.plugin", import.meta.url),
  "utf8",
);

const musicHeaders = { "User-Agent": "com.google.ios.youtubemusic/9.31.4" };

function encodeVarint(value) {
  const bytes = [];
  let remaining = value;
  while (remaining > 0x7f) {
    bytes.push((remaining % 128) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(remaining);
  return new Uint8Array(bytes);
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

function encodeBytesField(fieldNumber, bytes) {
  return concatenate([
    encodeVarint(fieldNumber * 8 + 2),
    encodeVarint(bytes.length),
    bytes,
  ]);
}

function encodeVarintField(fieldNumber, value) {
  return concatenate([encodeVarint(fieldNumber * 8), encodeVarint(value)]);
}

function ascii(value) {
  return new Uint8Array([...value].map((character) => character.charCodeAt(0)));
}

function readVarint(bytes, start) {
  let value = 0;
  let multiplier = 1;
  let offset = start;
  while (offset < bytes.length) {
    const byte = bytes[offset];
    offset += 1;
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) {
      return { value, offset };
    }
    multiplier *= 128;
  }
  throw new Error("invalid varint");
}

function parseFields(bytes) {
  const fields = [];
  let offset = 0;
  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    offset = tag.offset;
    const fieldNumber = Math.floor(tag.value / 8);
    const wireType = tag.value % 8;
    if (wireType === 0) {
      const value = readVarint(bytes, offset);
      offset = value.offset;
      fields.push({ fieldNumber, wireType, value: value.value });
    } else if (wireType === 2) {
      const length = readVarint(bytes, offset);
      offset = length.offset;
      const end = offset + length.value;
      fields.push({
        fieldNumber,
        wireType,
        payload: bytes.subarray(offset, end),
      });
      offset = end;
    } else {
      throw new Error(`unsupported test wire type: ${wireType}`);
    }
  }
  return fields;
}

function fieldPayload(bytes, fieldNumber) {
  return parseFields(bytes).find(
    (field) => field.fieldNumber === fieldNumber && field.wireType === 2,
  )?.payload;
}

function fieldNumbers(bytes) {
  return parseFields(bytes).map((field) => field.fieldNumber);
}

function containsText(bytes, text) {
  return Buffer.from(bytes).includes(Buffer.from(text));
}

function playerBody() {
  const playability = concatenate([
    encodeBytesField(21, ascii("old-pip")),
    encodeBytesField(11, ascii("old-background")),
    encodeBytesField(5, ascii("playability-keep")),
  ]);
  const tracking = concatenate([
    encodeBytesField(1, ascii("tracking-keep")),
    encodeBytesField(18, ascii("page-ad-tracking")),
  ]);
  return concatenate([
    encodeBytesField(7, ascii("ad-placement")),
    encodeBytesField(2, playability),
    encodeBytesField(9, tracking),
    encodeBytesField(68, ascii("ad-slot")),
    encodeBytesField(20, ascii("player-keep")),
  ]);
}

function watchBody() {
  const content = concatenate([
    encodeBytesField(2, playerBody()),
    encodeBytesField(3, ascii("next-keep")),
  ]);
  return encodeBytesField(1, content);
}

function rendererItem(browseId) {
  return encodeBytesField(1, ascii(`renderer:${browseId}:metadata`));
}

function guideBody(browseIds) {
  const rendererItems = concatenate(browseIds.map(rendererItem));
  return encodeBytesField(
    4,
    encodeBytesField(117866661, rendererItems),
  );
}

function runRequest({ argument = {}, headers = musicHeaders } = {}) {
  let donePayload;
  new Function(
    "$request",
    "$argument",
    "$done",
    "console",
    requestScript,
  )(
    {
      url: "https://rr.example.googlevideo.com/initplayback?oad=5500&ack=1",
      headers,
      body: new Uint8Array([1, 2, 3]),
    },
    argument,
    (payload) => {
      donePayload = payload;
    },
    { log() {} },
  );
  return donePayload;
}

function runResponse({
  path,
  body,
  argument = {},
  headers = musicHeaders,
}) {
  let donePayload;
  new Function(
    "$request",
    "$response",
    "$argument",
    "$done",
    "console",
    responseScript,
  )(
    { url: `https://youtubei.googleapis.com/youtubei/v1/${path}`, headers },
    { body },
    argument,
    (payload) => {
      donePayload = payload;
    },
    { log() {} },
  );
  return donePayload;
}

function outputBody(input, payload) {
  return payload.body || input;
}

describe("Loon YouTube Enhance Standalone request adapter", () => {
  test("has no third-party Worker or upstream runtime script dependency", () => {
    expect(plugin).not.toContain("init-stream.maasea.workers.dev");
    expect(plugin).not.toContain("raw.githubusercontent.com/Maasea");
    expect(plugin).toContain(
      "script-path=https://raw.githubusercontent.com/KnowSky404/ProxyKit/main/loon/scripts/youtube.enhance.standalone.request.js",
    );
    expect(plugin).toContain(
      "script-path=https://raw.githubusercontent.com/KnowSky404/ProxyKit/main/loon/scripts/youtube.enhance.standalone.response.js",
    );
    expect(requestScript).not.toContain("$httpClient");
    expect(responseScript).not.toContain("$httpClient");
  });

  test("forces the Music InitPlayback request to use the local API fallback", () => {
    const payload = runRequest();
    expect(payload.response.status).toBe(200);
    expect(payload.response.headers["Content-Type"]).toBe("text/plain");
    expect(payload.response.body).toHaveLength(0);
  });

  test("does not expose a way to disable required ad filtering", () => {
    expect(runRequest({ argument: { blockAds: false } }).response.status).toBe(
      200,
    );
    expect(plugin).not.toContain("blockAds = switch");
  });

  test("does not affect the regular YouTube app", () => {
    expect(
      runRequest({ headers: { "User-Agent": "com.google.ios.youtube/21.31.3" } }),
    ).toEqual({});
  });
});

describe("Loon YouTube Enhance Standalone response adapter", () => {
  test("removes Player ads and enables background playback and PiP", () => {
    const input = watchBody();
    const output = outputBody(
      input,
      runResponse({ path: "get_watch", body: input }),
    );
    const content = fieldPayload(output, 1);
    const player = fieldPayload(content, 2);
    const numbers = fieldNumbers(player);

    expect(numbers).not.toContain(7);
    expect(numbers).not.toContain(68);
    expect(numbers).toContain(20);
    expect(containsText(player, "player-keep")).toBe(true);
    expect(containsText(player, "page-ad-tracking")).toBe(false);
    expect(containsText(player, "tracking-keep")).toBe(true);
    expect(containsText(content, "next-keep")).toBe(true);

    const playability = fieldPayload(player, 2);
    expect(fieldNumbers(playability)).toContain(21);
    expect(fieldNumbers(playability)).toContain(11);
    expect(fieldNumbers(playability)).toContain(5);

    const pipRenderer = fieldPayload(playability, 21);
    const pipAbility = fieldPayload(pipRenderer, 151635310);
    expect(parseFields(pipAbility)).toEqual([
      { fieldNumber: 1, wireType: 0, value: 1 },
      { fieldNumber: 8, wireType: 0, value: 1 },
    ]);

    const backgroundRenderer = fieldPayload(playability, 11);
    const backgroundAbility = fieldPayload(backgroundRenderer, 64657230);
    expect(parseFields(backgroundAbility)).toEqual([
      { fieldNumber: 1, wireType: 0, value: 1 },
    ]);
  });

  test("supports direct Player responses", () => {
    const input = playerBody();
    const output = outputBody(
      input,
      runResponse({ path: "player", body: input }),
    );
    expect(fieldNumbers(output)).not.toContain(7);
    expect(fieldNumbers(output)).not.toContain(68);
    expect(fieldNumbers(output)).toContain(2);
  });

  test("does not allow required playback capabilities to be disabled", () => {
    const input = playerBody();
    const output = outputBody(
      input,
      runResponse({
        path: "player",
        body: input,
        argument: {
          blockAds: false,
          enableBackground: false,
          enablePiP: false,
        },
      }),
    );
    expect(fieldNumbers(output)).not.toContain(7);
    expect(fieldNumbers(output)).not.toContain(68);
    const playability = fieldPayload(output, 2);
    expect(fieldNumbers(playability)).toContain(21);
    expect(fieldNumbers(playability)).toContain(11);
    expect(plugin).not.toContain("enableBackground = switch");
    expect(plugin).not.toContain("enablePiP = switch");
  });

  for (const testCase of [
    ["hides both Music entries", true, true, false, false],
    ["keeps only the Music immersive entry", false, true, true, false],
    ["keeps only the Music upgrade entry", true, false, false, true],
    ["keeps both Music entries", false, false, true, true],
  ]) {
    const [name, blockImmersive, blockUpgrade, immersiveVisible, upgradeVisible] =
      testCase;
    test(name, () => {
      const input = guideBody(["SPunlimited", "FEmusic_immersive", "keep-me"]);
      const output = outputBody(
        input,
        runResponse({
          path: "guide",
          body: input,
          argument: { blockImmersive, blockUpgrade },
        }),
      );
      expect(containsText(output, "FEmusic_immersive")).toBe(immersiveVisible);
      expect(containsText(output, "SPunlimited")).toBe(upgradeVisible);
      expect(containsText(output, "keep-me")).toBe(true);
    });
  }

  test("does not affect the regular YouTube app", () => {
    const input = playerBody();
    const payload = runResponse({
      path: "player",
      body: input,
      headers: { "User-Agent": "com.google.ios.youtube/21.31.3" },
    });
    expect(payload).toEqual({});
  });

  test("leaves malformed protobuf unchanged", () => {
    const payload = runResponse({
      path: "player",
      body: new Uint8Array([0xff, 0xff]),
    });
    expect(payload).toEqual({});
  });
});
