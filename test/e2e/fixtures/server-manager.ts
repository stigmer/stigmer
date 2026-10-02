// The e2e backend stack: Temporal, the server and the runner, booted through
// test/support's spawns. Domain: e2e harness (web console against a live
// backend stack).
//
// The spawns are the ones the conformance execution suites boot, so the
// console journeys run against the same stack posture conformance proves:
// the runner in its production OSS posture (its durable checkpointer under a
// harness-owned HOME, the model registry from the server, every LLM caller
// pinned to the one provider the mock speaks). What stays e2e's own is the
// shape a run asks for — the pinned API port the console is configured with,
// the mock-LLM wiring, the file-gate runner, the server env of the OIDC and
// OAuth MCP postures — and the state file Playwright's worker processes read
// it from.
//
// Playwright runs globalSetup and globalTeardown in the SAME (main) process, so
// the running handles live in a module singleton between the two; the state
// file carries only what workers need.
import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import { runnerEntryPath } from "@stigmer/test-support/runner-build";
import { spawnRunner, type RunningRunner } from "@stigmer/test-support/runner-process";
import { spawnServer, type RunningServer } from "@stigmer/test-support/server-process";
import { waitForPortRefusal } from "@stigmer/test-support/ports";
import { spawnTemporal, type RunningTemporal } from "@stigmer/test-support/temporal";
import { tsServerEntryPath } from "@stigmer/test-support/ts-build";
import { diagEnabled, diagLogPath } from "./diag";

/** What global setup records for the worker processes (`.e2e-server-state.json`). */
export interface ServerState {
  // True when a developer's running backend on the API port was reused, so
  // this run booted nothing and tears nothing down.
  reused: boolean;
  // The mock LLM proxy's control URL, when the stack was booted with
  // STIGMER_E2E_MOCK_LLM. Specs program the proxy over it. Absent on a
  // normal (real-LLM) boot.
  mockLlmControlUrl?: string;
  // True when the runner was booted with NO artifact store (STIGMER_E2E_FILE_GATES):
  // file writes take the pre-execution approval gate instead of apply-then-review.
  // Specs read it to skip against the wrong stack shape.
  fileGateMode?: boolean;
  // The OAuth MCP fixture's URLs, when the stack was booted in that shape
  // (STIGMER_E2E_OAUTH_MCP); the spec reads them to name the server a fixture
  // plugin installs.
  oauthMcp?: { readonly mcpUrl: string; readonly authorizationServer: string };
}

/** Whether something accepts connections on the port now (the shared probe: @stigmer/test-support/ports). */
export { isPortReachable } from "@stigmer/test-support/ports";

// The suite boots the built entries directly, bypassing the CLI, so the stack
// is hermetic; building is the caller's step (the Make targets build first).
function builtEntry(entry: string, buildCommand: string, what: string): string {
  if (fs.existsSync(entry)) return entry;
  throw new Error(`${what} not built: ${entry} not found.\n  Run: ${buildCommand}`);
}

interface RunningStack {
  // The fixed port the stack's server took, handed to the next run once the
  // stack is stopped and the port refuses connections.
  readonly apiPort: number;
  readonly temporal: RunningTemporal;
  readonly server: RunningServer;
  readonly runner: RunningRunner;
  // Fixture processes a stack shape adds (the OIDC issuer, the OAuth MCP
  // fixture), stopped with the stack.
  readonly fixtures: ChildProcess[];
}

let stack: RunningStack | undefined;

export async function startBackendStack(opts: {
  apiPort: number;
  // When set, the runner is pointed at this mock LLM proxy base URL
  // (STIGMER_PROXY_ENDPOINT), so agent executions stay hermetic and
  // deterministic.
  mockLlmEndpoint?: string;
  // When set (with mockLlmEndpoint), the RUNNER boots with no artifact store
  // (ARTIFACT_STORAGE_TYPE=none): a non-git workspace then has no capture
  // substrate, so file writes gate pre-execution (deny-gate mode) — the stack
  // shape the file-diff gate-card specs need. The server keeps its own
  // artifact config; only the runner's capture substrate is removed.
  fileGates?: boolean;
  // Layered over the server's env after the stack's own values — a stack
  // SHAPE the caller chooses (the OIDC posture: STIGMER_OIDC_ISSUER /
  // _AUDIENCE / _CONSOLE_CLIENT_ID), never a knob a spec flips.
  extraServerEnv?: Record<string, string>;
}): Promise<ServerState> {
  if (stack !== undefined) throw new Error("[e2e] the backend stack is already running");
  const serverEntry = builtEntry(tsServerEntryPath(), "make build-server", "stigmer-server");
  const runnerEntry = builtEntry(
    runnerEntryPath(),
    "npm run build -w @stigmer/protos && npm run build -w @stigmer/runner (or make build-runner)",
    "Unified runner",
  );
  // STIGMER_E2E_DIAG (fixtures/diag.ts): each stream's log starts fresh with
  // the run, as the mock's does, and the server logs at info, so the three
  // logs cover the same run at the depth the resume probe reads.
  const diag = diagEnabled();
  if (diag) for (const name of ["server", "runner"]) fs.writeFileSync(diagLogPath(name), "");

  // A free Temporal port, never the fixed 7233, so a developer's live dev stack
  // (its own Temporal and a runner polling the same queue) cannot poach this
  // stack's executions.
  console.log("[e2e] Starting Temporal dev server...");
  const temporal = await spawnTemporal();
  console.log(`[e2e] Temporal ready on ${temporal.hostPort}`);

  let server: RunningServer | undefined;
  try {
    console.log(`[e2e] Starting stigmer-server on :${opts.apiPort}...`);
    server = await spawnServer(process.execPath, {
      args: [serverEntry],
      port: opts.apiPort,
      temporalHostPort: temporal.hostPort,
      env: { ...(diag ? { LOG_LEVEL: "info" } : {}), ...opts.extraServerEnv },
      logFile: diag ? diagLogPath("server") : undefined,
    });
    console.log(`[e2e] stigmer-server ready on ${server.baseUrl}`);

    console.log("[e2e] Starting unified runner (static mode)...");
    const runner = await spawnRunner({
      entryPath: runnerEntry,
      temporalHostPort: temporal.hostPort,
      backendEndpoint: server.baseUrl,
      registryOrigin: server.baseUrl,
      ...(opts.mockLlmEndpoint !== undefined
        ? {
            // The mock ignores the bearer and the OSS server is no-auth.
            proxy: { endpoint: opts.mockLlmEndpoint, token: "e2e-mock-token" },
            ...(opts.fileGates === true
              ? { artifactStore: "none" as const }
              : { artifactDir: server.artifactBaseDir, artifactServeUrl: server.artifactServeUrl }),
          }
        : {}),
      logFile: diag ? diagLogPath("runner") : undefined,
    });
    console.log("[e2e] Unified runner ready");

    stack = { apiPort: opts.apiPort, temporal, server, runner, fixtures: [] };
  } catch (error) {
    await server?.stop();
    await temporal.stop();
    throw error;
  }
  return { reused: false };
}

/** Stops a fixture process with the stack (the OIDC issuer, the OAuth MCP fixture). */
export function adoptStackFixture(child: ChildProcess): void {
  if (stack === undefined) throw new Error("[e2e] no backend stack to adopt a fixture into");
  stack.fixtures.push(child);
}

/**
 * Stops the stack this process started, runner first, every process even when
 * one fails, then waits until its API port refuses connections, so the next
 * run can take the port (stigmer#1594). Throws, naming the port, if something
 * still answers there after 15 s. Returns false when this process started no
 * stack.
 */
export async function stopBackendStack(): Promise<boolean> {
  const running = stack;
  stack = undefined;
  if (running === undefined) return false;
  // Best effort, like the pid sweep it replaced: one process failing to stop
  // must not leave the rest running.
  try {
    await running.runner.stop();
  } finally {
    try {
      await running.server.stop();
    } finally {
      try {
        await running.temporal.stop();
      } finally {
        for (const child of running.fixtures) child.kill("SIGTERM");
      }
    }
  }
  try {
    await waitForPortRefusal(running.apiPort, { timeoutMs: 15_000 });
  } catch (error) {
    throw new Error(
      `[e2e] the backend stack's processes have stopped, but its API port is not free: ${(error as Error).message}. ` +
        `A listener this stack does not know of holds it, or a stopped process has not released it yet (#1594).`,
    );
  }
  return true;
}
