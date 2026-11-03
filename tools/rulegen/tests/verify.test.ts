import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { loadRules, validateRuleSet, RuleValidationError, type RuleSet } from "../src/model.ts";
import { renderList, renderSingBox } from "../src/generate.ts";
import { matchesRules, parseListArtifact, parseSingBoxArtifact, verifyArtifact, verifyQxRemoteEntry } from "../src/verify.ts";
import cases from "./fixtures/matches.json";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const sets = await loadRules(join(root, "shared/rules"));
const synthetic: RuleSet = validateRuleSet({
  version: 1,
  metadata: { name: "Fixture", author: "Tests", updated: "2026-01-01", source: "Synthetic", note: "No external traffic" },
  compatibility: { quantumultx_no_resolve: "legacy-policy-token", sing_box_no_resolve: "require-no-pre-resolution" },
  groups: [{ name: "Predicates", comments: ["Ordinary comment"], rules: [
    { type: "domain", value: "exact.example.com" },
    { type: "domain-suffix", value: "example.net" },
    { type: "domain", value: "disabled.example.org", enabled: false },
    { type: "ipv4-cidr", value: "198.51.100.0/24", options: { no_resolve: true } },
    { type: "ipv6-cidr", value: "2001:db8::/32", options: { no_resolve: true } },
  ] }],
});
// These expected answers are hand-authored, never calculated from renderer output or YAML.
const boundaries: [string, boolean][] = [
  ["exact.example.com", true], ["sub.exact.example.com", false], ["badexact.example.com", false],
  ["exact.example.com.evil.test", false], ["example.net", true], ["api.example.net", true],
  ["sub.api.example.net", true], ["badexample.net", false], ["example.net.evil.test", false],
  ["disabled.example.org", false], ["198.51.100.0", true], ["198.51.100.255", true],
  ["198.51.99.255", false], ["198.51.101.0", false], ["2001:db8::", true],
  ["2001:db8:ffff:ffff:ffff:ffff:ffff:ffff", true], ["2001:db7:ffff:ffff:ffff:ffff:ffff:ffff", false],
  ["2001:db9::", false], ["::ffff:198.51.100.1", false],
];

const targets = ["loon", "quantumultx", "sing-box"] as const;
function output(target: typeof targets[number]) {
  return target === "sing-box" ? renderSingBox(synthetic) : renderList(synthetic, target);
}
function parse(text: string, target: typeof targets[number], source = synthetic) {
  return target === "sing-box" ? parseSingBoxArtifact(text) : parseListArtifact(text, target, source.compatibility);
}

describe("independent static generated-subset verification", () => {
  for (const target of targets) {
    test(`${target}: checks source order/state/options and all positive/negative boundary cases`, () => {
      const text = output(target);
      expect(verifyArtifact(text, target, synthetic)).toEqual({ total: 4, enabled: 4 });
      const rules = parse(text, target);
      for (const [probe, expected] of boundaries) expect(matchesRules(rules, probe)).toBe(expected);
    });
  }

  test("hand-authored lists and JSON are parsed without calling a renderer", () => {
    expect(matchesRules(parseListArtifact("# note\nDOMAIN-SUFFIX,example.net\n# DOMAIN,disabled.example.org\n", "loon"), "sub.api.example.net")).toBe(true);
    expect(matchesRules(parseListArtifact("HOST,exact.example.com\n# HOST,disabled.example.org\n", "quantumultx"), "disabled.example.org")).toBe(false);
    expect(matchesRules(parseSingBoxArtifact('{"version":2,"rules":[{"domain_suffix":["example.net"]}]}'), "badexample.net")).toBe(false);
  });

  test("ordinary and rule-looking disabled comments remain inert", () => {
    const rules = parseListArtifact("# note with a comma, still a comment\nDOMAIN,active.example.com\n# DOMAIN,disabled.example.com\n", "loon");
    expect(rules).toHaveLength(1);
    expect(matchesRules(rules, "active.example.com")).toBe(true);
    expect(matchesRules(rules, "disabled.example.com")).toBe(false);
  });

  test("invalid probes fail without exposing private input", () => {
    for (const probe of ["fe80::1%private-interface", "https://private-probe.invalid"]) {
      try { matchesRules(synthetic.groups[0].rules, probe); throw new Error("Expected rejection"); }
      catch (error) {
        expect(error).toBeInstanceOf(RuleValidationError);
        expect((error as Error).message).toContain("probe");
        expect((error as Error).message).not.toContain("private");
      }
    }
  });

  test("rule-looking metadata, groups and comments remain inert even with invalid candidate syntax", () => {
    const source = structuredClone(synthetic);
    source.metadata.note = "DOMAIN,https://private-comment.invalid";
    source.groups[0].name = "DOMAIN,*invalid.private-comment.invalid";
    source.groups[0].comments = ["DOMAIN,private-comment.invalid", "IP-CIDR,not-an-ip/99"];
    source.groups[0].rules[0].comments = ["HOST,https://private-comment.invalid"];
    validateRuleSet(source);
    for (const target of ["loon", "quantumultx"] as const) {
      const text = renderList(source, target);
      expect(verifyArtifact(text, target, source).enabled).toBe(4);
      expect(matchesRules(parseListArtifact(text, target, source.compatibility), "private-comment.invalid")).toBe(false);
    }
  });

  for (const [name, target, text] of [
    ["foreign keyword", "loon", "HOST,private-value.invalid\n"],
    ["foreign IPv6 keyword", "quantumultx", "IP-CIDR6,2001:db8::/32\n"],
    ["unknown matcher", "loon", "DOMAIN-KEYWORD,private-value.invalid\n"],
    ["extra policy", "loon", "DOMAIN,private-value.invalid,private-policy\n"],
    ["empty field", "loon", "DOMAIN,,\n"],
    ["wildcard expansion", "quantumultx", "HOST-SUFFIX,*.private-value.invalid\n"],
    ["URL in matcher", "loon", "DOMAIN,https://private-value.invalid\n"],
    ["host bits", "loon", "IP-CIDR,192.0.2.1/24,no-resolve\n"],
    ["malformed IPv6", "quantumultx", "IP6-CIDR,2001:db8:::1/128\n"],
    ["unknown flag", "loon", "IP-CIDR,192.0.2.0/24,private-policy\n"],
    ["duplicate active rules", "loon", "DOMAIN,private-value.invalid\nDOMAIN,private-value.invalid\n"],
    ["no enabled predicate", "quantumultx", "# HOST,private-value.invalid\n"],
  ] as const) {
    test(`rejects ${name} with safe location diagnostics`, () => {
      try { parseListArtifact(text, target); throw new Error("Expected rejection"); }
      catch (error) {
        expect(error).toBeInstanceOf(RuleValidationError);
        expect((error as Error).message).toContain(target);
        expect((error as Error).message).not.toContain("private");
        expect((error as Error).message).not.toContain("192.0.2");
        expect((error as Error).message).not.toContain("2001:db8");
      }
    });
  }

  test("zero-length, host-length and embedded-IPv4 prefixes preserve address-family boundaries", () => {
    for (const [text, positives, negatives] of [
      ["IP-CIDR,0.0.0.0/0", ["0.0.0.0", "255.255.255.255"], ["::", "::ffff:192.0.2.1", "example.net"]],
      ["IP-CIDR6,::/0", ["::", "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"], ["0.0.0.0", "255.255.255.255", "example.net"]],
      ["IP-CIDR,255.255.255.255/32", ["255.255.255.255"], ["255.255.255.254", "0.0.0.0"]],
      ["IP-CIDR6,2001:db8::1/128", ["2001:db8::1", "2001:0db8:0:0:0:0:0:1"], ["2001:db8::", "2001:db8::2"]],
      ["IP-CIDR6,::ffff:192.0.2.0/120", ["::ffff:192.0.2.0", "::ffff:c000:2ff"], ["192.0.2.1", "::ffff:192.0.1.255", "::ffff:192.0.3.0"]],
    ] as [string, string[], string[]][]) {
      const rules = parseListArtifact(text + "\n", "loon");
      for (const probe of positives) expect(matchesRules(rules, probe)).toBe(true);
      for (const probe of negatives) expect(matchesRules(rules, probe)).toBe(false);
    }
  });

  test("QX third-field legacy token requires compatibility and remains separate from DNS semantics", () => {
    const text = "IP-CIDR,192.0.2.0/24,no-resolve\n";
    expect(() => parseListArtifact(text, "quantumultx")).toThrow("legacy policy token");
    expect(parseListArtifact(text, "quantumultx", synthetic.compatibility)[0].options?.no_resolve).toBe(true);
  });

  for (const [name, text] of [
    ["invalid JSON", '{"version":2,"rules":[private-value.invalid'],
    ["wrong version", '{"version":3,"rules":[{"domain":["private-value.invalid"]}]}'],
    ["empty set", '{"version":2,"rules":[]}'],
    ["unknown predicate", '{"version":2,"rules":[{"domain_keyword":["private-value.invalid"]}]}'],
    ["combined predicates", '{"version":2,"rules":[{"domain":["private-value.invalid"],"domain_suffix":["example.net"]}]}'],
    ["multiple values", '{"version":2,"rules":[{"domain":["private-value.invalid","example.net"]}]}'],
    ["unknown root field", '{"version":2,"rules":[{"domain":["private-value.invalid"]}],"private-token":true}'],
  ]) {
    test(`sing-box rejects ${name} within its generated subset`, () => {
      try { parseSingBoxArtifact(text); throw new Error("Expected rejection"); }
      catch (error) {
        expect(error).toBeInstanceOf(RuleValidationError);
        expect((error as Error).message).toContain("sing-box");
        expect((error as Error).message).not.toContain("private");
      }
    });
  }

  test("mutations of type, ordering, state, flags and missing predicates fail independently of generation", () => {
    const text = renderList(synthetic, "loon");
    for (const changed of [
      text.replace("DOMAIN,exact.example.com", "DOMAIN-SUFFIX,exact.example.com"),
      text.replace("DOMAIN,exact.example.com\nDOMAIN-SUFFIX,example.net", "DOMAIN-SUFFIX,example.net\nDOMAIN,exact.example.com"),
      text.replace("# DOMAIN,disabled.example.org", "DOMAIN,disabled.example.org"),
      text.replace("198.51.100.0/24,no-resolve", "198.51.100.0/24"),
      text.replace("DOMAIN,exact.example.com\n", ""),
    ]) expect(() => verifyArtifact(changed, "loon", synthetic)).toThrow(RuleValidationError);
    expect(() => verifyArtifact(renderSingBox(synthetic).replace('"domain":', '"domain_suffix":'), "sing-box", synthetic)).toThrow("differ");
  });
});

describe("hand-authored regression corpus for every current rule set", () => {
  test("corpus covers every set with both positive and negative expectations", () => {
    expect([...new Set(cases.map(item => item.set))].sort()).toEqual(sets.map(item => item.name));
    for (const { name } of sets) {
      expect(cases.some(item => item.set === name && item.match)).toBe(true);
      expect(cases.some(item => item.set === name && !item.match)).toBe(true);
    }
  });
  for (const [setIndex, { name, data }] of sets.entries()) {
    for (const target of targets) {
      test(`source[${setIndex}] ${target}: committed artifact matches the fixed positive/negative corpus`, () => {
        const path = target === "loon" ? `loon/rules/${name}.list` : target === "quantumultx" ? `quantumultx/filters/${name}.list` : `sing-box/rules/${name}.json`;
        const text = readFileSync(join(root, path), "utf8");
        verifyArtifact(text, target, data);
        const rules = parse(text, target, data);
        for (const item of cases.filter(item => item.set === name)) expect(matchesRules(rules, item.probe)).toBe(item.match);
      });
    }
  }
  test("a shared endpoint can be active in one set and disabled in another", () => {
    const probe = "www.turingfraud.net";
    const bybit = sets.find(set => set.name === "bybit")!.data.groups.flatMap(group => group.rules);
    const ur = sets.find(set => set.name === "ur")!.data.groups.flatMap(group => group.rules);
    expect(matchesRules(bybit, probe)).toBe(false);
    expect(matchesRules(ur, probe)).toBe(true);
  });
});

describe("QX filter_remote project example static checks", () => {
  const address = "https://example.test/private-resource.list";
  test("the documented real subscription example has an active policy override", () => {
    const readme = readFileSync(join(root, "quantumultx/README.md"), "utf8");
    const line = readme.split("\n").find(line => line.startsWith("https://raw.githubusercontent.com/"))!;
    expect(verifyQxRemoteEntry(line)).toEqual({ policyOverridden: true });
  });
  for (const [index, line] of [
    `${address}, tag=Example, enabled=true`,
    `${address}, tag=Example, force-policy=, enabled=true`,
    `${address}, tag=Example, force-policy=private-policy, enabled=false`,
    `${address}, tag=Example, force-policy=private-policy, force-policy=Other, enabled=true`,
    `${address}, tag=Example, force-policy=private-policy, enable=true`,
    `${address}, tag=Example, force-policy=private-policy, enabled=true, unknown=private-secret`,
    `${address.replace("https:", "http:")}, tag=Example, force-policy=private-policy, enabled=true`,
    `${address}, tag=Example, force-policy=private-policy, enabled=true\nprivate-secret`,
  ].entries()) {
    test(`rejects invalid project remote entry[${index}] without exposing the URL or policy`, () => {
      try { verifyQxRemoteEntry(line); throw new Error("Expected rejection"); }
      catch (error) {
        expect(error).toBeInstanceOf(RuleValidationError);
        expect((error as Error).message).toContain("quantumultx.filter_remote");
        expect((error as Error).message).not.toContain("private");
        expect((error as Error).message).not.toContain("example.test");
      }
    });
  }
});
