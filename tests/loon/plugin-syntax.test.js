import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const ownRawPrefix = "https://raw.githubusercontent.com/KnowSky404/ProxyKit/main/";

// Validate the HTTP-only subset used by these plugins, not a full Loon parser.
function readPlugin(name) {
  const source = readFileSync(new URL(`loon/plugins/${name}.plugin`, root), "utf8");
  const section = source.split("[Script]\n")[1].split("\n[MITM]")[0];
  const rules = section.trim().split("\n").map((line) => {
    const match = line.match(/^(request|response) if \$\{url\} ~= \/(.+)\/i then script\("([^"]+)", \{(.+)\}\) with (.+)$/);
    if (!match) throw new Error(`Unsupported Script syntax: ${line}`);
    const [, phase, pattern, path, argument, options] = match;
    const names = argument.split(", ").map((value) => {
      const variable = value.match(/^\$\{(\w+)\}$/);
      if (!variable) throw new Error(`Invalid plugin argument: ${value}`);
      return variable[1];
    });
    return { phase, regex: new RegExp(pattern, "i"), path, names, options };
  });
  return { source, rules };
}

describe("Loon Script v2 plugin configuration", () => {
  for (const [name, count] of [["youtube", 2], ["youtube-enhance", 3]]) {
    test(`${name} preserves binary execution and declared object arguments`, () => {
      const { source, rules } = readPlugin(name);
      expect(source).toContain("#!loon_version=3.5.1(983)");
      expect(rules).toHaveLength(count);
      expect(rules.map((rule) => rule.phase)).toEqual(
        count === 2 ? ["response", "request"] : ["response", "request", "request"],
      );
      const responseNames = name === "youtube"
        ? ["blockImmersive", "blockUpgrade", "debug"]
        : ["captionLang", "blockUpload", "blockImmersive", "blockShorts", "debug"];
      expect(rules[0].names).toEqual(responseNames);
      expect(rules[1].names).toEqual(name === "youtube" ? ["debug"] : responseNames);
      if (count === 3) expect(rules[2].names).toEqual(["debug"]);
      for (const rule of rules) {
        expect(rule.options).toMatch(/^tag="[^"]+", requires_body=true, binary_body_mode=true, timeout=60, enable=true$/);
        for (const argument of rule.names) {
          expect(source).toMatch(new RegExp(`^${argument} = (switch|input),`, "m"));
        }
        if (rule.path.startsWith(ownRawPrefix)) {
          expect(existsSync(new URL(rule.path.slice(ownRawPrefix.length), root))).toBe(true);
        } else {
          expect(name).toBe("youtube-enhance");
          expect(rule.path).toBe("https://raw.githubusercontent.com/Maasea/sgmodule/master/Script/Youtube/youtube.response.js");
        }
      }
    });

    test(`${name} keeps URL boundaries and case-insensitive matching`, () => {
      const { rules } = readPlugin(name);
      const response = rules[0].regex;
      const api = "https://youtubei.googleapis.com/youtubei/v1/";
      for (const endpoint of ["player", "get_watch", "guide"]) {
        expect(response.test(api + endpoint)).toBe(true);
        expect(response.test((api + endpoint + "?alt=proto").toUpperCase())).toBe(true);
      }
      expect(response.test(api + "browse")).toBe(name === "youtube-enhance");
      expect(response.test(api + "player/other")).toBe(false);
      expect(response.test(api.replace(".com/", ".com.evil/") + "player")).toBe(false);
      const init = "https://rr1---sn-test.googlevideo.com/initplayback?oad=1&ack=1";
      expect(rules[1].regex.test(init)).toBe(true);
      expect(rules[1].regex.test(init.toUpperCase())).toBe(true);
      expect(rules[1].regex.test(init.replace("&ack=1", ""))).toBe(false);
      expect(rules[1].regex.test(init.replace("googlevideo.com", "example.com"))).toBe(false);
      if (rules[2]) expect(rules[2].regex.test(api + "log_event?alt=proto")).toBe(true);
    });
  }
});
