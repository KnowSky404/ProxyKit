import { describe, expect, test } from "bun:test";
import { connect, type Socket } from "node:net";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCompiler, compileSrs } from "../src/srs.ts";

const compiler = process.env.SING_BOX_BIN ?? "sing-box";
const root = fileURLToPath(new URL("../../../", import.meta.url));
type Format = "source" | "binary";
const regressionCases: { set: string; probe: string; match: boolean }[] = JSON.parse(
  readFileSync(new URL("./fixtures/matches.json", import.meta.url), "utf8"),
);

// Actual HTTP proxy connections, deliberately separate from rule-set match.
// Each outbound connects to a different loopback HTTP proxy responder. Those
// mocks terminate the tunnel locally: even IPv6 destination probes require no
// IPv6 interface, external DNS or Internet.
function request(port: number, destination: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    let response = "";
    socket.setTimeout(3000, () => socket.destroy(new Error("Local proxy request timed out.")));
    socket.on("connect", () => socket.write(`GET http://${destination}/ HTTP/1.1\r\nHost: ${destination}\r\nConnection: close\r\n\r\n`));
    socket.on("data", chunk => {
      response += chunk.toString();
      if (response.length > 16384) socket.destroy(new Error("Local proxy response exceeded limit."));
    });
    socket.on("error", () => reject(new Error("Local proxy request failed; details withheld.")));
    socket.on("end", () => {
      if (!/^HTTP\/1\.[01] 200\b/.test(response)) reject(new Error("Local proxy returned an unsuccessful response."));
      else resolve(response.split("\r\n\r\n").slice(1).join("\r\n\r\n"));
    });
  });
}

async function withRuntime(config: unknown, directory: string, run: (port: number) => Promise<void>) {
  const path = join(directory, "config.json");
  writeFileSync(path, JSON.stringify(config), { mode: 0o600 });
  const checked = Bun.spawnSync([compiler, "check", "-c", path], { stdout: "pipe", stderr: "pipe" });
  if (checked.exitCode !== 0) throw new Error("Official runtime configuration check failed; child output withheld.");
  const child = Bun.spawn([compiler, "run", "--disable-color", "-c", path], { stdout: "ignore", stderr: "pipe" });
  let ready!: (port: number) => void;
  let failed!: (error: Error) => void;
  const startup = new Promise<number>((resolve, reject) => { ready = resolve; failed = reject; });
  const timer = setTimeout(() => failed(new Error("Official runtime startup timed out; child output withheld.")), 5000);
  // Drain and discard child output; raw compiler/runtime errors can contain rule data.
  const drain = (async () => {
    const reader = child.stderr.getReader();
    const decoder = new TextDecoder();
    let tail = "";
    let inboundPort: number | undefined;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        tail = (tail + decoder.decode(value, { stream: true })).slice(-4096);
        const port = /tcp server started at 127\.0\.0\.1:(\d+)/.exec(tail)?.[1];
        if (port) inboundPort = Number(port);
        // Inbound listeners can start before router PostStart binds rule sets.
        // Keep the port across log chunks and wait for Box.Start to finish too.
        if (inboundPort && tail.includes("sing-box started")) ready(inboundPort);
      }
      failed(new Error("Official runtime exited before startup completed; child output withheld."));
    } finally { reader.releaseLock(); }
  })();
  try { await run(await startup); }
  finally {
    clearTimeout(timer);
    child.kill("SIGTERM");
    const terminate = setTimeout(() => child.kill("SIGKILL"), 2000);
    try { await child.exited; await drain; }
    finally { clearTimeout(terminate); }
  }
}

function fixture(directory: string, format: Format, matched: number, priority: number, fallback: number) {
  const sources = {
    probe: { version: 2, rules: [
      {
        domain: ["exact.example.test", "second.example.test"],
        domain_suffix: ["suffix.example.test", "another.example.test"],
        ip_cidr: ["192.0.2.0/24", "2001:db8::/32"],
      },
    ] },
    priority: { version: 2, rules: [{ domain: ["api.suffix.example.test"] }] },
  };
  const extension = format === "source" ? "json" : "srs";
  for (const [name, data] of Object.entries(sources)) {
    const json = JSON.stringify(data);
    writeFileSync(join(directory, `${name}.${extension}`), format === "source" ? json : compileSrs(json, compiler), { mode: 0o600 });
  }
  const route = (tag: string) => ({ action: "route", outbound: tag });
  return {
    log: { level: "info", timestamp: false },
    dns: { servers: [{ type: "hosts", tag: "fixture-hosts", predefined: { "ip-target.example.test": "192.0.2.7" } }] },
    inbounds: [{ type: "http", listen: "127.0.0.1", listen_port: 0, set_system_proxy: false }],
    outbounds: Object.entries({ matched, priority, fallback }).map(([tag, port]) => ({ type: "http", tag, server: "127.0.0.1", server_port: port })),
    route: {
      rule_set: [
        ...Object.keys(sources).map(tag => ({ type: "local", tag, format, path: join(directory, `${tag}.${extension}`) })),
        // Runtime startup also loads ALL committed sets in BOTH official formats.
        ...readdirSync(join(root, "sing-box/rules")).sort().filter(name => /\.(?:json|srs)$/.test(name)).map((name, i) => ({
          type: "local", tag: `committed-${i}`, format: name.endsWith("json") ? "source" : "binary", path: join(root, "sing-box/rules", name),
        })),
      ],
      rules: [
        { rule_set: ["priority"], ...route("priority") },
        { rule_set: ["probe"], ...route("matched") },
        route("fallback"),
      ] as Record<string, unknown>[],
    },
  };
}

async function environment(run: (directory: string, ports: number[]) => Promise<void>) {
  checkCompiler(compiler);
  const directory = mkdtempSync(join(tmpdir(), "proxykit-runtime-"));
  const servers: ReturnType<typeof createServer>[] = [];
  const sockets = new Set<Socket>();
  const ports: number[] = [];
  try {
    for (const label of ["matched", "priority", "fallback"]) {
      const reply = `HTTP/1.1 200 OK\r\nContent-Length: ${label.length}\r\nConnection: close\r\n\r\n${label}`;
      const server = createServer((_request, response) => response.end(label));
      servers.push(server);
      server.on("connection", socket => {
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
        socket.on("error", () => {});
        socket.setTimeout(5000, () => socket.destroy());
      });
      // sing-box's HTTP outbound tunnels TCP with CONNECT. The mock never
      // dials the target; its marker proves which outbound was actually used.
      server.on("connect", (_request, socket, head) => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        let request = head.toString();
        const respond = () => {
          if (request.includes("\r\n\r\n")) { socket.end(reply); return true; }
          return false;
        };
        if (!respond()) socket.on("data", data => {
          request += data.toString();
          if (request.length > 16384) socket.destroy();
          else respond();
        });
      });
      await new Promise<void>((resolve, reject) => {
        server.once("error", () => reject(new Error("Local outbound responder could not listen.")));
        server.listen(0, "127.0.0.1", resolve);
      });
      ports.push((server.address() as { port: number }).port);
    }
    await run(directory, ports);
  } finally {
    for (const socket of sockets) socket.destroy();
    await Promise.all(servers.map(server => new Promise<void>(resolve => server.close(() => resolve()))));
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("official sing-box runtime with isolated loopback traffic", () => {
  for (const format of ["source", "binary"] as const) {
    test(`${format}: actual HTTP routing selects outbounds using exact, suffix and IP destination matchers`, async () => environment(async (directory, [matched, priority, fallback]) => {
      const config = fixture(directory, format, matched, priority, fallback);
      await withRuntime(config, directory, async port => {
        const positives = ["exact.example.test", "second.example.test", "suffix.example.test", "sub.suffix.example.test", "deep.sub.suffix.example.test", "sub.another.example.test", "192.0.2.0", "192.0.2.255", "[2001:db8::]", "[2001:db8:ffff:ffff:ffff:ffff:ffff:ffff]"];
        const negatives = ["sub.exact.example.test", "sub.second.example.test", "badexact.example.test", "badsuffix.example.test", "suffix.example.test.evil.test", "192.0.1.255", "192.0.3.0", "[2001:db7:ffff:ffff:ffff:ffff:ffff:ffff]", "[2001:db9::]"];
        for (const target of positives) expect(await request(port, target)).toBe("matched");
        for (const target of negatives) expect(await request(port, target)).toBe("fallback");
        expect(await request(port, "api.suffix.example.test")).toBe("priority");
        // Hosts DNS knows this name's matching IP, but no resolve action runs
        // before the rule-set: do not claim no-resolve is embedded in SRS.
        expect(await request(port, "ip-target.example.test")).toBe("fallback");
      });
    }), 20000);

    test(`${format}: an explicit earlier resolve action changes IP rule-set evaluation`, async () => environment(async (directory, [matched, priority, fallback]) => {
      const config = fixture(directory, format, matched, priority, fallback);
      config.route.rules.unshift({ domain: ["ip-target.example.test"], action: "resolve", server: "fixture-hosts", strategy: "ipv4_only" });
      await withRuntime(config, directory, async port => {
        expect(await request(port, "ip-target.example.test")).toBe("matched");
      });
    }), 20000);

    for (const conjunction of [false, true]) {
      test(`${format}: compact rule-set with outer domains uses ${conjunction ? "explicit logical AND" : "destination-group OR"}`, async () => environment(async (directory, [matched, priority, fallback]) => {
        const config = fixture(directory, format, matched, priority, fallback);
        const domain = ["api.suffix.example.test", "outer-only.example.test"];
        const action = { action: "route", outbound: "matched" };
        config.route.rules = [
          conjunction
            ? { type: "logical", mode: "and", rules: [{ domain }, { rule_set: ["probe"] }], ...action }
            : { domain, rule_set: ["probe"], ...action },
          { action: "route", outbound: "fallback" },
        ];
        await withRuntime(config, directory, async port => {
          expect(await request(port, "api.suffix.example.test")).toBe("matched");
          for (const target of ["exact.example.test", "outer-only.example.test", "192.0.2.7"]) {
            expect(await request(port, target)).toBe(conjunction ? "fallback" : "matched");
          }
          expect(await request(port, "neither.example.test")).toBe("fallback");
        });
      }), 20000);
    }
  }

  for (const format of ["source", "binary"] as const) {
    for (const name of [...new Set(regressionCases.map(entry => entry.set))].sort()) {
      test(`${format}: committed ${name} routes independent regression probes to the expected outbound`, async () => environment(async (directory, [matched, priority, fallback]) => {
        const config = fixture(directory, format, matched, priority, fallback);
        const extension = format === "source" ? "json" : "srs";
        const tag = config.route.rule_set.find(set => set.path === join(root, "sing-box/rules", `${name}.${extension}`))!.tag;
        // Bind ONLY this committed set. Synthetic rules and other business sets
        // must not make an otherwise negative regression probe pass.
        config.route.rules = [
          { rule_set: [tag], action: "route", outbound: "matched" },
          { action: "route", outbound: "fallback" },
        ];
        await withRuntime(config, directory, async port => {
          for (const entry of regressionCases.filter(entry => entry.set === name)) {
            const target = entry.probe.includes(":") ? `[${entry.probe}]` : entry.probe;
            expect(await request(port, target)).toBe(entry.match ? "matched" : "fallback");
          }
        });
      }), 20000);
    }
  }

  test("route order changes the chosen outbound when two rule sets overlap", async () => environment(async (directory, [matched, priority, fallback]) => {
    const config = fixture(directory, "binary", matched, priority, fallback);
    [config.route.rules[0], config.route.rules[1]] = [config.route.rules[1], config.route.rules[0]];
    await withRuntime(config, directory, async port => {
      expect(await request(port, "api.suffix.example.test")).toBe("matched");
    });
  }), 20000);
});
