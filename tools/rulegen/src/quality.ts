import { appliesTo, ipNumber, RuleValidationError, validateRuleSet, type Rule, type RuleSet } from "./model.ts";

export type RuleLocation = { source: number; group?: number; rule?: number };
export type QualityDiagnostic = {
  severity: "error" | "warning" | "info";
  code: "invalid-source" | "exact-duplicate" | "domain-coverage" | "cidr-overlap" | "resolution-conflict";
  locations: RuleLocation[];
  relation?: "equal" | "left-contains-right" | "right-contains-left";
  message: string;
};

type Entry = { location: RuleLocation; rule: Rule; network?: { address: bigint; prefix: number; bits: number } };
type Relation = NonNullable<QualityDiagnostic["relation"]>;

function relation(left: Entry, right: Entry): Relation | undefined {
  const a = left.rule;
  const b = right.rule;
  if (!(["loon", "quantumultx", "sing-box"] as const).some(target => appliesTo(a, target) && appliesTo(b, target))) return;
  if (left.network || right.network) {
    if (!left.network || !right.network || left.network.bits !== right.network.bits) return;
    const x = left.network;
    const y = right.network;
    const shift = BigInt(x.bits - Math.min(x.prefix, y.prefix));
    if (x.address >> shift !== y.address >> shift) return;
    return x.prefix === y.prefix ? "equal" : x.prefix < y.prefix ? "left-contains-right" : "right-contains-left";
  }
  if (a.type === b.type && a.value === b.value) return "equal";
  if (!["domain", "domain-suffix"].includes(a.type) || !["domain", "domain-suffix"].includes(b.type)) return;
  const within = (value: string, suffix: string) => value === suffix || value.endsWith(`.${suffix}`);
  if (a.type === "domain-suffix" && within(b.value, a.value)) return "left-contains-right";
  if (b.type === "domain-suffix" && within(a.value, b.value)) return "right-contains-left";
}

function severity(left: Entry, right: Entry, overlap: Relation): "warning" | "info" {
  const a = left.rule.enabled !== false;
  const b = right.rule.enabled !== false;
  if (!a && !b) return "info"; // Candidates alone cannot affect routing.
  if (left.location.source !== right.location.source) return "warning";
  if (a && b) return "info"; // A set selects one policy, so containment is valid.
  // An enabled superset already covers the documented candidate. Enabling a
  // broader candidate, however, would expand the active match set.
  const covered = (a && overlap === "left-contains-right") || (b && overlap === "right-contains-left");
  const active = a ? left.rule : right.rule;
  const candidate = a ? right.rule : left.rule;
  if (covered && (["loon", "quantumultx", "sing-box"] as const).every(target => !appliesTo(candidate, target) || appliesTo(active, target))) return "info";
  return "warning";
}

/**
 * Diagnose local match-set relationships without changing rules or assuming a
 * subscription order, outbound policy, DNS evaluation or client configuration.
 * All returned data is safe to log: locations are zero-based array ordinals,
 * messages are fixed labels, and no names, values, comments or paths are copied.
 * Invalid sources use the existing strict validator and are excluded from pairs.
 */
export function analyzeQuality(sets: readonly RuleSet[]): QualityDiagnostic[] {
  const diagnostics: QualityDiagnostic[] = [];
  const entries: Entry[] = [];
  for (const [source, set] of sets.entries()) {
    try { validateRuleSet(set); }
    catch (error) {
      if (!(error instanceof RuleValidationError)) throw error;
      diagnostics.push({ severity: "error", code: "invalid-source", locations: [{ source }], message: error.message });
      continue;
    }
    set.groups.forEach((group, g) => group.rules.forEach((rule, r) => {
      const entry: Entry = { location: { source, group: g, rule: r }, rule };
      if (rule.type.endsWith("-cidr")) {
        const [address, prefix] = rule.value.split("/");
        entry.network = { address: ipNumber(address), prefix: Number(prefix), bits: rule.type === "ipv4-cidr" ? 32 : 128 };
      }
      entries.push(entry);
    }));
  }
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const left = entries[i];
      const right = entries[j];
      const overlap = relation(left, right);
      if (!overlap) continue;
      const conflict = left.network && left.rule.enabled !== false && right.rule.enabled !== false
        && (left.rule.options?.no_resolve === true) !== (right.rule.options?.no_resolve === true);
      const code: QualityDiagnostic["code"] = conflict ? "resolution-conflict" : overlap === "equal" ? "exact-duplicate"
        : left.network ? "cidr-overlap" : "domain-coverage";
      const messages: Record<Exclude<QualityDiagnostic["code"], "invalid-source">, string> = {
        "exact-duplicate": "Equivalent match conditions; assess subscription policy and enabled state.",
        "domain-coverage": "Domain condition contains another condition; containment can be intentional.",
        "cidr-overlap": "CIDR ranges overlap; containment can be intentional.",
        "resolution-conflict": "Active overlapping CIDRs use different resolution options across sets; assess integration order.",
      };
      diagnostics.push({ severity: severity(left, right, overlap), code, locations: [left.location, right.location], relation: overlap, message: messages[code] });
    }
  }
  return diagnostics;
}
