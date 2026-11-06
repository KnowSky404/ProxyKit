import { parseDocument } from "yaml";
import { readdir, readFile, lstat } from "node:fs/promises";
import { isIP } from "node:net";
import { join } from "node:path";

export type Target = "loon" | "quantumultx" | "sing-box";
export type RuleType = "domain" | "domain-suffix" | "ipv4-cidr" | "ipv6-cidr" | "user-agent" | "ip-asn";
export type Rule = {
  type: RuleType;
  value: string;
  enabled?: boolean;
  targets?: Target[];
  comments?: string[];
  options?: { no_resolve?: boolean };
};

export function appliesTo(rule: Rule, target: Target): boolean {
  return rule.targets === undefined || rule.targets.includes(target);
}
export type RuleSet = {
  version: 1;
  metadata: { name: string; author: string; updated: string; source: string; note: string };
  compatibility?: {
    quantumultx_no_resolve?: "legacy-policy-token";
    sing_box_no_resolve?: "require-no-pre-resolution";
  };
  groups: { name: string; comments?: string[]; rules: Rule[] }[];
};

// Messages contain schema locations/ordinals only: never echo private YAML values.
export class RuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleValidationError";
  }
}
function fail(path: string, reason: string): never {
  throw new RuleValidationError(`${path}: ${reason}`);
}
function object(value: unknown, path: string, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected object");
  const obj = value as Record<string, unknown>;
  if (Object.keys(obj).some(key => !keys.includes(key))) fail(path, "unknown field");
  return obj;
}
function text(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !value.trim() || /[\x00-\x1f\x7f\u2028\u2029]/.test(value)) {
    fail(path, "expected nonempty single-line string");
  }
}
function comments(value: unknown, path: string) {
  if (value === undefined) return;
  if (!Array.isArray(value)) fail(path, "expected string array");
  value.forEach((item, i) => text(item, `${path}[${i}]`));
}
function domain(value: string, path: string) {
  if (value.length > 253 || value !== value.toLowerCase() || isIP(value)) fail(path, "invalid canonical domain");
  const labels = value.split(".");
  if (labels.length < 2 || /^\d+$/.test(labels.at(-1)!)) fail(path, "invalid canonical domain");
  if (labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    fail(path, "invalid canonical domain");
  }
}
export function ipNumber(value: string): bigint {
  if (isIP(value) === 4) return value.split(".").reduce((n, part) => (n << 8n) | BigInt(part), 0n);
  // Expand an embedded IPv4 tail before expanding the IPv6 :: abbreviation.
  if (value.includes(".")) {
    const colon = value.lastIndexOf(":");
    const v4 = ipNumber(value.slice(colon + 1));
    value = `${value.slice(0, colon)}:${(v4 >> 16n).toString(16)}:${(v4 & 65535n).toString(16)}`;
  }
  const halves = value.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const parts = halves.length === 2 ? [...left, ...Array(8 - left.length - right.length).fill("0"), ...right] : left;
  return parts.reduce((n, part) => (n << 16n) | BigInt(`0x${part}`), 0n);
}
type Network = { address: bigint; prefix: number; bits: number };
function cidr(value: string, family: 4 | 6, path: string): Network {
  const parts = value.split("/");
  const bits = family === 4 ? 32 : 128;
  if (parts.length !== 2 || !/^(0|[1-9]\d*)$/.test(parts[1]) || isIP(parts[0]) !== family || parts[0].includes("%")) {
    fail(path, "invalid CIDR");
  }
  const prefix = Number(parts[1]);
  if (prefix > bits) fail(path, "invalid CIDR prefix");
  const address = ipNumber(parts[0]);
  if ((address >> BigInt(bits - prefix)) << BigInt(bits - prefix) !== address) fail(path, "CIDR contains host bits");
  return { address, prefix, bits };
}

export function validateRuleSet(value: unknown): RuleSet {
  const root = object(value, "source", ["version", "metadata", "compatibility", "groups"]);
  if (root.version !== 1) fail("version", "unsupported schema version");
  const meta = object(root.metadata, "metadata", ["name", "author", "updated", "source", "note"]);
  for (const key of ["name", "author", "updated", "source", "note"]) text(meta[key], `metadata.${key}`);
  const updated = meta.updated as string;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updated) || !Number.isFinite(Date.parse(updated)) || new Date(updated).toISOString().slice(0, 10) !== updated) {
    fail("metadata.updated", "expected calendar date YYYY-MM-DD (quoted)");
  }
  if (root.compatibility !== undefined) {
    const compat = object(root.compatibility, "compatibility", ["quantumultx_no_resolve", "sing_box_no_resolve"]);
    if (compat.quantumultx_no_resolve !== undefined && compat.quantumultx_no_resolve !== "legacy-policy-token") fail("compatibility.quantumultx_no_resolve", "unsupported compatibility mode");
    if (compat.sing_box_no_resolve !== undefined && compat.sing_box_no_resolve !== "require-no-pre-resolution") fail("compatibility.sing_box_no_resolve", "unsupported compatibility mode");
  }
  if (!Array.isArray(root.groups) || !root.groups.length) fail("groups", "expected nonempty array");
  const seen = new Set<string>();
  const networks: (Network & { resolve: boolean; rule: Rule })[] = [];
  let active = 0;
  root.groups.forEach((entry, g) => {
    const gp = `groups[${g}]`;
    const group = object(entry, gp, ["name", "comments", "rules"]);
    text(group.name, `${gp}.name`);
    comments(group.comments, `${gp}.comments`);
    if (!Array.isArray(group.rules) || !group.rules.length) fail(`${gp}.rules`, "expected nonempty array");
    group.rules.forEach((entry, r) => {
      const rp = `${gp}.rules[${r}]`;
      const rule = object(entry, rp, ["type", "value", "enabled", "targets", "comments", "options"]);
      if (!["domain", "domain-suffix", "ipv4-cidr", "ipv6-cidr", "user-agent", "ip-asn"].includes(rule.type as string)) fail(`${rp}.type`, "unsupported rule type");
      text(rule.value, `${rp}.value`);
      if (rule.enabled !== undefined && typeof rule.enabled !== "boolean") fail(`${rp}.enabled`, "expected boolean");
      if (rule.targets !== undefined && (!Array.isArray(rule.targets) || !rule.targets.length ||
        rule.targets.some(target => !["loon", "quantumultx", "sing-box"].includes(target)) || new Set(rule.targets).size !== rule.targets.length)) {
        fail(`${rp}.targets`, "expected distinct supported clients in a nonempty array");
      }
      comments(rule.comments, `${rp}.comments`);
      const isCidr = (rule.type as string).endsWith("-cidr");
      let noResolve = false;
      if (rule.options !== undefined) {
        const opts = object(rule.options, `${rp}.options`, ["no_resolve"]);
        if (opts.no_resolve !== undefined && typeof opts.no_resolve !== "boolean") fail(`${rp}.options.no_resolve`, "expected boolean");
        if (!isCidr && rule.type !== "ip-asn") fail(`${rp}.options`, "IP options require CIDR or ASN rule");
        noResolve = opts.no_resolve === true;
      }
      let key = `${rule.type}:${rule.value}`;
      if (isCidr) {
        const network = cidr(rule.value, rule.type === "ipv4-cidr" ? 4 : 6, `${rp}.value`);
        key = `${rule.type}:${network.address}/${network.prefix}`;
        if (rule.enabled !== false) {
          for (const other of networks) {
            if (!["loon", "quantumultx", "sing-box"].some(target => appliesTo(rule as Rule, target as Target) && appliesTo(other.rule, target as Target))) continue;
            const shift = BigInt(network.bits - Math.min(network.prefix, other.prefix));
            if (network.bits === other.bits && network.address >> shift === other.address >> shift && other.resolve !== noResolve) {
              fail(rp, "overlapping CIDRs have conflicting resolution options");
            }
          }
          networks.push({ ...network, resolve: noResolve, rule: rule as Rule });
        }
      } else if (rule.type === "ip-asn") {
        if (!/^[1-9]\d*$/.test(rule.value) || Number(rule.value) > 4294967295) fail(`${rp}.value`, "expected canonical ASN in 1..4294967295");
      } else if (rule.type === "user-agent") {
        if (!/^[\x21-\x2b\x2d-\x7e]+$/.test(rule.value)) fail(`${rp}.value`, "expected printable ASCII pattern without whitespace or commas");
      } else domain(rule.value, `${rp}.value`);
      if (seen.has(key)) fail(rp, "duplicate match (including disabled candidates)");
      seen.add(key);
      if (rule.enabled !== false) active++;
    });
  });
  if (!active) fail("groups", "rule set must contain an enabled rule");
  return value as RuleSet;
}

export function parseRuleSet(source: string): RuleSet {
  let parsed: unknown;
  try {
    const document = parseDocument(source, { uniqueKeys: true, strict: true });
    if (document.errors.length || document.warnings.length) fail("source", "invalid YAML");
    parsed = document.toJS({ maxAliasCount: 0 });
  }
  catch { fail("source", "invalid YAML"); }
  return validateRuleSet(parsed);
}

export async function loadRules(directory: string): Promise<{ name: string; data: RuleSet }[]> {
  let names: string[];
  try { names = (await readdir(directory)).filter(name => /\.ya?ml$/i.test(name)).sort(); }
  catch { fail("input", "cannot read source directory"); }
  if (!names.length) fail("input", "no YAML rule sets found");
  const seen = new Set<string>();
  const results = [];
  for (const [i, filename] of names.entries()) {
    const name = filename.replace(/\.ya?ml$/i, "");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || !/\.yaml$/.test(filename)) fail(`source[${i}]`, "expected lowercase kebab-case .yaml filename");
    if (seen.has(name)) fail(`source[${i}]`, "duplicate source filename");
    seen.add(name);
    let source: string;
    try {
      const path = join(directory, filename);
      if (!(await lstat(path)).isFile()) fail(`source[${i}]`, "expected regular YAML file (no symlinks)");
      source = await readFile(path, "utf8");
    } catch (error) {
      if (error instanceof RuleValidationError) throw error;
      fail(`source[${i}]`, "cannot read YAML file");
    }
    try { results.push({ name, data: parseRuleSet(source) }); }
    catch (error) {
      if (error instanceof RuleValidationError) fail(`source[${i}]`, error.message);
      throw error;
    }
  }
  return results;
}
