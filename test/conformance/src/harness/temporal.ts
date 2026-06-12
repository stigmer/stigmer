// Boots an ephemeral Temporal dev server via the `temporal` CLI and waits for
// its frontend port to accept connections.
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
import { spawn } from "node:child_process";
import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { getFreePort } from "./ports";

const TCP_READY_TIMEOUT_MS = 30_000;
const TCP_READY_POLL_MS = 150;
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
    if (exit === null) {
      child.kill("SIGKILL");
    }
  };

  try {
    await waitForTcp(port, () => exit, () => logTail);
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
