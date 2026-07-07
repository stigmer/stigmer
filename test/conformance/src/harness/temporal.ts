// Boots an ephemeral Temporal dev server via the `temporal` CLI and waits until
// the whole service is serving — not merely until its frontend port accepts.
// Domain: conformance harness (execution engine).
//
// The execution target (Class B) needs a real Temporal so the Go server's
// workflowCreator is injected and the TS runner has a rendezvous to poll. Each
// instance owns a free port and an in-memory database (the CLI's default), so
// suite files can boot Temporal concurrently without colliding. This requires
// the `temporal` CLI on PATH — the same dependency the Go integration harness
// assumes; the execution globalSetup asserts it before any suite runs. Patterns
// (free port, poll-don't-sleep readiness, log-tail-on-failure) are borrowed
// from server-process.ts and the Go harness, not imported (DD-002 TS-purity).
//
// Readiness is deliberately a two-stage gate. Only `--port` (the frontend gRPC
// port) is fixed; the dev server also binds several *dynamically chosen*
// ephemeral ports for its internal services (metrics, history, matching,
// worker), and there is no CLI flag to pin them. A bare TCP accept on the
// frontend returns while those internal ports are still being bound, and the
// caller (LocalGoExecutionTarget.setup) immediately allocates more ephemeral
// ports via getFreePort() for the server, mock LLM, and MCP fixture. Those
// allocations can grab a port Temporal was about to bind, killing an internal
// service and taking the dev server down *after* its frontend already passed a
// TCP-only gate — which later surfaces as the runner getting connection-refused
// on the frontend port. Gating on `operator cluster health` == SERVING means
// spawnTemporal only returns once every port is held, closing that steal race.
import { execFile, spawn } from "node:child_process";
import { once } from "node:events";
import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { getFreePort } from "./ports";

const execFileAsync = promisify(execFile);

const TCP_READY_TIMEOUT_MS = 30_000;
const TCP_READY_POLL_MS = 150;
// The frontend accepts connections before the cluster is fully serving, so this
// second gate runs after the TCP gate; keep its budget generous for slow CI.
const SERVING_READY_TIMEOUT_MS = 30_000;
const SERVING_READY_POLL_MS = 200;
// A short per-probe dial timeout so a not-yet-serving cluster fails fast and the
// loop retries, rather than the CLI's default of blocking indefinitely.
const HEALTH_CONNECT_TIMEOUT = "3s";
const LOG_TAIL_BYTES = 8_000;
const NAMESPACE = "default";

export interface RunningTemporal {
  // host:port of the Temporal frontend, for the Go server and the TS runner.
  readonly hostPort: string;
  readonly namespace: string;
  // Last ~8KB of combined stdout/stderr, surfaced in failures for diagnosis.
  logTail(): string;
  stop(): Promise<void>;
}

export async function spawnTemporal(): Promise<RunningTemporal> {
  const port = await getFreePort();
  const hostPort = `127.0.0.1:${port}`;

  // --headless drops the Web UI (not needed for tests); the dev server defaults
  // to an in-memory store, so there is no on-disk state to isolate or clean up.
  const child = spawn(
    "temporal",
    [
      "server",
      "start-dev",
      "--port",
      String(port),
      "--namespace",
      NAMESPACE,
      "--headless",
      "--log-format",
      "json",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  let logTail = "";
  const appendLog = (chunk: Buffer): void => {
    logTail = (logTail + chunk.toString("utf8")).slice(-LOG_TAIL_BYTES);
  };
  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);

  let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  child.on("exit", (code, signal) => {
    exit = { code, signal };
  });

  const stop = async (): Promise<void> => {
    // Await the actual exit (not just fire-and-forget SIGKILL) so the dev
    // server's ports are released before the next serial suite file boots its
    // own Temporal; a lingering, still-dying process can otherwise hold a port
    // the next stack tries to allocate.
    if (exit === null) {
      child.kill("SIGKILL");
      await once(child, "exit").catch(() => {});
    }
  };

  try {
    await waitForTcp(port, () => exit, () => logTail);
    await waitForServing(hostPort, () => exit, () => logTail);
  } catch (err) {
    await stop();
    throw err;
  }

  return {
    hostPort,
    namespace: NAMESPACE,
    logTail: () => logTail,
    stop,
  };
}

async function waitForTcp(
  port: number,
  getExit: () => { code: number | null; signal: NodeJS.Signals | null } | null,
  getLog: () => string,
): Promise<void> {
  const deadline = Date.now() + TCP_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const exit = getExit();
    if (exit !== null) {
      throw new Error(
        `temporal dev server exited before becoming ready (code=${exit.code}, signal=${exit.signal})\n` +
          `--- temporal log tail ---\n${getLog()}`,
      );
    }
    if (await tcpConnects(port)) return;
    await delay(TCP_READY_POLL_MS);
  }
  throw new Error(
    `temporal dev server did not open port ${port} within ${TCP_READY_TIMEOUT_MS}ms\n` +
      `--- temporal log tail ---\n${getLog()}`,
  );
}

// Second readiness gate: poll `temporal operator cluster health` until it
// reports SERVING, which only happens once the frontend and every internal
// service are up (and therefore all their ports are bound). This is what closes
// the port-steal race described in the file header — see there for the why.
async function waitForServing(
  hostPort: string,
  getExit: () => { code: number | null; signal: NodeJS.Signals | null } | null,
  getLog: () => string,
): Promise<void> {
  const deadline = Date.now() + SERVING_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const exit = getExit();
    if (exit !== null) {
      throw new Error(
        `temporal dev server exited before becoming healthy (code=${exit.code}, signal=${exit.signal})\n` +
          `--- temporal log tail ---\n${getLog()}`,
      );
    }
    if (await clusterServing(hostPort)) return;
    await delay(SERVING_READY_POLL_MS);
  }
  throw new Error(
    `temporal dev server did not report SERVING within ${SERVING_READY_TIMEOUT_MS}ms\n` +
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

function tcpConnects(port: number): Promise<boolean> {
  return new Promise((resolveConnected) => {
    const socket = connect({ port, host: "127.0.0.1" });
    const settle = (connected: boolean): void => {
      socket.destroy();
      resolveConnected(connected);
    };
    socket.once("connect", () => settle(true));
    socket.once("error", () => settle(false));
  });
}
