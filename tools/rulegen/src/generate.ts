import { appliesTo, RuleValidationError, type RuleSet, type RuleType, type Target } from "./model.ts";

export type { Target } from "./model.ts";
const types: Record<"loon" | "quantumultx", Record<RuleType, string>> = {
  loon: { domain: "DOMAIN", "domain-suffix": "DOMAIN-SUFFIX", "ipv4-cidr": "IP-CIDR", "ipv6-cidr": "IP-CIDR6", "user-agent": "USER-AGENT", "ip-asn": "IP-ASN" },
  quantumultx: { domain: "HOST", "domain-suffix": "HOST-SUFFIX", "ipv4-cidr": "IP-CIDR", "ipv6-cidr": "IP6-CIDR", "user-agent": "USER-AGENT", "ip-asn": "IP-ASN" },
};

export function validateTarget(set: RuleSet, target: Target): void {
  if (!set.groups.some(group => group.rules.some(rule => rule.enabled !== false && appliesTo(rule, target)))) {
    throw new RuleValidationError(`${target}: rule set must contain an enabled rule for this client`);
  }
  for (const [g, group] of set.groups.entries()) {
    for (const [r, rule] of group.rules.entries()) {
      if (!appliesTo(rule, target)) continue;
      const path = `groups[${g}].rules[${r}].options`;
      if (target === "sing-box" && ["user-agent", "ip-asn"].includes(rule.type)) {
        throw new RuleValidationError(`groups[${g}].rules[${r}].type: sing-box has no User-Agent or ASN rule-set predicate; restrict targets explicitly`);
      }
      if (target === "quantumultx" && rule.options?.no_resolve && set.compatibility?.quantumultx_no_resolve !== "legacy-policy-token") {
        throw new RuleValidationError(`${path}: Quantumult X has no documented no-resolve flag; explicit legacy-policy-token compatibility required`);
      }
      if (target === "sing-box" && rule.enabled !== false && rule.type.endsWith("-cidr")) {
        if (!rule.options?.no_resolve) {
          throw new RuleValidationError(`${path}: sing-box cannot embed Loon resolve-on-match; explicit no_resolve required`);
        }
        if (set.compatibility?.sing_box_no_resolve !== "require-no-pre-resolution") {
          throw new RuleValidationError(`${path}: sing-box requires explicit require-no-pre-resolution integration contract`);
        }
      }
    }
  }
}

export function renderList(set: RuleSet, target: "loon" | "quantumultx"): string {
  validateTarget(set, target);
  const lines = [
    `# NAME: ${set.metadata.name}`,
    `# AUTHOR: ${set.metadata.author}`,
    `# UPDATED: ${set.metadata.updated}`,
    `# SOURCE: ${set.metadata.source}`,
    `# NOTE: ${set.metadata.note}`,
  ];
  for (const group of set.groups) {
    lines.push("", `# ${group.name}`, ...(group.comments ?? []).map(comment => `# ${comment}`));
    for (const rule of group.rules) {
      lines.push(...(rule.comments ?? []).map(comment => `# ${comment}`));
      if (!appliesTo(rule, target)) {
        lines.push(`# Not emitted for ${target}: ${rule.type}; targets=${rule.targets!.join(",")}.`);
        continue;
      }
      const flag = rule.options?.no_resolve ? ",no-resolve" : "";
      lines.push(`${rule.enabled === false ? "# " : ""}${types[target][rule.type]},${rule.value}${flag}`);
    }
  }
  return lines.join("\n") + "\n";
}

export function renderSingBox(set: RuleSet): string {
  validateTarget(set, "sing-box");
  const combined = { domain: [] as string[], domain_suffix: [] as string[], ip_cidr: [] as string[] };
  const fields: Partial<Record<RuleType, keyof typeof combined>> = { domain: "domain", "domain-suffix": "domain_suffix", "ipv4-cidr": "ip_cidr", "ipv6-cidr": "ip_cidr" };
  // These destination-address fields share OR semantics in one default rule.
  // Preserve source order within each array, including mixed IPv4/IPv6 CIDRs.
  // JSON/SRS cannot encode comments, disabled rules or resolution policy.
  for (const group of set.groups) {
    for (const rule of group.rules) {
      if (rule.enabled !== false && appliesTo(rule, "sing-box")) combined[fields[rule.type]!].push(rule.value);
    }
  }
  const rule = Object.fromEntries(Object.entries(combined).filter(([, values]) => values.length > 0));
  return JSON.stringify({ version: 2, rules: [rule] }, null, 2) + "\n";
}
