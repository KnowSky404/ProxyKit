import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ipNumber } from "./model.ts";

// A compiler change may change bytes even when source schema compatibility is retained.
export const SING_BOX_VERSION = "1.14.4";
export const SING_BOX_MIN_READER = "1.10.0";

export class CompilerError extends Error {
  override name = "CompilerError";
}

function safeFailureReason(stderr: string): string {
  // Match official error prefixes, never arbitrary substrings from private values.
  // Return only fixed labels; no captured source text or filesystem path escapes.
  const plain = stderr.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  const message = plain.split("\n").map(line => /^FATAL\[\d+\] (.*)$/.exec(line)?.[1]).find(Boolean);
  if (!message) return "unclassified compiler error";
  if (/^unknown rule-set version: \d+$/.test(message)) return "unsupported source rule-set version";
  if (/^version: json: cannot unmarshal /.test(message)) return "invalid source version field";
  if (/^(?:unexpected EOF|unexpected end of JSON input)(?:: row \d+, column \d+)?$/.test(message)) return "incomplete source JSON";
  if (/^invalid character '/.test(message)) return "invalid source JSON";
  if (/^ipcidr: parse \[\d+\]: netip\.ParsePrefix\(/.test(message)) return "invalid IP CIDR matcher";
  if (/^rules\[\d+\](?:\.[a-z_]+)*: json: (?:unknown field|cannot unmarshal) /.test(message)) return "invalid source rule field";
  if (/^(?:open|create|write) .+: permission denied$/.test(message)) return "compiler filesystem permission denied";
  if (/^open .+: no such file or directory$/.test(message)) return "compiler input or output path unavailable";
  if (/^write .+: no space left on device$/.test(message)) return "compiler output device is full";
  return "unclassified compiler error";
}

function execute(executable: string, args: string[], operation: string): string {
  // Never surface child stderr: official tools can include private match values and paths.
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error) {
    const code = (result.error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") throw new CompilerError("sing-box CLI not found; install the pinned compiler or pass --sing-box.");
    if (code === "ETIMEDOUT") throw new CompilerError(`sing-box ${operation} timed out.`);
    throw new CompilerError(`sing-box ${operation} could not be started.`);
  }
  if (result.status !== 0) {
    const status = result.status === null ? "terminated" : `exit ${result.status}`;
    throw new CompilerError(`sing-box ${operation} failed (${status}): ${safeFailureReason(result.stderr)}; child output withheld to protect rule data.`);
  }
  return result.stdout;
}

export function checkCompiler(executable = "sing-box"): void {
  const version = execute(executable, ["version"], "version check").match(/^sing-box version (\S+)/m)?.[1];
  if (version !== SING_BOX_VERSION) {
    throw new CompilerError(`Use sing-box ${SING_BOX_VERSION} exactly for reproducible artifacts (reader minimum ${SING_BOX_MIN_READER}).`);
  }
}

function canonicalCidrs(values: unknown[]): string[] {
  // The official IP set coalesces adjacent and overlapping prefixes in a shared array.
  // Compare their address unions per family without widening gaps or mixing IPv4/IPv6.
  const ranges = values.map(value => {
    if (typeof value !== "string") throw new CompilerError("sing-box SRS verification returned invalid CIDR data.");
    const [address, prefix] = value.split("/");
    const bits = address.includes(":") ? 128 : 32;
    const shift = BigInt(bits - Number(prefix ?? bits));
    const start = (ipNumber(address) >> shift) << shift;
    return { bits, start, end: start + (1n << shift) - 1n };
  }).sort((a, b) => a.bits - b.bits || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const merged: typeof ranges = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && previous.bits === range.bits && range.start <= previous.end + 1n) {
      if (range.end > previous.end) previous.end = range.end;
    } else merged.push({ ...range });
  }
  return merged.map(range => `${range.bits}:${range.start.toString(16)}-${range.end.toString(16)}`);
}

function canonical(value: unknown, field = ""): unknown {
  // The official decoder collapses singleton matcher arrays into scalars.
  if (["domain", "domain_suffix", "ip_cidr"].includes(field)) {
    const values = Array.isArray(value) ? value : [value];
    return field === "ip_cidr" ? canonicalCidrs(values) : values.sort();
  }
  if (Array.isArray(value)) return value.map((item) => canonical(item));
  if (value && typeof value === "object") {
    const normalized: Record<string, unknown> = { ...value };
    if (normalized.domain !== undefined && normalized.domain_suffix !== undefined) {
      // The official domain trie combines an exact name with its identical suffix.
      // Only the same root is redundant; do not expand an exact-only domain to a suffix.
      const domains = Array.isArray(normalized.domain) ? normalized.domain : [normalized.domain];
      const suffixes = Array.isArray(normalized.domain_suffix) ? normalized.domain_suffix : [normalized.domain_suffix];
      const remaining = domains.filter(domain => !suffixes.includes(domain));
      if (remaining.length) normalized.domain = remaining;
      else delete normalized.domain;
    }
    return Object.fromEntries(Object.entries(normalized).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item, key)]));
  }
  return value;
}

/** Compile with the official CLI and prove the SRS decodes to the source matchers. */
export function compileSrs(source: string, executable = "sing-box"): Uint8Array {
  const directory = mkdtempSync(join(tmpdir(), "proxykit-rulegen-"));
  try {
    const input = join(directory, "source.json");
    const output = join(directory, "rules.srs");
    const decoded = join(directory, "decoded.json");
    writeFileSync(input, source, { mode: 0o600 });
    execute(executable, ["rule-set", "compile", "--output", output, input], "compilation");
    execute(executable, ["rule-set", "decompile", "--output", decoded, output], "SRS verification");
    let actual: unknown;
    let expected: unknown;
    try {
      actual = JSON.parse(readFileSync(decoded, "utf8"));
      expected = JSON.parse(source);
    } catch {
      throw new CompilerError("sing-box SRS verification returned unreadable source data.");
    }
    if (JSON.stringify(canonical(actual)) !== JSON.stringify(canonical(expected))) {
      throw new CompilerError("sing-box SRS round-trip changed the source matchers; no artifacts were written.");
    }
    return readFileSync(output);
  } catch (error) {
    if (error instanceof CompilerError) throw error;
    throw new CompilerError("sing-box compilation or SRS verification could not read or write temporary files.");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
