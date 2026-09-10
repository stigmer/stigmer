// Boots the runner in MANAGER mode — the desktop's embedding shape — and drives
// its stdin/stdout IPC for the handshake smoke.
// Domain: conformance harness (execution engine).
//
// runner-process.ts boots the static single-queue runner every execution suite
// dispatches to. Manager mode is a different lifecycle: the host spawns the
// runner with STIGMER_RUNNER_MODE=manager, the runner connects to Temporal and
// then writes one `ready` line (its protocol version) to stdout, and from there
// the host drives it with line-delimited JSON commands (docs/guides/runners/
// ipc-protocol.mdx). The Rust host crate (crates/stigmer-runner-host) is the
// production host; this module is the harness's minimal one, enough to prove
// end to end that the real runner process advertises the version the hosts
// negotiate on and honors `shutdown` (entry 20260910.02, ruling 3 — the arm
// the Go harness's unified_runner.go carried).
//
// The message types are imported from the runner's own ipc-protocol.ts, the
// canonical definition, so this is NOT a third hand-mirror of the contract:
// a field rename there is a compile error here, not a golden-fixture drift.
// That file is pure (no imports, constants and interfaces only), which is what
// makes a by-path import across packages acceptable — the same package already
// builds and spawns the runner by path (runner-build.ts).
//
// stdout is protocol and stderr is logs (the runner redirects console.log to
// stderr in this mode), so the two are read separately: stdout line by line as
// responses, stderr into a tail for diagnosis.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { IpcCommand, IpcResponse } from "../../../../backend/services/runner/src/ipc-protocol";
import { stopChild } from "./child-process";
import { runnerDir } from "./runner-build";
import { runnerHomeEnv } from "./runner-process";

// The manager connects to Temporal and bundles workflows before `ready`; the
// static runner's first-poll budget is the right order of magnitude.
const READY_TIMEOUT_MS = 60_000;
// A response the host waits on after `ready` (shutdownComplete) drains the
// manager's workers; nothing is in flight in the smoke, so this is headroom.
const RESPONSE_TIMEOUT_MS = 30_000;
// After shutdownComplete the process exits on its own; the bound exists so a
// wedged exit cannot hang the vitest run.
const EXIT_GRACE_MS = 15_000;
const STDERR_TAIL_BYTES = 8_000;

export interface ManagerRunnerOptions {
  // Absolute path to the runner's compiled entry (dist/main.js).
  entryPath: string;
  temporalHostPort: string;
  backendEndpoint: string;
  // See runner-process.ts: the origin that serves /v1/proxy/model-registry.
  registryOrigin: string;
}

export interface ManagerRunner {
  // The handshake the runner opened with — protocolVersion is the contract.
  readonly ready: Extract<IpcResponse, { type: "ready" }>;
  // Writes one command line to the runner's stdin.
  send(command: IpcCommand): void;
  // The next response line the runner writes, or a timeout error naming what
  // was awaited and quoting the stderr tail.
  nextResponse(label: string): Promise<IpcResponse>;
  // Last ~8KB of the runner's stderr, for failure messages.
  stderrTail(): string;
  // Waits for the process to exit (after `shutdown`), SIGKILLing past the grace.
  stop(): Promise<void>;
}

export async function spawnManagerRunner(opts: ManagerRunnerOptions): Promise<ManagerRunner> {
  const workspaceDir = await mkdtemp(join(tmpdir(), "stigmer-conformance-manager-runner-"));
  const homeDir = await mkdtemp(join(tmpdir(), "stigmer-conformance-manager-runner-home-"));

  const child = spawn(process.execPath, [opts.entryPath], {
    cwd: runnerDir(),
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...runnerHomeEnv(homeDir),
      STIGMER_RUNNER_MODE: "manager",
      MODE: "local",
      TEMPORAL_SERVICE_ADDRESS: opts.temporalHostPort,
      TEMPORAL_NAMESPACE: "default",
      STIGMER_BACKEND_ENDPOINT: opts.backendEndpoint,
      STIGMER_CLOUD_API_URL: opts.registryOrigin,
      WORKSPACE_ROOT_DIR: workspaceDir,
      LOG_LEVEL: "info",
      SKIP_MCP_CONNECT_BACKFILL: "true",
    },
  });

  let stderrTail = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_BYTES);
  });

  // Responses queue up as they arrive; each nextResponse() takes the head or
  // waits for the next line. A line that is not JSON is a protocol violation
  // and is surfaced as such rather than skipped.
  const pending: IpcResponse[] = [];
  const waiters: Array<{ resolve: (r: IpcResponse) => void; reject: (e: Error) => void }> = [];
  let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  const failWaiters = (message: string): void => {
    for (const waiter of waiters.splice(0)) waiter.reject(new Error(`${message}\n--- runner stderr tail ---\n${stderrTail}`));
  };
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (line.trim() === "") return;
    let response: IpcResponse;
    try {
      response = JSON.parse(line) as IpcResponse;
    } catch {
      failWaiters(`manager runner wrote a non-JSON line on stdout (protocol channel): ${JSON.stringify(line)}`);
      return;
    }
    const waiter = waiters.shift();
    if (waiter !== undefined) waiter.resolve(response);
    else pending.push(response);
  });
  child.on("exit", (code, signal) => {
    exit = { code, signal };
    failWaiters(`manager runner exited (code=${code}, signal=${signal}) before the awaited response`);
  });

  const nextResponse = (label: string, timeoutMs = RESPONSE_TIMEOUT_MS): Promise<IpcResponse> => {
    const head = pending.shift();
    if (head !== undefined) return Promise.resolve(head);
    if (exit !== null) {
      return Promise.reject(
        new Error(`manager runner already exited (code=${exit.code}, signal=${exit.signal}) before ${label}`),
      );
    }
    return new Promise<IpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.findIndex((w) => w.resolve === settle);
        if (index !== -1) waiters.splice(index, 1);
        reject(new Error(`manager runner did not write ${label} within ${timeoutMs}ms\n--- runner stderr tail ---\n${stderrTail}`));
      }, timeoutMs);
      const settle = (response: IpcResponse): void => {
        clearTimeout(timer);
        resolve(response);
      };
      waiters.push({
        resolve: settle,
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
    });
  };

  const stop = async (): Promise<void> => {
    if (exit === null) {
      child.stdin.end();
      await stopChild(child, { signal: "SIGTERM", graceMs: EXIT_GRACE_MS });
    }
    await rm(workspaceDir, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
  };

  let ready: IpcResponse;
  try {
    ready = await nextResponse("the ready handshake", READY_TIMEOUT_MS);
  } catch (err) {
    await stop();
    throw err;
  }
  if (ready.type !== "ready") {
    await stop();
    throw new Error(`manager runner's first stdout line must be the ready handshake, got ${JSON.stringify(ready)}`);
  }

  return {
    ready,
    send: (command) => {
      child.stdin.write(`${JSON.stringify(command)}\n`);
    },
    nextResponse: (label) => nextResponse(label),
    stderrTail: () => stderrTail,
    stop,
  };
}
