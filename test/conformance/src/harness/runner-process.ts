// Boots the TypeScript unified runner in static mode and waits for it to begin
// polling its Temporal task queue.
// Domain: conformance harness (execution engine).
//
// The runner is the execution engine: the Go server dispatches the real work to
// it over Temporal (queue `stigmer_runner`). We run the compiled entry
// (`node dist/main.js`) rather than tsx so the on-boot Temporal workflow bundle
// is built from compiled JS, which sidesteps the raw-.ts proto-stub bundler
// failure. Readiness is the runner's own stdout marker (printed once the
// Temporal connection is up and the worker is about to poll) — the execution
// analogue of server-process.ts waiting for a TCP listener.
//
// For a data-only set_vars WorkflowExecution this needs no LLM, MCP, API key,
// proxy, object storage, or checkpointer service: jq runs in-process and the
// only egress is gRPC back to the server. So the env below is deliberately bare.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { runnerDir } from "./runner-build";

// The runner bundles its Temporal workflows on boot, so first-poll readiness is
// slower than a plain listener; give it generous headroom.
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 100;
const LOG_TAIL_BYTES = 8_000;

// Printed by the runner immediately before it begins polling (runner/src/runner.ts).
const READY_MARKER = "Worker ready, polling for tasks";

export interface RunnerOptions {
  // Absolute path to the runner's compiled entry (dist/main.js).
  entryPath: string;
  // host:port of the live Temporal frontend the runner should connect to.
  temporalHostPort: string;
  // http(s) base URL of the Go server's gRPC endpoint, for status streaming.
  backendEndpoint: string;
}

export interface RunningRunner {
  // Last ~8KB of combined stdout/stderr, surfaced in failures for diagnosis.
  logTail(): string;
  stop(): Promise<void>;
}

export async function spawnRunner(opts: RunnerOptions): Promise<RunningRunner> {
  const workspaceDir = await mkdtemp(join(tmpdir(), "stigmer-conformance-runner-"));

  const child = spawn(process.execPath, [opts.entryPath], {
    cwd: runnerDir(),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      // STIGMER_RUNNER_MODE intentionally unset -> static (single-queue) mode.
      MODE: "local",
      STIGMER_TASK_QUEUE: "stigmer_runner",
      TEMPORAL_SERVICE_ADDRESS: opts.temporalHostPort,
      TEMPORAL_NAMESPACE: "default",
      STIGMER_BACKEND_ENDPOINT: opts.backendEndpoint,
      WORKSPACE_ROOT_DIR: workspaceDir,
      LOG_LEVEL: "info",
      // Avoid a boot-time MCP backfill network call (hermetic test detail).
      SKIP_MCP_CONNECT_BACKFILL: "true",
      // No STIGMER_TOKEN, STIGMER_PROXY_ENDPOINT, or CURSOR_API_KEY: a data-only
      // workflow needs none, and their absence keeps the run fully offline.
    },
  });

  let logTail = "";
  let ready = false;
  const appendLog = (chunk: Buffer): void => {
    const text = chunk.toString("utf8");
    logTail = (logTail + text).slice(-LOG_TAIL_BYTES);
    if (text.includes(READY_MARKER)) ready = true;
  };
  child.stdout.on("data", appendLog);
  child.stderr.on("data", appendLog);

  let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  child.on("exit", (code, signal) => {
    exit = { code, signal };
  });

  const stop = async (): Promise<void> => {
    // SIGTERM triggers the runner's graceful shutdown (drains the worker).
    if (exit === null) {
      child.kill("SIGTERM");
    }
    await rm(workspaceDir, { recursive: true, force: true });
  };

  try {
    await waitForReady(
      () => ready,
      () => exit,
      () => logTail,
    );
  } catch (err) {
    await stop();
    throw err;
  }

  return {
    logTail: () => logTail,
    stop,
  };
}

async function waitForReady(
  isReady: () => boolean,
  getExit: () => { code: number | null; signal: NodeJS.Signals | null } | null,
  getLog: () => string,
): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (isReady()) return;
    const exit = getExit();
    if (exit !== null) {
      throw new Error(
        `runner exited before becoming ready (code=${exit.code}, signal=${exit.signal})\n` +
          `--- runner log tail ---\n${getLog()}`,
      );
    }
    await delay(READY_POLL_MS);
  }
  throw new Error(
    `runner did not start polling within ${READY_TIMEOUT_MS}ms\n` +
      `--- runner log tail ---\n${getLog()}`,
  );
}
