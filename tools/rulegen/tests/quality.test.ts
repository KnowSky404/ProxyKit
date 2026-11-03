import { describe, expect, test } from "bun:test";
import { analyzeQuality } from "../src/quality.ts";
import { type Rule, type RuleSet } from "../src/model.ts";

function source(rules: Rule[]): RuleSet {
  return {
    version: 1,
    metadata: { name: "PRIVATE-NAME", author: "PRIVATE-AUTHOR", updated: "2026-01-31", source: "PRIVATE-SOURCE", note: "PRIVATE-TOKEN" },
    groups: [{ name: "PRIVATE-GROUP", comments: ["PRIVATE-COMMENT"], rules }],
  };
}
const domain = (value: string, suffix = false, enabled = true): Rule => ({ type: suffix ? "domain-suffix" : "domain", value, enabled });
const cidr = (value: string, no_resolve = true, enabled = true): Rule => ({ type: value.includes(":") ? "ipv6-cidr" : "ipv4-cidr", value, options: { no_resolve }, enabled });

describe("rule quality relationships", () => {
  test("same-set domain coverage is informational, in either order and across groups", () => {
    const data = source([domain("wise.com", true)]);
    data.groups.push({ name: "Observed endpoints", rules: [domain("api.wise.com"), domain("nested.api.wise.com", true)] });
    const result = analyzeQuality([data]);
    expect(result).toHaveLength(2);
    expect(result.every(d => d.severity === "info" && d.code === "domain-coverage" && d.relation === "left-contains-right")).toBe(true);
    expect(result[0].locations).toEqual([{ source: 0, group: 0, rule: 0 }, { source: 0, group: 1, rule: 0 }]);
    const reverse = source([domain("api.wise.com"), domain("wise.com", true)]);
    expect(analyzeQuality([reverse])[0].relation).toBe("right-contains-left");
  });

  test("exact vs suffix at the same name is containment, not an equivalent matcher", () => {
    const result = analyzeQuality([source([domain("example.com"), domain("example.com", true)])]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ code: "domain-coverage", severity: "info", relation: "right-contains-left" });
  });

  test("cross-set duplicates and containment warn without treating shared dependencies as invalid", () => {
    const result = analyzeQuality([
      source([domain("shared.example"), domain("service.example", true)]),
      source([domain("shared.example"), domain("api.service.example", true)]),
    ]);
    expect(result.map(d => [d.code, d.severity])).toEqual([["exact-duplicate", "warning"], ["domain-coverage", "warning"]]);
    expect(result.every(d => d.severity !== "error")).toBe(true);
  });

  test("domain boundaries and unrelated exact names do not produce overlap", () => {
    const result = analyzeQuality([source([
      domain("example.com", true), domain("badexample.com"), domain("example.com.evil.test"),
      domain("a.service.test"), domain("b.service.test"),
    ])]);
    expect(result).toEqual([]);
  });

  test("covered disabled endpoints are info; a broader candidate warns about expansion", () => {
    expect(analyzeQuality([source([domain("wise.com", true), domain("api.wise.com", false, false)])])[0]).toMatchObject({ code: "domain-coverage", severity: "info" });
    expect(analyzeQuality([source([domain("api.wise.com"), domain("wise.com", true, false)])])[0]).toMatchObject({ code: "domain-coverage", severity: "warning" });
    const cross = analyzeQuality([source([domain("wise.com", true)]), source([domain("other.example"), domain("api.wise.com", false, false)])]);
    expect(cross[0].severity).toBe("warning");
  });

  test("disabled shared candidates alone are informational and never active conflicts", () => {
    const result = analyzeQuality([
      source([domain("one.example"), domain("candidate.example", false, false)]),
      source([domain("two.example"), domain("candidate.example", false, false)]),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ code: "exact-duplicate", severity: "info" });
  });

  test("IPv4 and IPv6 containment, adjacent ranges, and family separation", () => {
    const result = analyzeQuality([source([
      cidr("192.0.2.0/24"), cidr("192.0.2.0/25"), cidr("192.0.3.0/24"),
      cidr("2001:db8::/32"), cidr("2001:db8:1::/48"), cidr("2001:db9::/32"),
    ])]);
    expect(result.map(d => [d.code, d.severity, d.relation])).toEqual([
      ["cidr-overlap", "info", "left-contains-right"], ["cidr-overlap", "info", "left-contains-right"],
    ]);
    expect(analyzeQuality([source([cidr("0.0.0.0/0"), cidr("::/0")])])).toEqual([]);
  });

  test("cross-set CIDRs compare numeric ranges including equivalent IPv6 spelling", () => {
    const result = analyzeQuality([
      source([cidr("2001:db8::/32"), cidr("::ffff:192.0.2.0/120"), cidr("198.51.100.0/24")]),
      source([cidr("2001:0DB8:0000:0000:0000:0000:0000:0000/32"), cidr("::ffff:c000:200/120"), cidr("198.51.100.128/25")]),
    ]);
    expect(result.map(d => [d.code, d.severity])).toEqual([
      ["exact-duplicate", "warning"], ["exact-duplicate", "warning"], ["cidr-overlap", "warning"],
    ]);
  });

  test("cross-set overlapping active CIDRs with differing resolution flags warn", () => {
    const result = analyzeQuality([source([cidr("192.0.2.0/24")]), source([cidr("192.0.2.1/32", false)])]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ code: "resolution-conflict", severity: "warning" });
    const candidate = source([domain("other.example"), cidr("192.0.2.1/32", false, false)]);
    expect(analyzeQuality([source([cidr("192.0.2.0/24")]), candidate])[0].code).toBe("cidr-overlap");
  });

  test("existing strict validator supplies errors for duplicates, invalid data and same-set resolution ambiguity", () => {
    const invalid = [
      source([domain("private.example"), domain("private.example", false, false)]),
      source([cidr("2001:db8::/32"), cidr("2001:0DB8::/32")]),
      source([cidr("192.0.2.0/24"), cidr("192.0.2.1/32", false)]),
      source([domain("BAD.PRIVATE.EXAMPLE")]),
    ];
    const result = analyzeQuality(invalid);
    expect(result).toHaveLength(4);
    expect(result.every(d => d.code === "invalid-source" && d.severity === "error")).toBe(true);
    expect(result[0].message).toContain("groups[0].rules[1]");
    expect(result[1].locations).toEqual([{ source: 1 }]);
  });

  test("diagnostics are deterministic, protect every private field and do not change input", () => {
    const data = [source([domain("private.example", true), domain("api.private.example", false, false), cidr("192.0.2.0/24")]), source([domain("api.private.example"), cidr("192.0.2.1/32")])];
    const before = structuredClone(data);
    const result = analyzeQuality(data);
    expect(analyzeQuality(data)).toEqual(result);
    expect(data).toEqual(before);
    const output = JSON.stringify(result);
    for (const value of ["PRIVATE", "private.example", "192.0.2", "wise.com"]) expect(output).not.toContain(value);
    expect(result.length).toBeGreaterThan(0);
  });
});
