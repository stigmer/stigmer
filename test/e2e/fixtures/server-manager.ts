import { spawn, type ChildProcess } from "node:child_process";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

export interface ServerState {
  reused: boolean;
  temporalPid?: number;
  serverPid?: number;
  runnerPid?: number;
  tempDir?: string;
}

const REPO_ROOT = path.resolve(__dirname, "../../..");

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
}): Promise<ServerState> {
  const apiPort = opts.apiPort ?? 7234;
  const temporalPort = opts.temporalPort ?? 7233;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stigmer-e2e-"));

  fs.mkdirSync(path.join(tempDir, "storage"), { recursive: true });
  fs.mkdirSync(path.join(tempDir, "data"), { recursive: true });
  fs.mkdirSync(path.join(tempDir, "workspace"), { recursive: true });

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
    ARTIFACT_LOCAL_BASE_PATH: path.join(tempDir, "data"),
    ENV: "local",
    LOG_LEVEL: "info",
    TEMPORAL_AGENT_EXECUTION_RUNNER_TASK_QUEUE: "stigmer_runner",
    TEMPORAL_WORKFLOW_EXECUTION_RUNNER_TASK_QUEUE: "stigmer_runner",
  };

  const server = spawn(serverBin, [], { env: serverEnv, stdio: ["ignore", "pipe", "pipe"] });

  if (!server.pid) {
    temporal.kill();
    throw new Error(`Failed to spawn stigmer-server at ${serverBin}. Build with: make build`);
  }

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
  };

  const runnerOutput: string[] = [];
  const runner = spawn("node", [entrypoint], {
    cwd: runnerDir,
    env: runnerEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  runner.stdout?.on("data", (data: Buffer) => runnerOutput.push(data.toString()));
  runner.stderr?.on("data", (data: Buffer) => runnerOutput.push(data.toString()));

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
