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
// only egress is gRPC back to the server. So the bare env is the default.
//
// An AgentExecution, by contrast, runs an LLM loop. When `proxy` is supplied the
// runner is pointed at the mock LLM proxy (a base-URL override via
// STIGMER_PROXY_ENDPOINT) and switched to fully local artifacts/checkpointer, so
// the run stays hermetic. Configuring a proxy flips two runner defaults — artifact
// storage would default to `proxy` (presign calls -> setup-time throw) and, in
// cloud mode, the checkpointer to `http` — so we pin both to local/memory.
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

// Hermetic LLM wiring for agent executions. Omit it entirely for the data-only
// WorkflowExecution path, which must stay LLM-free.
export interface RunnerProxyOptions {
  // Base URL of the mock LLM proxy (becomes STIGMER_PROXY_ENDPOINT). The runner
  // appends the provider path; the proxy serves canned Anthropic SSE.
  endpoint: string;
  // Bearer token sent to the proxy. The mock ignores it and the OSS server is
  // no-auth, but the runner requires STIGMER_TOKEN whenever a proxy is set.
  token: string;
}

export interface RunnerOptions {
  // Absolute path to the runner's compiled entry (dist/main.js).
  entryPath: string;
  // host:port of the live Temporal frontend the runner should connect to.
  temporalHostPort: string;
  // http(s) base URL of the Go server's gRPC endpoint, for status streaming.
  backendEndpoint: string;
  // Optional hermetic LLM wiring; present only for agent-execution runs.
  proxy?: RunnerProxyOptions;
  // The server's artifact root + serve URL. When provided (with a proxy), the
  // runner shares the server's local store so a storage-key attachment the
  // server wrote resolves here (#285). Omitted → a throwaway store, which is
  // fine for runs that never resolve a cross-process artifact.
  artifactDir?: string;
  artifactServeUrl?: string;
}

export interface RunningRunner {
  // Last ~8KB of combined stdout/stderr, surfaced in failures for diagnosis.
  logTail(): string;
  stop(): Promise<void>;
}

export async function spawnRunner(opts: RunnerOptions): Promise<RunningRunner> {
  const workspaceDir = await mkdtemp(join(tmpdir(), "stigmer-conformance-runner-"));
  // Share the server's artifact store when given (#285); otherwise mint a
  // throwaway one. Only a dir we minted here is ours to remove on stop — the
  // server owns and cleans its own.
  const ownedArtifactDir =
    opts.artifactDir === undefined
      ? await mkdtemp(join(tmpdir(), "stigmer-conformance-artifacts-"))
      : undefined;
  const artifactDir = opts.artifactDir ?? ownedArtifactDir!;

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
      // Hermetic LLM wiring, only when an agent execution needs it. Absent for the
      // data-only WorkflowExecution path, which stays fully offline. When present:
      // - STIGMER_PROXY_ENDPOINT/STIGMER_TOKEN route LLM calls to the mock proxy;
      // - ARTIFACT_STORAGE_TYPE=local keeps artifacts on disk (a configured proxy
      //   would otherwise default artifacts to presign calls and throw at setup);
      // - STIGMER_CHECKPOINTER_TYPE=memory pins the in-memory checkpointer.
      ...(opts.proxy !== undefined
        ? {
            STIGMER_PROXY_ENDPOINT: opts.proxy.endpoint,
            STIGMER_TOKEN: opts.proxy.token,
            // The mock proxy speaks ONLY Anthropic. Background LLM callers
            // (session titling, #690) route by config.primaryModel, whose
            // baked default is an OpenAI model — without this pin their
            // requests leave on the OpenAI proxy path, where the mock cannot
            // recognize or answer them, and historically they silently ATE
            // queued agent turns (#715). Keep every LLM caller on the one
            // provider the mock implements.
            STIGMER_PRIMARY_MODEL: "claude-sonnet-4-6",
            ARTIFACT_STORAGE_TYPE: "local",
            LOCAL_ARTIFACT_PATH: artifactDir,
            // Point blob downloads at the server's artifact file server when we
            // know it; the runner's own reads go straight to disk regardless.
            ...(opts.artifactServeUrl !== undefined
              ? { LOCAL_ARTIFACT_SERVE_URL: opts.artifactServeUrl }
              : {}),
            STIGMER_CHECKPOINTER_TYPE: "memory",
          }
        : {}),
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
    // Only remove a store we minted; a server-shared dir is the server's to clean.
    if (ownedArtifactDir !== undefined) {
      await rm(ownedArtifactDir, { recursive: true, force: true });
    }
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
