import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const script = readFileSync(
  new URL("../../loon/scripts/youtube.request.js", import.meta.url),
  "utf8",
);

function encodeVarint(value) {
  const bytes = [];
  let remaining = value;
  while (remaining > 0x7f) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 128);
  }
  bytes.push(remaining);
  return bytes;
}

function encodeBytesField(fieldNumber, bytes) {
  return new Uint8Array([
    ...encodeVarint(fieldNumber * 8 + 2),
    ...encodeVarint(bytes.length),
    ...bytes,
  ]);
}

function initPlaybackBody(encryptedClientKey) {
  return encodeBytesField(3, encodeBytesField(5, encryptedClientKey));
}

function runScript({
  url,
  body = new Uint8Array(0),
  headers = {},
  argument = {},
  initialConfig = {},
  workerResult = {
    error: null,
    response: {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": "3",
      },
    },
    data: new Uint8Array([9, 8, 7]),
  },
}) {
  const store = { YouTubeConfig: JSON.stringify(initialConfig) };
  const workerCalls = [];
  let donePayload;

  const persistentStore = {
    read(key) {
      return store[key];
    },
    write(value, key) {
      store[key] = value;
      return true;
    },
  };
  const httpClient = {
    post(options, callback) {
      workerCalls.push(options);
      callback(workerResult.error, workerResult.response, workerResult.data);
    },
  };
  const done = (payload) => {
    donePayload = payload;
  };

  const execute = new Function(
    "$request",
    "$argument",
    "$persistentStore",
    "$httpClient",
    "$done",
    "console",
    script,
  );
  execute(
    { url, body, headers },
    argument,
    persistentStore,
    httpClient,
    done,
    { log() {} },
  );

  return { donePayload, store, workerCalls };
}

describe("Loon YouTube request adapter", () => {
  test("forwards matching initplayback through the Worker and relays binary data", () => {
    const key = new Uint8Array([1, 2, 3, 4]);
    const result = runScript({
      url: "https://rr1---sn.example.googlevideo.com/initplayback?ack=1",
      body: initPlaybackBody(key),
      headers: {
        "User-Agent": "com.google.ios.youtube/21.30.5",
        Host: "rr1---sn.example.googlevideo.com",
        "Content-Type": "application/x-protobuf",
        "Content-Length": "99",
      },
      argument: {
        captionLang: "zh-Hans",
        blockUpload: true,
        blockImmersive: false,
        blockShorts: true,
      },
      initialConfig: {
        youtube: {
          clientKey: "worker-client-key",
          encryptKey: Buffer.from(key).toString("base64"),
        },
      },
    });

    expect(result.workerCalls).toHaveLength(1);
    const request = result.workerCalls[0];
    expect(request.url).toStartWith("https://init-stream.maasea.workers.dev/?");
    expect(request.url).toContain("ck=worker-client-key");
    expect(request.url).toContain("captionLang=zh-Hans");
    expect(request.url).toContain("blockImmersive=false");
    expect(request.headers.Host).toBeUndefined();
    expect(request.headers["Content-Length"]).toBeUndefined();
    expect(request.headers["Accept-Encoding"]).toBe("identity");
    expect(request["binary-mode"]).toBe(true);
    expect(result.donePayload.response.status).toBe(200);
    expect(result.donePayload.response.headers["Content-Length"]).toBeUndefined();
    expect(Array.from(result.donePayload.response.body)).toEqual([9, 8, 7]);
  });

  test("clears a mismatched key and returns the player fallback response", () => {
    const result = runScript({
      url: "https://rr1---sn.example.googlevideo.com/initplayback?ack=1",
      body: initPlaybackBody(new Uint8Array([5, 6, 7])),
      headers: { "User-Agent": "com.google.ios.youtube/21.30.5" },
      initialConfig: {
        youtube: {
          clientKey: "worker-client-key",
          encryptKey: Buffer.from([1, 2, 3]).toString("base64"),
        },
      },
    });

    expect(result.workerCalls).toHaveLength(0);
    expect(JSON.parse(result.store.YouTubeConfig).youtube).toBeUndefined();
    expect(result.donePayload.response.status).toBe(200);
    expect(result.donePayload.response.body).toHaveLength(0);
  });

  test("removes compressed log_event headers when no cached key exists", () => {
    const result = runScript({
      url: "https://youtubei.googleapis.com/youtubei/v1/log_event",
      headers: {
        "User-Agent": "com.google.ios.youtubemusic/9.30.4",
        "Content-Encoding": "br",
        "X-YouTube-Hot-Hash-Data": "stale",
        "Content-Type": "application/x-protobuf",
      },
      initialConfig: {},
    });

    expect(result.donePayload.headers["Content-Encoding"]).toBeUndefined();
    expect(result.donePayload.headers["X-YouTube-Hot-Hash-Data"]).toBeUndefined();
    expect(result.donePayload.headers["Content-Type"]).toBe(
      "application/x-protobuf",
    );
  });

  test("falls back safely when the Worker request fails", () => {
    const key = new Uint8Array([1, 2, 3, 4]);
    const result = runScript({
      url: "https://rr1---sn.example.googlevideo.com/initplayback?ack=1",
      body: initPlaybackBody(key),
      headers: { "User-Agent": "com.google.ios.youtube/21.30.5" },
      initialConfig: {
        youtube: {
          clientKey: "worker-client-key",
          encryptKey: Buffer.from(key).toString("base64"),
        },
      },
      workerResult: {
        error: "network error",
        response: null,
        data: null,
      },
    });

    expect(result.workerCalls).toHaveLength(1);
    expect(JSON.parse(result.store.YouTubeConfig).youtube).toBeUndefined();
    expect(result.donePayload.response.status).toBe(200);
    expect(result.donePayload.response.body).toHaveLength(0);
  });
});
