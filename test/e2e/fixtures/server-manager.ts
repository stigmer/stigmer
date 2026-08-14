import { spawn, type ChildProcess } from "node:child_process";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { diagEnabled, diagLogPath } from "./diag";

export interface ServerState {
  reused: boolean;
  temporalPid?: number;
  serverPid?: number;
  runnerPid?: number;
  tempDir?: string;
  // Base URL of the deterministic mock LLM proxy, when the stack was booted with
  // STIGMER_E2E_MOCK_LLM. Specs read it to program the proxy over HTTP. Absent on
  // a normal (real-LLM) boot.
  mockLlmControlUrl?: string;
  // True when the runner was booted with NO artifact store (STIGMER_E2E_FILE_GATES):
  // file writes take the pre-execution approval gate instead of apply-then-review.
  // Specs read it to skip against the wrong stack shape.
  fileGateMode?: boolean;
}

const REPO_ROOT = path.resolve(__dirname, "../../..");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Allocates an ephemeral TCP port by binding to :0 and reading the assignment.
 * Mirrors the conformance harness (test/conformance/src/harness/ports.ts): the
 * Temporal frontend uses a free port rather than the fixed 7233 so a hermetic
 * e2e stack never collides with — or is poached by — a developer's live dev
 * stack on the default port (a reused dev runner is not wired to our mock LLM).
 * There is an inherent TOCTOU window before the server binds it, acceptable for
 * an ephemeral test server (the same trade-off the Go integration harness makes).
 */
export function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close(() => reject(new Error("failed to acquire a free port")));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

export function isPortReachable(
  port: number,
  host = "127.0.0.1",
  timeoutMs = 200,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host, timeout: timeoutMs });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForPort(
  port: number,
  host = "127.0.0.1",
  timeoutMs = 30_000,
  intervalMs = 500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortReachable(port, host)) return;
    await sleep(intervalMs);
  }
  throw new Error(
    `Port ${host}:${port} not reachable after ${timeoutMs}ms`,
  );
}

/**
 * Keeps a child's piped stdout/stderr flowing when nothing consumes them.
 *
 * A `stdio: "pipe"` stream with no reader backpressures once the OS pipe
 * buffer (~64KB) fills, and the child then blocks mid-write — the Go
 * server wedged exactly this way partway into every suite run, hanging
 * all subsequent RPCs (#501; it logs every request, far outpacing the
 * buffer). `resume()` switches the streams to flowing mode and discards
 * the data; diag mode's file tees also drain, so this stays a no-op there.
 */
function drainStdio(proc: ChildProcess): void {
  proc.stdout?.resume();
  proc.stderr?.resume();
}

function waitForOutput(
  proc: ChildProcess,
  pattern: RegExp,
  timeoutMs = 30_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timeout (${timeoutMs}ms) waiting for output: ${pattern}`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      proc.stdout?.off("data", handler);
      proc.stderr?.off("data", handler);
    }

    function handler(data: Buffer) {
      if (pattern.test(data.toString())) {
        cleanup();
        resolve();
      }
    }

    proc.stdout?.on("data", handler);
    proc.stderr?.on("data", handler);

    proc.on("exit", (code) => {
      cleanup();
      reject(new Error(`Process exited with code ${code} before pattern matched`));
    });
  });
}

function findStigmerServerBinary(): string {
  const candidates = [
    path.join(REPO_ROOT, "bin", "stigmer-server"),
    path.join(os.homedir(), "bin", "stigmer-server"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return "stigmer-server";
}

function findRunnerDir(): string {
  return path.join(REPO_ROOT, "backend", "services", "runner");
}

function resolveRunnerEntrypoint(runnerDir: string): string {
  const distEntry = path.join(runnerDir, "dist", "main.js");
  if (fs.existsSync(distEntry)) return distEntry;

  throw new Error(
    `Unified runner not built: ${distEntry} not found.\n` +
    `  Run: npm run build -w @stigmer/protos && npm run build -w @stigmer/runner\n` +
    `  Or:  make ensure-runner-built (from test/integration-session-routing/)`,
  );
}

export async function startBackendStack(opts: {
  apiPort?: number;
  temporalPort?: number;
  // When set, the runner is pointed at this mock LLM proxy base URL
  // (STIGMER_PROXY_ENDPOINT) and switched to fully local artifacts/checkpointer
  // so agent executions stay hermetic and deterministic. See the runnerEnv block.
  mockLlmEndpoint?: string;
  // When set (with mockLlmEndpoint), the RUNNER boots with no artifact store
  // (ARTIFACT_STORAGE_TYPE=none): a non-git workspace then has no capture
  // substrate, so file writes gate pre-execution (deny-gate mode, DD-22) —
  // the stack shape the file-diff gate-card specs need. The server keeps its
  // own artifact config; only the runner's capture substrate is removed.
  fileGates?: boolean;
}): Promise<ServerState> {
  const apiPort = opts.apiPort ?? 7234;
  // Default to a free port (not the fixed 7233) so a developer's live dev stack
  // — its own Temporal + a runner polling the same `stigmer_runner` queue —
  // cannot poach this stack's executions. Temporal's port is internal (only the
  // server and runner connect to it; nothing external references it), so moving
  // it off 7233 is invisible to the node client and web app.
  const temporalPort = opts.temporalPort ?? (await getFreePort());
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stigmer-e2e-"));

  fs.mkdirSync(path.join(tempDir, "storage"), { recursive: true });
  fs.mkdirSync(path.join(tempDir, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempDir, "workspace"), { recursive: true });

  // One artifact root, shared by server and runner (#285): the base path IS the
  // root, so both processes point at this exact directory. A dedicated artifact
  // HTTP port makes the runner's serve URL deterministic instead of relying on
  // apiPort defaulting to 7234 (GRPC_PORT + 1).
  const artifactDir = path.join(tempDir, "data", "artifacts");
  fs.mkdirSync(artifactDir, { recursive: true });
  const artifactHttpPort = await getFreePort();

  console.log(`[e2e] Starting backend stack (temp: ${tempDir})`);

  // 1. Temporal dev server
  console.log(`[e2e] Starting Temporal dev server on :${temporalPort}...`);
  const temporal = spawn("temporal", [
    "server", "start-dev",
    "--port", String(temporalPort),
    "--namespace", "default",
    "--headless",
    "--db-filename", path.join(tempDir, "temporal.db"),
  ], { stdio: ["ignore", "pipe", "pipe"] });

  if (!temporal.pid) {
    throw new Error("Failed to spawn Temporal dev server. Is `temporal` CLI on PATH?");
  }
  drainStdio(temporal);

  await waitForPort(temporalPort, "127.0.0.1", 15_000, 250);
  console.log(`[e2e] Temporal ready (pid: ${temporal.pid})`);

  // 2. stigmer-server
  console.log(`[e2e] Starting stigmer-server on :${apiPort}...`);
  const serverBin = findStigmerServerBinary();
  const serverEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    GRPC_PORT: String(apiPort),
    TEMPORAL_HOST_PORT: `127.0.0.1:${temporalPort}`,
    TEMPORAL_NAMESPACE: "default",
    DB_PATH: path.join(tempDir, "stigmer.db"),
    STORAGE_PATH: path.join(tempDir, "storage"),
    ARTIFACT_STORAGE_TYPE: "local",
    ARTIFACT_LOCAL_BASE_PATH: artifactDir,
    ARTIFACT_HTTP_PORT: String(artifactHttpPort),
    ENV: "local",
    LOG_LEVEL: "info",
    TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE: "stigmer_runner",
    TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE: "stigmer_runner",
    // Test hermeticity: never let the server phone the cloud registry
    // endpoint from CI — the bundled registry is the fixture.
    STIGMER_MODEL_REGISTRY_REFRESH: "off",
  };

  const server = spawn(serverBin, [], { env: serverEnv, stdio: ["ignore", "pipe", "pipe"] });

  // Opt-in: tee server logs for the post-approval resume-wedge probe (see diag.ts).
  if (diagEnabled()) {
    const serverLog = fs.createWriteStream(diagLogPath("server"), { flags: "w" });
    server.stdout?.on("data", (d: Buffer) => serverLog.write(d));
    server.stderr?.on("data", (d: Buffer) => serverLog.write(d));
  }

  if (!server.pid) {
    temporal.kill();
    throw new Error(`Failed to spawn stigmer-server at ${serverBin}. Build with: make build`);
  }
  drainStdio(server);

  await waitForPort(apiPort, "127.0.0.1", 30_000, 500);
  console.log(`[e2e] stigmer-server ready (pid: ${server.pid})`);

  // 3. Unified runner (static mode, compiled JS)
  console.log("[e2e] Starting unified runner (static mode)...");
  const runnerDir = findRunnerDir();
  const entrypoint = resolveRunnerEntrypoint(runnerDir);

  const runnerEnv: Record<string, string> = {
    ...process.env as Record<string, string>,
    MODE: "local",
    TEMPORAL_SERVICE_ADDRESS: `127.0.0.1:${temporalPort}`,
    TEMPORAL_NAMESPACE: "default",
    STIGMER_BACKEND_ENDPOINT: `http://127.0.0.1:${apiPort}`,
    STIGMER_SERVER_ADDRESS: `127.0.0.1:${apiPort}`,
    STIGMER_TASK_QUEUE: "stigmer_runner",
    WORKSPACE_ROOT_DIR: path.join(tempDir, "workspace"),
    LOG_LEVEL: "info",
    // STIGMER_BACKEND_ENDPOINT stays the real server even with the mock proxy:
    // main.ts only redirects the Cursor SDK + LLM traffic through the proxy, so
    // runner->server status streaming is unaffected.
    ...(opts.mockLlmEndpoint !== undefined
      ? {
          // Route LLM calls to the mock proxy (a base-URL override, NOT a model
          // name). STIGMER_TOKEN is required by the runner whenever a proxy is
          // set; the mock ignores it and the OSS server is no-auth.
          STIGMER_PROXY_ENDPOINT: opts.mockLlmEndpoint,
          STIGMER_TOKEN: "e2e-mock-token",
          // Setting a proxy flips two runner defaults that would otherwise throw
          // at setup: artifacts would default to presign (network) and, in cloud
          // mode, the checkpointer to http. Pin both to local/memory. The
          // interrupt/resume approval gate needs a checkpointer (memory is fine).
          //
          // File-gate mode (fileGates): the runner instead boots with NO
          // artifact store at all — no capture substrate on a non-git
          // workspace, so file writes gate pre-execution (deny-gate, DD-22).
          ...(opts.fileGates
            ? { ARTIFACT_STORAGE_TYPE: "none" }
            : {
                ARTIFACT_STORAGE_TYPE: "local",
                // Same directory the server writes to, and the server's artifact
                // file server for blob downloads (#285).
                LOCAL_ARTIFACT_PATH: artifactDir,
                LOCAL_ARTIFACT_SERVE_URL: `http://127.0.0.1:${artifactHttpPort}`,
              }),
          STIGMER_CHECKPOINTER_TYPE: "memory",
          // Avoid a boot-time MCP backfill network call (hermetic test detail).
          SKIP_MCP_CONNECT_BACKFILL: "true",
        }
      : {}),
  };

  const runnerOutput: string[] = [];
  const runner = spawn("node", [entrypoint], {
    cwd: runnerDir,
    env: runnerEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  runner.stdout?.on("data", (data: Buffer) => runnerOutput.push(data.toString()));
  runner.stderr?.on("data", (data: Buffer) => runnerOutput.push(data.toString()));

  // Opt-in: tee runner logs for the post-approval resume-wedge probe (see diag.ts).
  if (diagEnabled()) {
    const runnerLog = fs.createWriteStream(diagLogPath("runner"), { flags: "w" });
    runner.stdout?.on("data", (d: Buffer) => runnerLog.write(d));
    runner.stderr?.on("data", (d: Buffer) => runnerLog.write(d));
  }

  if (!runner.pid) {
    temporal.kill();
    server.kill();
    throw new Error("Failed to spawn unified runner");
  }

  try {
    await waitForOutput(runner, /Worker ready, polling for tasks/i, 30_000);
  } catch (err) {
    const tail = runnerOutput.slice(-20).join("");
    throw new Error(
      `Unified runner failed to start.\n` +
      `  Entrypoint: ${entrypoint}\n` +
      `  Last output:\n${tail}\n` +
      `  Original error: ${err instanceof Error ? err.message : err}`,
    );
  }
  console.log(`[e2e] Unified runner ready (pid: ${runner.pid})`);

  return {
    reused: false,
    temporalPid: temporal.pid,
    serverPid: server.pid,
    runnerPid: runner.pid,
    tempDir,
  };
}

export function stopBackendStack(state: ServerState): void {
  if (state.reused) return;

  const pids = [state.runnerPid, state.serverPid, state.temporalPid];
  for (const pid of pids) {
    if (pid) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // Process may have already exited
      }
    }
  }

  if (state.tempDir) {
    try {
      fs.rmSync(state.tempDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
}
