#!/usr/bin/env bun
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { loadRules, RuleValidationError } from "./model";
import { renderList, renderSingBox, validateTarget } from "./generate";
import { checkCompiler, compileSrs, CompilerError, SING_BOX_VERSION } from "./srs";

type Target = "loon" | "quantumultx" | "sing-box";
type Command = "build" | "validate" | "check";
const targets: Target[] = ["loon", "quantumultx", "sing-box"];
const repository = fileURLToPath(new URL("../../../", import.meta.url));
const directories: Record<Target, string> = { loon: "loon/rules", quantumultx: "quantumultx/filters", "sing-box": "sing-box/rules" };

const help = `ProxyKit rulegen — build deterministic client rules from local YAML

Usage: bun /path/to/tools/rulegen/src/cli.ts [build|validate|check] [options]

Commands:
  build       Validate and generate all selected client artifacts (default).
  validate    Validate YAML and selected target semantics; write no files.
  check       Rebuild in memory and fail on missing, stale or changed artifacts.

Options:
  --input DIR       YAML source directory (default: generator repo/shared/rules).
  --output DIR      Output root containing client subdirectories (default: generator repo).
  --target CLIENTS  Comma-separated loon,quantumultx,sing-box or all (default: all).
  --sing-box PATH   Official sing-box ${SING_BOX_VERSION} executable (default: sing-box in PATH).
  -h, --help        Show this help.

Explicit relative paths resolve against the caller's working directory.
The CLI never downloads sources or tools. sing-box builds include JSON and SRS.
Build manages .list in loon/rules and quantumultx/filters, .json/.srs in sing-box/rules;
stale files with these extensions are removed. Use a dedicated output root.
Diagnostics omit rule values, source filenames and child-process output.
`;

class CliError extends Error {}

interface Options {
  command: Command;
  input: string;
  output: string;
  targets: Target[];
  compiler: string;
}

function parse(args: string[]): Options {
  const options: Options = { command: "build", input: join(repository, "shared/rules"), output: repository, targets: [...targets], compiler: "sing-box" };
  const first = args[0];
  if (first && !first.startsWith("-")) {
    if (!["build", "validate", "check"].includes(first)) throw new CliError("Unknown command; use --help.");
    options.command = args.shift() as Command;
  }
  const seen = new Set<string>();
  while (args.length) {
    const raw = args.shift()!;
    const equals = raw.indexOf("=");
    const flag = equals < 0 ? raw : raw.slice(0, equals);
    if (!["--input", "--output", "--target", "--sing-box"].includes(flag)) throw new CliError("Unknown option; use --help.");
    if (seen.has(flag)) throw new CliError("Options must not be repeated; use --help.");
    seen.add(flag);
    const value = equals < 0 ? args.shift() : raw.slice(equals + 1);
    if (!value || value.startsWith("--")) throw new CliError("An option value is missing; use --help.");
    if (flag === "--input") options.input = resolve(value);
    else if (flag === "--output") options.output = resolve(value);
    else if (flag === "--sing-box") options.compiler = value.includes("/") ? resolve(value) : value;
    else {
      const requested = value === "all" ? [...targets] : value.split(",");
      if (!requested.length || requested.some((target) => !targets.includes(target as Target)) || new Set(requested).size !== requested.length) {
        throw new CliError("Choose distinct targets from loon,quantumultx,sing-box, or all.");
      }
      options.targets = targets.filter((target) => requested.includes(target));
    }
  }
  return options;
}

async function statIfExists(path: string) {
  try { return await lstat(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function managed(target: Target, name: string): boolean {
  return target === "sing-box" ? /\.(?:json|srs)$/.test(name) : name.endsWith(".list");
}

async function existingArtifacts(options: Options): Promise<string[]> {
  const artifacts: string[] = [];
  const rootInfo = await statIfExists(options.output);
  if (rootInfo && (!rootInfo.isDirectory() || rootInfo.isSymbolicLink())) throw new CliError("Output root must be a real directory.");
  for (const target of options.targets) {
    const directory = join(options.output, directories[target]);
    // Inspect intermediate client directories too, including a symlink whose rules child is absent.
    let cursor = options.output;
    let present = true;
    for (const component of directories[target].split("/")) {
      cursor = join(cursor, component);
      const info = await statIfExists(cursor);
      if (!info) { present = false; break; }
      if (!info.isDirectory() || info.isSymbolicLink()) throw new CliError("Client output directories must be real directories.");
    }
    if (!present) continue;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!managed(target, entry.name)) continue;
      if (!entry.isFile()) throw new CliError("Managed artifact paths must be regular files.");
      artifacts.push(join(directory, entry.name));
    }
  }
  return artifacts;
}

export async function runCli(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h") || (args.length === 1 && args[0] === "help")) {
    console.log(help.trimEnd());
    return;
  }
  const options = parse([...args]);
  const sets = await loadRules(options.input);
  for (const { data } of sets) for (const target of options.targets) validateTarget(data, target);
  if (options.command === "validate") {
    console.log(`Validated ${sets.length} rule sets for ${options.targets.length} clients.`);
    return;
  }
  // Complete all validation and compilation before the first output mutation.
  if (options.targets.includes("sing-box")) checkCompiler(options.compiler);
  const artifacts = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();
  for (const { name, data } of sets) {
    for (const target of options.targets) {
      const base = join(options.output, directories[target], name);
      if (target === "sing-box") {
        const source = renderSingBox(data);
        artifacts.set(`${base}.json`, encoder.encode(source));
        artifacts.set(`${base}.srs`, compileSrs(source, options.compiler));
      } else {
        artifacts.set(`${base}.list`, encoder.encode(renderList(data, target)));
      }
    }
  }
  const existing = await existingArtifacts(options);
  const stale = existing.filter((path) => !artifacts.has(path));
  if (options.command === "check") {
    let different = stale.length;
    for (const [path, expected] of artifacts) {
      const info = await statIfExists(path);
      if (!info) { different++; continue; }
      if (!info.isFile() || info.isSymbolicLink()) throw new CliError("Managed artifact paths must be regular files.");
      if (!Buffer.from(expected).equals(await readFile(path))) different++;
    }
    if (different) throw new CliError(`Generated artifacts differ (${different} files); run rulegen build and commit the updated artifacts.`);
    console.log(`Checked ${artifacts.size} artifacts; all match source data.`);
    return;
  }
  for (const [path, content] of artifacts) {
    const parent = resolve(path, "..");
    await mkdir(parent, { recursive: true });
    const temporary = join(parent, `.rulegen-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  for (const path of stale) await rm(path);
  console.log(`Built ${artifacts.size} artifacts from ${sets.length} rule sets; removed ${stale.length} stale artifacts.`);
}

if (import.meta.main) {
  try { await runCli(process.argv.slice(2)); }
  catch (error) {
    const message = error instanceof CliError || error instanceof CompilerError || error instanceof RuleValidationError
      ? error.message : "Could not access rule input or output; verify directory permissions and paths (details withheld).";
    console.error(`rulegen: ${message}`);
    process.exitCode = 1;
  }
}
