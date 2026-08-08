/**
 * YouTube InitPlayback fallback for Loon.
 *
 * The current release only handles YouTube Music requests.
 * This script intentionally does not call a Worker or any other remote helper.
 * SPDX-License-Identifier: Apache-2.0
 * License: ./LICENSE-APACHE-2.0
 * Notice: ./NOTICE
 */

(() => {
  "use strict";

  const debugEnabled = getBooleanArgument("debug", false);

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
    if (debugEnabled) {
      console.log(`[YouTube Request] ${message}`);
    }
  }

  if (!isYouTubeMusic()) {
    $done({});
    return;
  }

  debug("returning an empty InitPlayback response to use the local API fallback");
  $done({
    response: {
      status: 200,
      headers: { "Content-Type": "text/plain" },
      body: new Uint8Array(0),
    },
  });
})();
