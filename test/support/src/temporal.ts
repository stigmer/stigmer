// Boots an ephemeral Temporal dev server via the `temporal` CLI and waits until
// the whole service is serving, retrying with a fresh port when another
// listener takes one of its ports first.
// Domain: test support (stack spawns).
//
// The execution target (Class B) needs a real Temporal so the server's
// workflowCreator is injected and the TS runner has a rendezvous to poll. Each
// instance owns its own port and an in-memory database (the CLI's default),
// so suite files can boot Temporal concurrently without colliding. This
// requires the `temporal` CLI on PATH, the version `make install-temporal-cli`
// pins (client-apps/cli/src/local/temporal/download.ts); the execution
// globalSetup asserts it before any suite runs.
//
// Why a retry, when every other spawner binds port 0 and reports (ports.ts):
// the CLI cannot be told 0. It takes `--port` as given, and it picks several
// more ports itself (the frontend's HTTP API, metrics, the internal services'
// membership ports) by probing and releasing them, with no flag to pin them.
// Any bind elsewhere in the run can take one of those before the server binds
// it, and the dev server then dies: a clean exit 1 when the CLI's own
// pre-check catches it, a Go panic (exit 2) when it is a port the frontend
// binds later (stigmer#1469, run 36707299257). Nothing outside the CLI can
// close that window, so a boot attempt that dies of exactly that cause is
// retried with a fresh frontend port, loudly, up to MAX_BOOT_ATTEMPTS times.
// Any other death fails at once: a retry must never hide a real fault.
//
// The cause is recognised by Go's own text for EADDRINUSE,
// "bind: address already in use", which both paths carry (the pre-check's
// "can't set ... port N: listen tcp ...: bind: address already in use", and
// the frontend's "failed listening for HTTP API on ...: %w" wrapping the same
// net error, temporal v1.29.1 service/frontend/http_api_server.go:91-92). It
// is the operating system's error as Go spells it, not Temporal's wording,
// and __tests__/temporal.test.ts holds captured output from the pinned CLI and
// fails when the pin moves until that output is captured again.
//
// Readiness is three gates, in order:
//   1. our child's banner: the CLI prints "Server:  <host>:<port>" only after
//      its server has started (cli v1.5.1 temporalcli/commands.server.go:
//      150-157), so the line, read from this child's own stdout, proves the
//      frontend on that port is ours. A TCP accept alone could be a sibling
//      suite's dev server that took the port.
//   2. `operator cluster health` reports SERVING, which only happens once the
//      frontend and every internal service are up. The caller
//      (LocalExecutionTarget.setup) binds more listeners as soon as this
//      returns, so returning before every internal port is held would hand
//      them the chance to take one.
//   3. the child is still alive after both.
import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { stopChild, teeChildOutput } from "./child-process.ts";

const execFileAsync = promisify(execFile);

// Boot attempts before a lost port fails the suite. Each loss needs another
// listener to take a just-probed port within milliseconds, so a third loss in
// a row is not bad luck but a machine out of ports, and it should say so.
const MAX_BOOT_ATTEMPTS = 3;
const BANNER_TIMEOUT_MS = 30_000;
const BANNER_POLL_MS = 100;
// The frontend accepts connections before the cluster is fully serving, so
// this gate runs after the banner; keep its budget generous for slow CI.
const SERVING_READY_TIMEOUT_MS = 30_000;
const SERVING_READY_POLL_MS = 200;
// A short per-probe dial timeout so a not-yet-serving cluster fails fast and the
// loop retries, rather than the CLI's default of blocking indefinitely.
const HEALTH_CONNECT_TIMEOUT = "3s";
const LOG_TAIL_BYTES = 8_000;
// How much of each stream an attempt keeps from its start, for recognising
// why it died. The tee's tail keeps the end; a Go panic's first line, the one
// that names the cause, is at the start, and an 8 KB tail of its stack loses
// it (the failure in stigmer#1469's run 36707299257 did).
const HEAD_BYTES = 64_000;
// How long a dead child's pipes get to drain before its output is judged.
const CLOSE_GRACE_MS = 2_000;
// Go's text for EADDRINUSE, carried by every port-collision death (header).
const BIND_COLLISION = "bind: address already in use";
// The one namespace every dev server here serves; the runner is pointed at it
// by name (runner-process.ts TEMPORAL_NAMESPACE) and a history reader asks
// the CLI for it by name. Exported so neither side spells it twice.
export const TEMPORAL_DEV_NAMESPACE = "default";
const NAMESPACE = TEMPORAL_DEV_NAMESPACE;

export interface RunningTemporal {
  // host:port of the Temporal frontend, for the server and the TS runner.
  readonly hostPort: string;
  readonly namespace: string;
  // Last ~8KB of combined stdout/stderr, surfaced in failures for diagnosis.
  logTail(): string;
  stop(): Promise<void>;
}

// How one boot attempt ended: serving, or dead of a port another listener
// took, which is the one death worth another attempt. Every other failure is
// thrown by the attempt itself.
export type TemporalBootAttempt =
  | { readonly kind: "ready"; readonly temporal: RunningTemporal }
  | { readonly kind: "port-lost"; readonly reason: string };

// Why a dev server died, read from what it printed: a port collision, with the
// line that says so, or anything else, with the first panic line if there was
// one (the line a Go crash names its cause on).
export type TemporalExit =
  | { readonly kind: "port-collision"; readonly line: string }
  | { readonly kind: "other"; readonly panicLine: string | undefined };

export function classifyTemporalExit(output: string): TemporalExit {
  const lines = output.split("\n");
  const collision = lines.find((line) => line.includes(BIND_COLLISION));
  if (collision !== undefined) return { kind: "port-collision", line: collision.trim() };
  return { kind: "other", panicLine: lines.find((line) => line.startsWith("panic:"))?.trim() };
}

// True once the CLI has printed its "Server:" banner for `port` (header, gate
// 1). The host is whatever the CLI prints for the frontend IP (`localhost`
// for 127.0.0.1); the port is what makes it this attempt's server.
export function bannerNamesPort(stdout: string, port: number): boolean {
  return stdout.split("\n").some((line) => {
    const match = /^Server:\s+\S+:(\d+)\s*$/.exec(line);
    return match !== null && Number(match[1]) === port;
  });
}

export interface BootTemporalOptions {
  // Boots one dev server on the given frontend port.
  readonly attempt: (port: number) => Promise<TemporalBootAttempt>;
  // The frontend port for the next attempt.
  readonly nextPort: () => Promise<number>;
  readonly maxAttempts: number;
  // Where a retry announces itself.
  readonly warn: (line: string) => void;
}

// The attempt loop, apart from the CLI so its rules can be pinned with
// scripted attempts: a lost port is retried on a fresh one, loudly, until the
// attempts run out; anything an attempt throws ends the loop at once.
export async function bootTemporal(opts: BootTemporalOptions): Promise<RunningTemporal> {
  let lastReason = "";
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt += 1) {
    const port = await opts.nextPort();
    const outcome = await opts.attempt(port);
    if (outcome.kind === "ready") return outcome.temporal;
    lastReason = outcome.reason;
    if (attempt < opts.maxAttempts) {
      opts.warn(
        `temporal dev server lost a port to another listener (${outcome.reason}); ` +
          `retrying with a fresh port, attempt ${attempt + 1} of ${opts.maxAttempts}`,
      );
    }
  }
  throw new Error(
    `temporal dev server lost a port to another listener on all ${opts.maxAttempts} attempts; ` +
      `the last: ${lastReason}`,
  );
}

export async function spawnTemporal(): Promise<RunningTemporal> {
  return bootTemporal({
    attempt: bootTemporalAttempt,
    nextPort: probeFrontendPort,
    maxAttempts: MAX_BOOT_ATTEMPTS,
    warn: (line) => console.error(line),
  });
}

// The frontend port for one attempt: probed and released, the one place in
// the harness that does so (ports.ts), because the CLI takes `--port` as
// given and cannot be told 0. A loss of this port is what the attempt loop
// survives. Exported only for the check that runs that loop for real
// (test/conformance's temporal-port-loss harness suite).
export function probeFrontendPort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("failed to acquire a port for the temporal frontend")));
        return;
      }
      const { port } = address;
      server.close(() => resolvePort(port));
    });
  });
}

// What a child printed on each stream, from its start, bounded.
interface StreamHeads {
  stdout: string;
  stderr: string;
}

// One real boot on a given frontend port: what spawnTemporal loops over, and
// what test/conformance's temporal-port-loss harness suite runs the loop with
// after handing it a taken port first.
export async function bootTemporalAttempt(port: number): Promise<TemporalBootAttempt> {
  const hostPort = `127.0.0.1:${port}`;

  // --headless drops the Web UI (not needed for tests); the dev server defaults
  // to an in-memory store, so there is no on-disk state to isolate or clean up.
  const child = spawn(
    "temporal",
    ["server", "start-dev", "--port", String(port), "--namespace", NAMESPACE, "--headless", "--log-format", "json"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const output = teeChildOutput(child, { tailBytes: LOG_TAIL_BYTES });
  const logTail = (): string => output.tail();
  // Kept per stream, apart from the tee's merged one, so a chunk of one can
  // never land inside a line of the other.
  const heads: StreamHeads = { stdout: "", stderr: "" };
  child.stdout?.on("data", (chunk: Buffer) => {
    heads.stdout = (heads.stdout + chunk.toString("utf8")).slice(0, HEAD_BYTES);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    heads.stderr = (heads.stderr + chunk.toString("utf8")).slice(0, HEAD_BYTES);
  });
  const closed = once(child, "close").then(() => undefined);

  let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  child.on("exit", (code, signal) => {
    exit = { code, signal };
  });
  const getExit = (): { code: number | null; signal: NodeJS.Signals | null } | null => exit;

  const stop = async (): Promise<void> => {
    // Await the actual exit (not just fire-and-forget SIGKILL) so the dev
    // server's ports are released before the next serial suite file boots its
    // own Temporal; a lingering, still-dying process can otherwise hold a port
    // the next stack tries to allocate. An `error` event on the dying child is
    // not a teardown failure.
    await stopChild(child, { signal: "SIGKILL", graceMs: 0 }).catch(() => {});
  };

  try {
    const banner = await waitForBanner(port, heads, getExit, logTail);
    if (banner === "died") return await judgeDeath(child, closed, heads, logTail);
    if (!(await waitForServing(hostPort, getExit, logTail))) return await judgeDeath(child, closed, heads, logTail);
    if (getExit() !== null) return await judgeDeath(child, closed, heads, logTail);
  } catch (err) {
    await stop();
    throw err;
  }

  return { kind: "ready", temporal: { hostPort, namespace: NAMESPACE, logTail, stop } };
}

// Gate 1. Resolves "seen" once this child's banner names `port`, or "died" when
// the child exits first; throws when neither happens in time.
async function waitForBanner(
  port: number,
  heads: StreamHeads,
  getExit: () => { code: number | null; signal: NodeJS.Signals | null } | null,
  getLog: () => string,
): Promise<"seen" | "died"> {
  const deadline = Date.now() + BANNER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (bannerNamesPort(heads.stdout, port)) return "seen";
    if (getExit() !== null) return "died";
    await delay(BANNER_POLL_MS);
  }
  throw new Error(
    `temporal dev server did not report its frontend on port ${port} within ${BANNER_TIMEOUT_MS}ms\n` +
      `--- temporal log tail ---\n${getLog()}`,
  );
}

// Gate 2: poll `temporal operator cluster health` until it reports SERVING,
// which only happens once the frontend and every internal service are up (and
// therefore all their ports are bound). Resolves false when the child dies
// first; throws when the cluster never serves.
async function waitForServing(
  hostPort: string,
  getExit: () => { code: number | null; signal: NodeJS.Signals | null } | null,
  getLog: () => string,
): Promise<boolean> {
  const deadline = Date.now() + SERVING_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (getExit() !== null) return false;
    if (await clusterServing(hostPort)) return true;
    await delay(SERVING_READY_POLL_MS);
  }
  throw new Error(
    `temporal dev server did not report SERVING within ${SERVING_READY_TIMEOUT_MS}ms\n` +
      `--- temporal log tail ---\n${getLog()}`,
  );
}

// A dead attempt: a lost port is reported for another attempt; anything else
// is thrown with the line that names it and the tail.
async function judgeDeath(
  child: ChildProcess,
  closed: Promise<void>,
  heads: StreamHeads,
  getLog: () => string,
): Promise<TemporalBootAttempt> {
  // The child has exited; its pipes may still hold its last words.
  await Promise.race([closed, delay(CLOSE_GRACE_MS)]);
  let panicLine: string | undefined;
  for (const stream of [heads.stderr, heads.stdout]) {
    const verdict = classifyTemporalExit(stream);
    switch (verdict.kind) {
      case "port-collision":
        return { kind: "port-lost", reason: verdict.line };
      case "other":
        panicLine ??= verdict.panicLine;
        break;
      default: {
        const unreachable: never = verdict;
        throw new Error(`unclassified temporal exit: ${JSON.stringify(unreachable)}`);
      }
    }
  }
  throw new Error(
    `temporal dev server exited before becoming ready (code=${child.exitCode}, signal=${child.signalCode})\n` +
      (panicLine !== undefined ? `--- first panic line ---\n${panicLine}\n` : "") +
      `--- temporal log tail ---\n${getLog()}`,
  );
}

async function clusterServing(hostPort: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("temporal", [
      "operator",
      "cluster",
      "health",
      "--address",
      hostPort,
      "--client-connect-timeout",
      HEALTH_CONNECT_TIMEOUT,
    ]);
    return stdout.includes("SERVING");
  } catch {
    // Not serving yet (connection refused / not-serving status); retry.
    return false;
  }
}
