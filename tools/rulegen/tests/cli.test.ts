import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCompiler, compileSrs } from "../src/srs";
import type { RuleSet } from "../src/model";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const compiler = process.env.SING_BOX_BIN ?? "sing-box";
let directory: string;
let input: string;
let output: string;
const source = {
  version: 1,
  metadata: { name: "Fixture", author: "Tests", updated: "2026-01-01", source: "Synthetic test data", note: "Do not log rule values" },
  groups: [{ name: "Fixture matches", rules: [{ type: "domain", value: "private-example.invalid" }] }],
};
function run(...args: string[]) {
  return Bun.spawnSync([process.execPath, cli, ...args], { cwd: directory, stdout: "pipe", stderr: "pipe" });
}
function text(result: ReturnType<typeof run>) { return new TextDecoder().decode(result.stderr); }
function fakeCompiler(body: string) {
  const path = join(directory, "fake-compiler");
  writeFileSync(path, `#!/bin/sh\n${body}\n`, { mode: 0o700 });
  return path;
}
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "rulegen-cli-test-"));
  input = join(directory, "input");
  output = join(directory, "output");
  mkdirSync(input);
  writeFileSync(join(input, "private-name.yaml"), JSON.stringify(source));
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe("rulegen standalone CLI", () => {
  test("help and misuse return meaningful statuses without echoing arguments", () => {
    const help = run("--help");
    expect(help.exitCode).toBe(0);
    expect(text(run("--private-secret"))).not.toContain("private-secret");
    for (const args of [["oops"], ["build", "--target", "other"], ["build", "--input"], ["build", "--target", "loon,loon"]]) {
      expect(run(...args).exitCode).toBe(1);
    }
  });
  test("runs outside repository, validates without outputs or compiler, and builds selected clients", () => {
    // Default paths stay anchored to the generator even when cwd has no shared/rules.
    expect(run("validate").exitCode).toBe(0);
    expect(run("validate", "--input", "input", "--output", "output", "--sing-box", "missing-compiler").exitCode).toBe(0);
    expect(existsSync(output)).toBe(false);
    const result = run("build", "--input=input", "--output=output", "--target=loon,quantumultx");
    expect(text(result)).toBe("");
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(output, "loon/rules/private-name.list"), "utf8")).toContain("DOMAIN,private-example.invalid");
    expect(readFileSync(join(output, "quantumultx/filters/private-name.list"), "utf8")).toContain("HOST,private-example.invalid");
    expect(existsSync(join(output, "sing-box"))).toBe(false);
    expect(new TextDecoder().decode(result.stdout)).not.toContain("private");
  });
  test("check catches changed, missing and stale files; build cleans only managed artifacts", () => {
    const args = ["--input", input, "--output", output, "--target", "loon"];
    expect(run("build", ...args).exitCode).toBe(0);
    expect(run("check", ...args).exitCode).toBe(0);
    const file = join(output, "loon/rules/private-name.list");
    const original = readFileSync(file);
    writeFileSync(file, "changed");
    expect(run("check", ...args).exitCode).toBe(1);
    rmSync(file);
    expect(run("check", ...args).exitCode).toBe(1);
    writeFileSync(file, original);
    writeFileSync(join(output, "loon/rules/old.list"), "old");
    writeFileSync(join(output, "loon/rules/keep.md"), "keep");
    expect(run("check", ...args).exitCode).toBe(1);
    expect(run("build", ...args).exitCode).toBe(0);
    expect(existsSync(join(output, "loon/rules/old.list"))).toBe(false);
    expect(existsSync(join(output, "loon/rules/keep.md"))).toBe(true);
    expect(run("check", ...args).exitCode).toBe(0);
  });
  test("rejects invalid input before changing existing artifacts and redacts parser details", () => {
    const args = ["--input", input, "--output", output, "--target", "loon"];
    expect(run("build", ...args).exitCode).toBe(0);
    const file = join(output, "loon/rules/private-name.list");
    const original = readFileSync(file);
    writeFileSync(join(input, "private-name.yaml"), "secret: [private-example.invalid");
    const result = run("build", ...args);
    expect(result.exitCode).toBe(1);
    expect(text(result)).not.toContain("private");
    expect(text(result)).not.toContain(input);
    expect(readFileSync(file)).toEqual(original);
  });
  test("rejects symbolic-link artifacts instead of changing their destinations", () => {
    const dir = join(output, "loon/rules");
    mkdirSync(dir, { recursive: true });
    const outside = join(directory, "outside");
    writeFileSync(outside, "preserve");
    symlinkSync(outside, join(dir, "private-name.list"));
    expect(run("build", "--input", input, "--output", output, "--target", "loon").exitCode).toBe(1);
    expect(readFileSync(outside, "utf8")).toBe("preserve");
  });
  test("rejects intermediate directory symlinks before creating client outputs", () => {
    mkdirSync(output);
    const outside = join(directory, "outside-directory");
    mkdirSync(outside);
    symlinkSync(outside, join(output, "loon"));
    expect(run("build", "--input", input, "--output", output, "--target", "loon").exitCode).toBe(1);
    expect(readdirSync(outside)).toEqual([]);
  });
  test("missing and incompatible compilers fail before writing any artifacts", () => {
    for (const version of [undefined, "1.9.0", "1.10.7"]) {
      const path = version ? fakeCompiler(`printf 'sing-box version ${version}\\n'`) : join(directory, "missing");
      const result = run("build", "--input", input, "--output", output, "--sing-box", path);
      expect(result.exitCode).toBe(1);
      expect(existsSync(output)).toBe(false);
      expect(text(result)).not.toContain(directory);
    }
  });
  test("known compiler errors provide fixed safe reasons without repeating source or paths", () => {
    const cases = [
      ["unknown rule-set version: 255", "unsupported source rule-set version"],
      ["unexpected end of JSON input", "incomplete source JSON"],
      ["unexpected end of JSON input: row 1, column 22", "incomplete source JSON"],
      ["unexpected end of JSON input: private-example.invalid", "unclassified compiler error"],
      ['ipcidr: parse [0]: netip.ParsePrefix("private-example.invalid"): no prefix', "invalid IP CIDR matcher"],
      ["open /private-example.invalid/rules.json: permission denied", "compiler filesystem permission denied"],
    ];
    for (const [message, reason] of cases) {
      const path = fakeCompiler(`if [ "$1" = version ]; then printf 'sing-box version 1.14.4\\n'; exit 0; fi\nprintf '%s\\n' 'FATAL[0000] ${message}' >&2\nexit 1`);
      const result = run("build", "--input", input, "--output", output, "--sing-box", path);
      expect(result.exitCode).toBe(1);
      expect(text(result)).toContain(reason);
      expect(text(result)).not.toContain("private-example");
      expect(existsSync(output)).toBe(false);
    }
  });
  test("compiler failures explain the operation without exposing child output", () => {
    const path = fakeCompiler("if [ \"$1\" = version ]; then printf 'sing-box version 1.14.4\\n'; exit 0; fi\nprintf 'private-example.invalid: unknown rule-set version: 255' >&2\nexit 9");
    const result = run("build", "--input", input, "--output", output, "--sing-box", path);
    expect(result.exitCode).toBe(1);
    expect(text(result)).toContain("compilation failed (exit 9)");
    expect(text(result)).toContain("unclassified compiler error");
    expect(text(result)).not.toContain("private");
    expect(existsSync(output)).toBe(false);
  });
});

describe("official sing-box compiler integration", () => {
  test("pinned compiler produces deterministic valid SRS for IPv4, IPv6 and domains", () => {
    checkCompiler(compiler);
    const json = JSON.stringify({ version: 2, rules: [{
      domain: ["example.com", "second.example.com"], domain_suffix: ["example.net"],
      ip_cidr: ["198.51.100.0/24", "2001:0db8::/32"],
    }] });
    const first = compileSrs(json, compiler);
    expect(first.length).toBeGreaterThan(8);
    expect(compileSrs(json, compiler)).toEqual(first);
  });
  test("combined adjacent and overlapping CIDRs survive official coalescing with the same address union", () => {
    const json = JSON.stringify({ version: 2, rules: [{
      ip_cidr: ["198.51.100.0/25", "198.51.100.128/25", "198.51.100.0/24", "203.0.113.7/32", "2001:db8::/33", "2001:db8:8000::/33"],
    }] });
    const binary = join(directory, "combined.srs");
    writeFileSync(binary, compileSrs(json, compiler));
    for (const [probe, expected] of [
      ["198.51.100.0", true], ["198.51.100.255", true], ["198.51.99.255", false], ["198.51.101.0", false],
      ["203.0.113.7", true], ["203.0.113.6", false], ["203.0.113.8", false],
      ["2001:db8::", true], ["2001:db8:ffff:ffff:ffff:ffff:ffff:ffff", true],
      ["2001:db7:ffff:ffff:ffff:ffff:ffff:ffff", false], ["2001:db9::", false], ["::ffff:198.51.100.1", false],
    ] as const) {
      const result = Bun.spawnSync([compiler, "rule-set", "match", "--format", "binary", binary, probe], { stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode).toBe(0);
      expect(new TextDecoder().decode(result.stderr).includes("match rules.[")).toBe(expected);
    }
  });
  test("round-trip verification still rejects expanded gaps, missing prefixes and address-family changes", () => {
    const rule = { ip_cidr: ["198.51.100.0/25", "198.51.101.0/25"] };
    const source = JSON.stringify({ version: 2, rules: [rule] });
    for (const ip_cidr of [
      ["198.51.100.0/23"],
      ["198.51.100.0/25"],
      ["::ffff:198.51.100.0/121", "::ffff:198.51.101.0/121"],
    ]) {
      const decoded = JSON.stringify({ version: 2, rules: [{ ip_cidr }] });
      const executable = fakeCompiler(`if [ "$2" = decompile ]; then\ncat <<'JSON' >"$4"\n${decoded}\nJSON\nelse\nprintf 'fixture' >"$4"\nfi`);
      expect(() => compileSrs(source, executable)).toThrow("round-trip changed");
    }
  });
  test("schema-valid same-root exact/suffix pairs build and verify without losing source predicates", () => {
    const overlapping = structuredClone(source) as RuleSet;
    overlapping.groups[0].rules = [
      { type: "domain", value: "example.com" },
      { type: "domain-suffix", value: "example.com" },
      { type: "domain", value: "only.example.net" },
    ];
    writeFileSync(join(input, "private-name.yaml"), JSON.stringify(overlapping));
    const args = ["--input", input, "--output", output, "--sing-box", compiler];
    expect(run("build", ...args).exitCode).toBe(0);
    expect(run("verify", ...args).exitCode).toBe(0);
    const json = JSON.parse(readFileSync(join(output, "sing-box/rules/private-name.json"), "utf8"));
    expect(json.rules).toEqual([{ domain: ["example.com", "only.example.net"], domain_suffix: ["example.com"] }]);
    const binary = join(output, "sing-box/rules/private-name.srs");
    for (const [probe, expected] of [
      ["example.com", true], ["api.example.com", true], ["badexample.com", false],
      ["only.example.net", true], ["sub.only.example.net", false], ["other.example.net", false],
    ] as const) {
      const result = Bun.spawnSync([compiler, "rule-set", "match", "--format", "binary", binary, probe], { stdout: "pipe", stderr: "pipe" });
      expect(result.exitCode).toBe(0);
      expect(new TextDecoder().decode(result.stderr).includes("match rules.[")).toBe(expected);
    }
  });
  test("domain normalization rejects exact-to-suffix expansion and loss of suffix matching", () => {
    for (const [expected, actual] of [
      [{ domain: ["example.com"] }, { domain_suffix: ["example.com"] }],
      [{ domain: ["example.com"], domain_suffix: ["example.com"] }, { domain: ["example.com"] }],
    ]) {
      const decoded = JSON.stringify({ version: 2, rules: [actual] });
      const executable = fakeCompiler(`if [ "$2" = decompile ]; then\ncat <<'JSON' >"$4"\n${decoded}\nJSON\nelse\nprintf 'fixture' >"$4"\nfi`);
      expect(() => compileSrs(JSON.stringify({ version: 2, rules: [expected] }), executable)).toThrow("round-trip changed");
    }
  });
  test("standalone all-target build/check includes verified SRS and is repeatable", () => {
    const args = ["--input", input, "--output", output, "--sing-box", compiler];
    expect(run("build", ...args).exitCode).toBe(0);
    expect(run("check", ...args).exitCode).toBe(0);
    const srs = join(output, "sing-box/rules/private-name.srs");
    const first = readFileSync(srs);
    expect(run("build", ...args).exitCode).toBe(0);
    expect(readFileSync(srs)).toEqual(first);
    expect(readdirSync(join(output, "sing-box/rules")).sort()).toEqual(["private-name.json", "private-name.srs"]);
  });
  test("invalid source fails compilation with an official, safely classified diagnostic", () => {
    expect(() => compileSrs('{"version":255,"rules":[]}', compiler)).toThrow("unsupported source rule-set version");
    expect(() => compileSrs('{"version":999,"rules":[]}', compiler)).toThrow("invalid source version field");
    expect(() => compileSrs('{"version":2,"rules":[{"ip_cidr":["private-example.invalid"]}]}', compiler)).toThrow("invalid IP CIDR matcher");
    expect(() => compileSrs('{"version":2,"rules":[', compiler)).toThrow("incomplete source JSON");
  });
});

describe("verification entrypoint", () => {
  test("verifies external private artifacts read-only and reports only counts and ordinals", () => {
    const privateSource = structuredClone(source) as RuleSet;
    privateSource.groups[0].rules = [
      { type: "domain-suffix", value: "private-example.invalid" },
      { type: "domain", value: "api.private-example.invalid", enabled: false },
    ];
    writeFileSync(join(input, "private-name.yaml"), JSON.stringify(privateSource));
    writeFileSync(join(input, "other-private-name.yaml"), JSON.stringify(source));
    const args = ["--input", input, "--output", output, "--target", "loon,quantumultx"];
    expect(run("build", ...args).exitCode).toBe(0);
    const file = join(output, "loon/rules/private-name.list");
    const before = readFileSync(file);
    const result = run("verify", ...args);
    expect(text(result)).toBe("");
    expect(result.exitCode).toBe(0);
    const log = new TextDecoder().decode(result.stdout);
    expect(log).toContain('"ruleSets":2');
    expect(log).toContain('"artifacts":4');
    expect(log).toContain('"error":0');
    expect(log).toContain('"severity":"warning"');
    expect(log).toContain('"severity":"info"');
    for (const secret of ["private-example", "private-name", input, output]) expect(log).not.toContain(secret);
    expect(readFileSync(file)).toEqual(before);
  });
  test("verification refuses malformed sources or drift without changing output", () => {
    const args = ["--input", input, "--output", output, "--target", "loon"];
    expect(run("build", ...args).exitCode).toBe(0);
    const file = join(output, "loon/rules/private-name.list");
    writeFileSync(file, "DOMAIN-SUFFIX,private-example.invalid\n");
    const result = run("verify", ...args);
    expect(result.exitCode).toBe(1);
    expect(text(result)).not.toContain("private");
    expect(text(result)).toContain("source[0] loon.rules[0]");
    expect(readFileSync(file, "utf8")).toBe("DOMAIN-SUFFIX,private-example.invalid\n");
    writeFileSync(join(input, "private-name.yaml"), JSON.stringify({ ...source, version: 99 }));
    expect(run("verify", ...args).exitCode).toBe(1);
  });
  test("all-target verification requires the real compiler and verifies four artifacts per set", () => {
    const args = ["--input", input, "--output", output, "--sing-box", compiler];
    expect(run("build", ...args).exitCode).toBe(0);
    const result = run("verify", ...args);
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(result.stdout)).toContain('"artifacts":4');
    expect(run("verify", "--input", input, "--output", output, "--sing-box", join(directory, "missing")).exitCode).toBe(1);
  });
});
