// Boots a stigmer-server child process against throwaway state and waits for its
// TCP port to accept connections.
// Domain: conformance harness (server lifecycle).
//
// Each instance owns a temp dir (SQLite DB + storage) and a free port, so suite
// files can boot servers concurrently without colliding. TCP-readiness only
// proves the listener is up; the gRPC-level readiness gate lives in the target.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { getFreePort } from "./ports";

const TCP_READY_TIMEOUT_MS = 20_000;
const TCP_READY_POLL_MS = 100;
const LOG_TAIL_BYTES = 8_000;

export interface RunningServer {
  readonly baseUrl: string;
  readonly port: number;
  // Last ~8KB of combined stdout/stderr, surfaced in failures for diagnosis.
  logTail(): string;
  stop(): Promise<void>;
}

export async function spawnServer(binaryPath: string): Promise<RunningServer> {
  const port = await getFreePort();
  // No Temporal in this slice. Point the server at a closed port so its
  // (non-fatal) connection attempt fails fast instead of retrying the live
  // default at localhost:7233.
  const closedTemporalPort = await getFreePort();
  const stateDir = await mkdtemp(join(tmpdir(), "stigmer-conformance-"));

  const child = spawn(binaryPath, [], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GRPC_PORT: String(port),
      DB_PATH: join(stateDir, "stigmer.db"),
      STORAGE_PATH: join(stateDir, "storage"),
      ARTIFACT_LOCAL_BASE_PATH: join(stateDir, "data"),
      TEMPORAL_HOST_PORT: `127.0.0.1:${closedTemporalPort}`,
      ENV: "local",
      LOG_LEVEL: "warn",
    },
  });

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
    await rm(stateDir, { recursive: true, force: true });
  };

  try {
    await waitForTcp(port, () => exit, () => logTail);
  } catch (err) {
    await stop();
    throw err;
  }

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
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
        `stigmer-server exited before becoming ready (code=${exit.code}, signal=${exit.signal})\n--- server log tail ---\n${getLog()}`,
      );
    }
    if (await tcpConnects(port)) return;
    await delay(TCP_READY_POLL_MS);
  }
  throw new Error(
    `stigmer-server did not open port ${port} within ${TCP_READY_TIMEOUT_MS}ms\n--- server log tail ---\n${getLog()}`,
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
