import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stringify } from "yaml";
import { loadRules, parseRuleSet, RuleValidationError, validateRuleSet, type Rule, type RuleSet } from "../src/model.ts";

function source(rules: Rule[] = [{ type: "domain", value: "example.com" }]): RuleSet {
  return {
    version: 1,
    metadata: { name: "Test", author: "ProxyKit", updated: "2026-01-31", source: "Public fixture", note: "Validation fixture" },
    groups: [{ name: "First group", rules }],
  };
}

describe("strict YAML schema", () => {
  test("loads metadata, order, comments and disabled candidates without modifying them", () => {
    const data = source([
      { type: "domain-suffix", value: "example.com" },
      { type: "domain", value: "api.example.com", enabled: false, comments: ["Covered by suffix"] },
    ]);
    data.groups[0].comments = ["Group explanation"];
    expect(parseRuleSet(stringify(data))).toEqual(data);
  });

  for (const [name, yaml] of [
    ["duplicate mapping keys", "version: 1\nversion: 1\n"],
    ["duplicate nested keys", stringify(source()).replace("    rules:", "    name: Duplicate\n    rules:")],
    ["malformed YAML", "groups: [\n"],
    ["multiple documents", stringify(source()) + "---\nversion: 1\n"],
    ["unknown tags", stringify(source()).replace("Public fixture", "!private Public fixture")],
    ["aliases", stringify(source()).replace("name: Test", "name: &name Test").replace("author: ProxyKit", "author: *name")],
  ]) {
    test(`rejects ${name} without leaking source`, () => {
      expect(() => parseRuleSet(yaml)).toThrow(RuleValidationError);
      try { parseRuleSet(yaml); } catch (error) {
        expect((error as Error).message).not.toContain(yaml);
      }
    });
  }

  const invalid: [string, (data: any) => void][] = [
    ["unsupported version", data => { data.version = 2; }],
    ["missing metadata", data => { delete data.metadata; }],
    ["unknown root field", data => { data.route = "secret-policy"; }],
    ["unknown metadata field", data => { data.metadata.token = "secret-token"; }],
    ["unknown group field", data => { data.groups[0].policy = "secret-policy"; }],
    ["unknown rule field", data => { data.groups[0].rules[0].outbound = "secret-policy"; }],
    ["unknown compatibility field", data => { data.compatibility = { private: true }; }],
    ["unknown compatibility mode", data => { data.compatibility = { sing_box_no_resolve: "ignore" }; }],
    ["numeric metadata", data => { data.metadata.name = 123; }],
    ["empty metadata", data => { data.metadata.source = "  "; }],
    ["multiline metadata", data => { data.metadata.note = "comment\nDOMAIN,private.example"; }],
    ["invalid date", data => { data.metadata.updated = "2026-02-30"; }],
    ["non-leap date", data => { data.metadata.updated = "2025-02-29"; }],
    ["noncanonical date", data => { data.metadata.updated = "2026-1-31"; }],
    ["empty groups", data => { data.groups = []; }],
    ["groups of wrong type", data => { data.groups = {}; }],
    ["empty rules", data => { data.groups[0].rules = []; }],
    ["rules of wrong type", data => { data.groups[0].rules = "example.com"; }],
    ["blank group name", data => { data.groups[0].name = ""; }],
    ["unsupported rule", data => { data.groups[0].rules[0].type = "domain-keyword"; }],
    ["value of wrong type", data => { data.groups[0].rules[0].value = 127001; }],
    ["enabled string", data => { data.groups[0].rules[0].enabled = "false"; }],
    ["enabled numeric", data => { data.groups[0].rules[0].enabled = 0; }],
    ["null rule", data => { data.groups[0].rules[0] = null; }],
    ["all-disabled set", data => { data.groups[0].rules[0].enabled = false; }],
    ["comments string", data => { data.groups[0].comments = "private comment"; }],
    ["comment of wrong type", data => { data.groups[0].rules[0].comments = [123]; }],
    ["multiline comment", data => { data.groups[0].comments = ["note\nDOMAIN,private.example"]; }],
    ["Unicode line separator", data => { data.groups[0].comments = ["note\u2028DOMAIN,private.example"]; }],
    ["IP options on a domain", data => { data.groups[0].rules[0].options = { no_resolve: false }; }],
    ["options of wrong type", data => { data.groups[0].rules[0].options = true; }],
  ];
  for (const [name, mutate] of invalid) {
    test(`rejects ${name}`, () => {
      const data: any = source();
      mutate(data);
      expect(() => validateRuleSet(data)).toThrow(RuleValidationError);
    });
  }

  test("accepts a real leap date", () => {
    const data = source();
    data.metadata.updated = "2024-02-29";
    expect(validateRuleSet(data)).toBe(data);
  });

  test("validation diagnostics identify the field without repeating private values or unknown keys", () => {
    const data: any = source([{ type: "domain", value: "PRIVATE-TOKEN.invalid" }]);
    data.groups[0].rules[0]["PRIVATE-KEY"] = "PRIVATE-SECRET";
    try { validateRuleSet(data); throw new Error("Expected validation error"); }
    catch (error) {
      expect(error).toBeInstanceOf(RuleValidationError);
      expect((error as Error).message).toContain("groups[0].rules[0]");
      expect((error as Error).message).not.toContain("PRIVATE");
    }
  });
});

describe("domain validation", () => {
  for (const value of ["example.com", "api.example.com", "a.co", "0.example", "xn--bcher-kva.example", `${"a".repeat(63)}.example`]) {
    test(`accepts canonical domain ${value}`, () => {
      expect(validateRuleSet(source([{ type: "domain", value }])).groups[0].rules[0].value).toBe(value);
    });
  }
  for (const value of ["Example.com", ".example.com", "example.com.", "*.example.com", "foo..example", "-a.example", "a-.example", "a_b.example", "http://example.com", "example.com/path", "example.com:443", "127.0.0.1", "example.123", "localhost", "bücher.example", `${"a".repeat(64)}.example`, `${("a".repeat(63) + ".").repeat(4)}example`, "example.com\nDOMAIN,other.example"]) {
    test(`rejects invalid domain ${JSON.stringify(value)}`, () => {
      expect(() => validateRuleSet(source([{ type: "domain-suffix", value }]))).toThrow(RuleValidationError);
    });
  }
});

describe("client-scoped User-Agent and ASN predicates", () => {
  test("preserves explicit targets, wildcard case and IP options", () => {
    const data = source([
      { type: "user-agent", value: "MicroMessenger*", targets: ["loon"] },
      { type: "ip-asn", value: "4294967295", targets: ["loon"], options: { no_resolve: true } },
    ]);
    expect(parseRuleSet(stringify(data))).toEqual(data);
  });
  for (const value of ["0", "01", "AS132203", "-1", "1.5", "4294967296", " 132203", "132203,no-resolve"]) {
    test(`rejects noncanonical ASN ${JSON.stringify(value)}`, () => {
      expect(() => validateRuleSet(source([{ type: "ip-asn", value }]))).toThrow(RuleValidationError);
    });
  }
  for (const value of ["MicroMessenger*,DIRECT", " Agent*", "Agent* ", "Agent\n*", "微信*"]) {
    test(`rejects unsafe User-Agent ${JSON.stringify(value)}`, () => {
      expect(() => validateRuleSet(source([{ type: "user-agent", value }]))).toThrow(RuleValidationError);
    });
  }
  test("rejects empty, duplicate, unknown and non-array targets", () => {
    for (const targets of [[], ["loon", "loon"], ["unknown"], "loon", null, [1]]) {
      const data: any = source();
      data.groups[0].rules[0].targets = targets;
      expect(() => validateRuleSet(data)).toThrow("targets");
    }
  });
  test("new match types retain duplicate and option validation", () => {
    for (const type of ["user-agent", "ip-asn"] as const) {
      const value = type === "user-agent" ? "Agent*" : "132203";
      expect(() => validateRuleSet(source([{ type, value }, { type, value, enabled: false }]))).toThrow("duplicate match");
    }
    expect(() => validateRuleSet(source([{ type: "user-agent", value: "Agent*", options: { no_resolve: true } }]))).toThrow("IP options");
  });
  test("CIDR resolution conflicts apply only when the client scopes overlap", () => {
    const rules: Rule[] = [
      { type: "ipv4-cidr", value: "192.0.2.0/24", targets: ["loon"], options: { no_resolve: true } },
      { type: "ipv4-cidr", value: "192.0.2.1/32", targets: ["quantumultx"] },
    ];
    expect(() => validateRuleSet(source(rules))).not.toThrow();
    rules[1].targets = ["loon", "quantumultx"];
    expect(() => validateRuleSet(source(rules))).toThrow("conflicting resolution options");
  });
});

describe("CIDR validation and duplicate matching", () => {
  const valid: [Rule["type"], string][] = [
    ["ipv4-cidr", "0.0.0.0/0"], ["ipv4-cidr", "192.0.2.0/24"], ["ipv4-cidr", "192.0.2.1/32"],
    ["ipv6-cidr", "::/0"], ["ipv6-cidr", "2001:db8::/32"], ["ipv6-cidr", "2001:DB8::1/128"],
    ["ipv6-cidr", "::ffff:192.0.2.0/120"], ["ipv6-cidr", "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff/128"],
  ];
  for (const [type, value] of valid) {
    test(`accepts ${type} ${value}`, () => expect(validateRuleSet(source([{ type, value }])).groups[0].rules[0].value).toBe(value));
  }
  const invalid: [Rule["type"], string][] = [
    ["ipv4-cidr", "256.0.0.0/8"], ["ipv4-cidr", "192.000.2.0/24"], ["ipv4-cidr", "192.0.2.0"],
    ["ipv4-cidr", "192.0.2.0/33"], ["ipv4-cidr", "192.0.2.0/-1"], ["ipv4-cidr", "192.0.2.0/024"],
    ["ipv4-cidr", "192.0.2.0/24/1"], ["ipv4-cidr", "192.0.2.1/24"], ["ipv4-cidr", "::/0"],
    ["ipv6-cidr", "2001:db8::/129"], ["ipv6-cidr", "2001:db8::1/64"], ["ipv6-cidr", "2001:db8:::1/128"],
    ["ipv6-cidr", "2001:gggg::/32"], ["ipv6-cidr", "fe80::%eth0/64"], ["ipv6-cidr", "192.0.2.0/24"],
  ];
  for (const [type, value] of invalid) {
    test(`rejects invalid ${type} ${value}`, () => expect(() => validateRuleSet(source([{ type, value }]))).toThrow(RuleValidationError));
  }

  test("rejects nonboolean and unknown IP options", () => {
    for (const options of [{ no_resolve: "true" }, { resolve: false }]) {
      expect(() => validateRuleSet(source([{ type: "ipv4-cidr", value: "192.0.2.0/24", options } as any]))).toThrow(RuleValidationError);
    }
  });

  test("detects duplicate domain rules across groups and enabled states", () => {
    const data = source();
    data.groups.push({ name: "Second", rules: [{ type: "domain", value: "example.com", enabled: false }] });
    expect(() => validateRuleSet(data)).toThrow("duplicate match");
  });

  test("detects equal IPv6 networks despite compression, case, and embedded IPv4 spelling", () => {
    for (const values of [
      ["2001:db8::/32", "2001:0DB8:0000:0000:0000:0000:0000:0000/32"],
      ["::ffff:192.0.2.0/120", "::ffff:c000:200/120"],
    ]) {
      expect(() => validateRuleSet(source(values.map(value => ({ type: "ipv6-cidr", value }))))).toThrow("duplicate match");
    }
  });

  test("rejects conflicting resolution options on intersecting networks, in either order", () => {
    const rules: Rule[] = [
      { type: "ipv4-cidr", value: "192.0.2.0/24", options: { no_resolve: true } },
      { type: "ipv4-cidr", value: "192.0.2.1/32", options: { no_resolve: false } },
    ];
    expect(() => validateRuleSet(source(rules))).toThrow("conflicting resolution options");
    expect(() => validateRuleSet(source([...rules].reverse()))).toThrow("conflicting resolution options");
    expect(() => validateRuleSet(source([
      { type: "ipv6-cidr", value: "2001:db8::/32", options: { no_resolve: true } },
      { type: "ipv6-cidr", value: "2001:db8:1::/48" },
    ]))).toThrow("conflicting resolution options");
  });

  test("permits same-policy redundancy and disabled candidates, preserving the author's order", () => {
    const rules: Rule[] = [
      { type: "domain-suffix", value: "example.com" },
      { type: "domain", value: "api.example.com" },
      { type: "ipv4-cidr", value: "192.0.2.0/24", options: { no_resolve: true } },
      { type: "ipv4-cidr", value: "192.0.2.1/32", options: { no_resolve: true } },
      { type: "ipv4-cidr", value: "192.0.2.128/25", enabled: false },
      { type: "ipv6-cidr", value: "::/0" },
    ];
    expect(validateRuleSet(source(rules)).groups[0].rules).toEqual(rules);
  });
});

describe("source directory loading", () => {
  async function fixture(action: (directory: string) => Promise<void>) {
    const directory = await mkdtemp(join(tmpdir(), "rulegen-model-test-"));
    try { await action(directory); } finally { await rm(directory, { recursive: true, force: true }); }
  }

  test("sorts sources and ignores unrelated files", async () => fixture(async directory => {
    await writeFile(join(directory, "z-last.yaml"), stringify(source()));
    await writeFile(join(directory, "a-first.yaml"), stringify(source()));
    await writeFile(join(directory, "README.md"), "Not a rule source");
    expect((await loadRules(directory)).map(({ name }) => name)).toEqual(["a-first", "z-last"]);
  }));

  test("rejects an empty input directory", async () => fixture(async directory => {
    await expect(loadRules(directory)).rejects.toThrow("no YAML rule sets");
  }));

  test("rejects a symlink rather than reading data outside the input directory", async () => fixture(async directory => {
    await writeFile(join(directory, "data.txt"), stringify(source()));
    await symlink(join(directory, "data.txt"), join(directory, "linked.yaml"));
    await expect(loadRules(directory)).rejects.toThrow("no symlinks");
  }));

  for (const filename of ["PrivateSource.yaml", "private-source.yml", "private-source.YAML", "private_source.yaml"]) {
    test(`rejects noncanonical source filename ${filename} without echoing it`, async () => fixture(async directory => {
      await writeFile(join(directory, filename), stringify(source()));
      try { await loadRules(directory); throw new Error("Expected validation error"); }
      catch (error) {
        expect(error).toBeInstanceOf(RuleValidationError);
        expect((error as Error).message).not.toContain(filename);
      }
    }));
  }
});
