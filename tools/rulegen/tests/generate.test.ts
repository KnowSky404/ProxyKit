import { describe, expect, test } from "bun:test";
import { renderList, renderSingBox, validateTarget } from "../src/generate.ts";
import { RuleValidationError, validateRuleSet, type RuleSet } from "../src/model.ts";

function fixture(): RuleSet {
  return validateRuleSet({
    version: 1,
    metadata: { name: "Fixture", author: "ProxyKit", updated: "2026-01-31", source: "Public fixture", note: "Preserve matchers" },
    compatibility: { quantumultx_no_resolve: "legacy-policy-token", sing_box_no_resolve: "require-no-pre-resolution" },
    groups: [
      {
        name: "Domains", comments: ["Exact and suffix matches"], rules: [
          { type: "domain", value: "api.example.com", comments: ["Exact first"] },
          { type: "domain-suffix", value: "example.net" },
          { type: "domain", value: "candidate.example.org", enabled: false, comments: ["Disabled candidate stays documented"] },
        ],
      },
      {
        name: "Networks", rules: [
          { type: "ipv4-cidr", value: "192.0.2.0/24", options: { no_resolve: true } },
          { type: "ipv6-cidr", value: "2001:db8::/32", options: { no_resolve: true } },
          { type: "ipv6-cidr", value: "2001:db9::/32", enabled: false, options: { no_resolve: false } },
        ],
      },
    ],
  });
}

describe("client formats and source order", () => {
  test("Loon maps all supported match types and preserves disabled comments and group boundaries", () => {
    expect(renderList(fixture(), "loon")).toBe(`# NAME: Fixture
# AUTHOR: ProxyKit
# UPDATED: 2026-01-31
# SOURCE: Public fixture
# NOTE: Preserve matchers

# Domains
# Exact and suffix matches
# Exact first
DOMAIN,api.example.com
DOMAIN-SUFFIX,example.net
# Disabled candidate stays documented
# DOMAIN,candidate.example.org

# Networks
IP-CIDR,192.0.2.0/24,no-resolve
IP-CIDR6,2001:db8::/32,no-resolve
# IP-CIDR6,2001:db9::/32
`);
  });

  test("Quantumult X has its own IPv6 keyword and explicit legacy policy token", () => {
    const text = renderList(fixture(), "quantumultx");
    expect(text).toContain("HOST,api.example.com\nHOST-SUFFIX,example.net\n");
    expect(text).toContain("# HOST,candidate.example.org\n");
    expect(text).toContain("IP-CIDR,192.0.2.0/24,no-resolve\nIP6-CIDR,2001:db8::/32,no-resolve\n");
    expect(text).toContain("# IP6-CIDR,2001:db9::/32\n");
    expect(text).not.toContain("DOMAIN");
    expect(text).not.toContain("IP-CIDR6");
  });

  test("normalizing only client syntax produces identical comments, flags, order and candidates", () => {
    const qx = renderList(fixture(), "quantumultx")
      .replaceAll("HOST-SUFFIX,", "DOMAIN-SUFFIX,")
      .replaceAll("HOST,", "DOMAIN,")
      .replaceAll("IP6-CIDR,", "IP-CIDR6,");
    expect(qx).toBe(renderList(fixture(), "loon"));
  });

  test("sing-box uses version 2 with OR destination fields in one default rule", () => {
    const output = renderSingBox(fixture());
    expect(JSON.parse(output)).toEqual({
      version: 2,
      rules: [{
        domain: ["api.example.com"],
        domain_suffix: ["example.net"],
        ip_cidr: ["192.0.2.0/24", "2001:db8::/32"],
      }],
    });
    // No leading dot: sing-box must match both example.net and its subdomains.
    expect(output).not.toContain('".example.net"');
    expect(output).not.toContain("candidate.example.org");
    expect(output).not.toContain("2001:db9");
    expect(output).not.toContain("no_resolve");
    expect(output.endsWith("\n")).toBe(true);
  });

  test("sing-box combines interleaved groups while preserving each field's source order", () => {
    const data = fixture();
    data.groups[0].rules.unshift({ type: "ipv6-cidr", value: "2001:db7::/32", options: { no_resolve: true } });
    data.groups[1].rules.splice(1, 0,
      { type: "domain", value: "other.example.com" },
      { type: "domain-suffix", value: "other.example.net" },
    );
    data.groups[1].rules.push({ type: "ipv4-cidr", value: "198.51.100.0/24", options: { no_resolve: true } });
    expect(JSON.parse(renderSingBox(data)).rules).toEqual([{
      domain: ["api.example.com", "other.example.com"],
      domain_suffix: ["example.net", "other.example.net"],
      ip_cidr: ["2001:db7::/32", "192.0.2.0/24", "2001:db8::/32", "198.51.100.0/24"],
    }]);
  });

  test("sing-box omits empty domain fields for an IP-only set", () => {
    const data = fixture();
    data.groups = [data.groups[1]];
    expect(JSON.parse(renderSingBox(data)).rules).toEqual([{ ip_cidr: ["192.0.2.0/24", "2001:db8::/32"] }]);
  });

  test("Loon resolution-enabled networks have no no-resolve token", () => {
    const data = fixture();
    data.groups[1].rules[0].options!.no_resolve = false;
    expect(renderList(data, "loon")).toContain("IP-CIDR,192.0.2.0/24\n");
    expect(renderList(data, "quantumultx")).toContain("IP-CIDR,192.0.2.0/24\n");
  });

  test("each render is deterministic and leaves the canonical model unchanged", () => {
    const data = fixture();
    const original = structuredClone(data);
    for (let i = 0; i < 3; i++) {
      expect(renderList(data, "loon")).toBe(renderList(original, "loon"));
      expect(renderList(data, "quantumultx")).toBe(renderList(original, "quantumultx"));
      expect(renderSingBox(data)).toBe(renderSingBox(original));
    }
    expect(data).toEqual(original);
  });
});

describe("explicit handling of resolution semantics", () => {
  test("Quantumult X refuses undocumented no-resolve translation without legacy acknowledgement", () => {
    const data = fixture();
    delete data.compatibility!.quantumultx_no_resolve;
    expect(() => validateTarget(data, "quantumultx")).toThrow(RuleValidationError);
    expect(() => renderList(data, "quantumultx")).toThrow("legacy-policy-token");
    expect(() => renderList(data, "loon")).not.toThrow();
    expect(() => renderSingBox(data)).not.toThrow();
  });

  test("even a disabled Quantumult X candidate requires acknowledgement before preserving the legacy token", () => {
    const data = fixture();
    data.groups[1].rules.forEach(rule => { rule.enabled = false; });
    delete data.compatibility!.quantumultx_no_resolve;
    expect(() => renderList(data, "quantumultx")).toThrow("legacy-policy-token");
  });

  test("sing-box refuses no-resolve loss without an integration contract", () => {
    const data = fixture();
    delete data.compatibility!.sing_box_no_resolve;
    expect(() => renderSingBox(data)).toThrow("require-no-pre-resolution");
    expect(() => renderList(data, "loon")).not.toThrow();
  });

  test("sing-box refuses implicit or explicit resolve-on-match rather than silently changing it", () => {
    for (const options of [undefined, { no_resolve: false }]) {
      const data = fixture();
      data.groups[1].rules[0].options = options;
      expect(() => renderSingBox(data)).toThrow("cannot embed Loon resolve-on-match");
    }
  });

  test("disabled networks do not impose resolution behavior on an active domain-only sing-box set", () => {
    const data = fixture();
    data.groups[1].rules.forEach(rule => { rule.enabled = false; });
    delete data.compatibility;
    expect(JSON.parse(renderSingBox(data)).rules).toEqual([
      { domain: ["api.example.com"], domain_suffix: ["example.net"] },
    ]);
  });
});
