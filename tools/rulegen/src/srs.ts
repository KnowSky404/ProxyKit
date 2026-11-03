import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A compiler change may change bytes even when source schema compatibility is retained.
export const SING_BOX_VERSION = "1.10.7";
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
  if (/^(?:unexpected EOF|unexpected end of JSON input)$/.test(message)) return "incomplete source JSON";
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

function canonical(value: unknown, field = ""): unknown {
  // The official decoder collapses singleton matcher arrays into scalars.
  if (["domain", "domain_suffix", "ip_cidr"].includes(field)) {
    const values = Array.isArray(value) ? value : [value];
    return values.map((item) => {
      if (field !== "ip_cidr" || typeof item !== "string" || !item.includes(":")) return item;
      const [address, prefix] = item.split("/");
      return `${new URL(`http://[${address}]`).hostname.slice(1, -1)}/${prefix}`;
    }).sort();
  }
  if (Array.isArray(value)) return value.map((item) => canonical(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item, key)]));
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
