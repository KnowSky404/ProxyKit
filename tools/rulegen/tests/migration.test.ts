import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRules, ipNumber } from "../src/model.ts";
import { renderList, renderSingBox } from "../src/generate.ts";
import { checkCompiler, compileSrs } from "../src/srs.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const fixtures = new URL("./fixtures/legacy/", import.meta.url);
const legacyNames = ["binance", "bitget-wallet", "bybit", "ur", "wise"];
const sets = await loadRules(join(root, "shared/rules"));
const compiler = process.env.SING_BOX_BIN ?? "sing-box";
function match(path: string, value: string): boolean {
  const result = Bun.spawnSync([compiler, "rule-set", "match", "--format", "binary", path, value], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).toBe(0);
  // sing-box match writes its positive diagnostic to stderr, not stdout.
  return new TextDecoder().decode(result.stderr).includes("match rules.[");
}

describe("migration from main at 179fb7c", () => {
  test("all five original sources remain present", () => {
    expect(sets.map(set => set.name).filter(name => legacyNames.includes(name))).toEqual(legacyNames);
  });
  for (const { name, data } of sets.filter(set => legacyNames.includes(set.name))) {
    test(`${name}: metadata, order, comments, disabled candidates and options survive byte-for-byte`, () => {
      for (const target of ["loon", "quantumultx"] as const) {
        const legacy = readFileSync(new URL(`${target}/${name}.list`, fixtures), "utf8");
        expect(renderList(data, target)).toBe(legacy);
      }
    });
  }
  test("Binance explicitly retains the legacy QX policy token and sing-box resolution contract", () => {
    const data = sets.find(set => set.name === "binance")!.data;
    expect(data.compatibility).toEqual({ quantumultx_no_resolve: "legacy-policy-token", sing_box_no_resolve: "require-no-pre-resolution" });
    expect(data.groups.flatMap(group => group.rules).filter(rule => rule.type === "ipv4-cidr").every(rule => rule.options?.no_resolve === true)).toBe(true);
  });
});

describe("all current sources and generated client artifacts", () => {
  test("every client artifact has exactly the current source basenames", () => {
    const names = sets.map(set => set.name);
    for (const [dir, ext] of [["loon/rules", ".list"], ["quantumultx/filters", ".list"], ["sing-box/rules", ".json"], ["sing-box/rules", ".srs"]]) {
      expect(readdirSync(join(root, dir)).filter(file => file.endsWith(ext)).map(file => file.slice(0, -ext.length)).sort()).toEqual(names);
    }
  });
  for (const { name, data } of sets) {
    test(`${name}: committed text lists preserve the source and equivalent client syntax`, () => {
      for (const target of ["loon", "quantumultx"] as const) {
        const path = target === "loon" ? "loon/rules" : "quantumultx/filters";
        expect(readFileSync(join(root, path, `${name}.list`), "utf8")).toBe(renderList(data, target));
      }
      expect(renderList(data, "quantumultx").replaceAll("HOST-SUFFIX,", "DOMAIN-SUFFIX,").replaceAll("HOST,", "DOMAIN,").replaceAll("IP6-CIDR,", "IP-CIDR6,")).toBe(renderList(data, "loon"));
    });
    test(`${name}: compact sing-box JSON preserves all enabled predicates and per-field order`, () => {
      const expected = data.groups.flatMap(group => group.rules).filter(rule => rule.enabled !== false);
      const json = JSON.parse(renderSingBox(data));
      expect(json.version).toBe(2);
      expect(json.rules).toHaveLength(1);
      const rule = json.rules[0];
      expect(Object.keys(rule).every(key => ["domain", "domain_suffix", "ip_cidr"].includes(key))).toBe(true);
      expect(rule.domain ?? []).toEqual(expected.filter(rule => rule.type === "domain").map(rule => rule.value));
      expect(rule.domain_suffix ?? []).toEqual(expected.filter(rule => rule.type === "domain-suffix").map(rule => rule.value));
      expect(rule.ip_cidr ?? []).toEqual(expected.filter(rule => rule.type.endsWith("-cidr")).map(rule => rule.value));
      expect(readFileSync(join(root, "sing-box/rules", `${name}.json`), "utf8")).toBe(renderSingBox(data));
    });
  }
});

describe("real official SRS matching and reproducibility", () => {
  for (const { name, data } of sets) {
    test(`${name}: committed binary equals a fresh official compilation and matches source predicates`, () => {
      checkCompiler(compiler);
      const binary = join(root, "sing-box/rules", `${name}.srs`);
      const source = renderSingBox(data);
      expect(compileSrs(source, compiler)).toEqual(readFileSync(binary));
      expect(compileSrs(source, compiler)).toEqual(readFileSync(binary));
      for (const rule of data.groups.flatMap(group => group.rules).filter(rule => rule.enabled !== false)) {
        const probe = rule.value.split("/")[0];
        expect(match(binary, probe)).toBe(true);
        if (rule.type === "domain-suffix") {
          expect(match(binary, `rulegen-test.${probe}`)).toBe(true);
          // Prevent accidental string-suffix or substring expansion.
          expect(match(binary, `rulegen-test${probe}`)).toBe(false);
          expect(match(binary, `${probe}.invalid`)).toBe(false);
        }
      }
      expect(match(binary, "192.0.2.1")).toBe(false);
      expect(match(binary, "2001:db8::1")).toBe(false);
    });
  }
  test("disabled telemetry candidates do not become active binary matches", () => {
    for (const [name, probe] of [["wise", "api.mixpanel.com"], ["bitget-wallet", "log.noxiaohao.com"], ["ur", "init-p01md.apple.com"], ["bybit", "h64.online-metrix.net"]]) {
      expect(match(join(root, "sing-box/rules", `${name}.srs`), probe)).toBe(false);
    }
  });
  test("IPv4/IPv6 CIDR boundaries and exact-domain scope survive official binary encoding", () => {
    checkCompiler(compiler);
    const directory = mkdtempSync(join(tmpdir(), "rulegen-boundary-"));
    try {
      const file = join(directory, "fixture.srs");
      writeFileSync(file, compileSrs(JSON.stringify({ version: 2, rules: [
        { domain: ["exact.example.com"] },
        { ip_cidr: ["198.51.100.0/24"] },
        { ip_cidr: ["2001:db8::/32"] },
      ] }), compiler));
      for (const value of ["exact.example.com", "198.51.100.0", "198.51.100.255", "2001:db8::", "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff"]) expect(match(file, value)).toBe(true);
      for (const value of ["sub.exact.example.com", "exact.example.com.invalid", "198.51.99.255", "198.51.101.0", "2001:db7:ffff:ffff:ffff:ffff:ffff:ffff", "2001:db9::"]) expect(match(file, value)).toBe(false);
      expect(ipNumber("2001:db8::")).toBe(ipNumber("2001:0db8:0:0:0:0:0:0"));
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
