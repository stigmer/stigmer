// Boots the TypeScript unified runner in static mode and waits for it to begin
// polling its Temporal task queue.
// Domain: conformance harness (execution engine).
//
// The runner is the execution engine: the server dispatches the real work to
// it over Temporal (queue `stigmer_runner`). We run the compiled entry
// (`node dist/main.js`) rather than tsx so the on-boot Temporal workflow bundle
// is built from compiled JS, which sidesteps the raw-.ts proto-stub bundler
// failure. Readiness is the runner's own stdout marker (printed once the
// Temporal connection is up and the worker is about to poll) — the execution
// analogue of server-process.ts waiting for a TCP listener.
//
// The runner runs in its PRODUCTION OSS POSTURE, not a test-only one (entry
// 20260910.02, DD-002). Two things follow:
//
// - The model registry comes from the control plane. The runner resolves a
//   registry id (`claude-haiku-4.5`) to the provider's api id by fetching
//   /v1/proxy/model-registry from the origin STIGMER_CLOUD_API_URL names, else
//   the proxy origin, else the backend (shared/registry-endpoint.ts, #240).
//   With the LLM proxy pointed at the mock, the fallback chain would ask the
//   MOCK for the registry, 404, and every execution would run with an
//   unresolved registry — a posture no OSS install has. `registryOrigin` pins
//   the origin that really serves it: the server here, the composition's
//   HTTP address on cloud-execution.
// - The checkpointer is the runner's own default. In local mode that is the
//   durable SQLite saver (config.ts, #204) — the one every OSS user runs and
//   the one HITL/pause/resume actually resume across. It lives under
//   `$HOME/.stigmer/sessions/<id>/`, so the runner child gets a harness-owned
//   HOME (the override the runner itself documents for tests), and nothing a
//   run writes lands in the developer's real home directory. The runner's git
//   substrate never reads the user's gitconfig — it authors its snapshot
//   objects with an explicit identity — so a bare HOME is safe for file review.
//
// For a data-only set_vars WorkflowExecution this needs no LLM, MCP, API key,
// proxy, or object storage: jq runs in-process and the only egress is gRPC
// back to the server. So the bare env is the default.
//
// An AgentExecution, by contrast, runs an LLM loop. When `proxy` is supplied the
// runner is pointed at the mock LLM proxy (a base-URL override via
// STIGMER_PROXY_ENDPOINT). Configuring a proxy flips one runner default —
// artifact storage would default to `proxy` against the mock (which serves no
// presign routes -> setup-time throw) — so artifacts default to a local store,
// UNLESS `artifactProxy` routes them at a real presign-capable endpoint via
// STIGMER_ARTIFACT_PROXY_ENDPOINT (stigmer#803): the cloud-execution target
// points artifacts at the composition's HTTP port while LLM traffic stays on
// the mock.
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stopChild, teeChildOutput } from "./child-process";
import { runnerDir } from "./runner-build";

// The runner bundles its Temporal workflows on boot, so first-poll readiness is
// slower than a plain listener; give it generous headroom.
const READY_TIMEOUT_MS = 60_000;
const READY_POLL_MS = 100;
const LOG_TAIL_BYTES = 8_000;
// SIGTERM starts the runner's graceful shutdown (main.ts: `manager.shutdown()`
// drains the Temporal worker). Every suite awaits its executions' terminal
// phase before teardown, so the drain has nothing in flight and exit is
// prompt; the bound only exists so a wedged drain cannot hang the vitest run.
const SHUTDOWN_GRACE_MS = 30_000;

// Two lines the runner prints that this harness reads back (runner/src/runner.ts,
// `start()`): the first immediately before the worker begins polling, the
// second once `worker.run()` has returned — the Temporal worker has drained and
// stopped, and whatever the process does next is no longer the worker's.
const READY_MARKER = "Worker ready, polling for tasks";
const WORKER_STOPPED_MARKER = "Worker stopped";

// How much of the runner's output the SIGKILL-fallback line quotes. Enough to
// show the whole shutdown sequence as the runner actually prints it: the
// Temporal SDK logs each `Worker state changed` as a five-line object, so
// `Received SIGTERM`, the four state changes and the marker are ~22 lines —
// short ones, so the excerpt stays around a kilobyte. The per-line clip is for
// the odd long line (an activity's completion summary, say), not the norm.
const FORCE_KILL_EXCERPT_LINES = 24;
const FORCE_KILL_EXCERPT_LINE_CHARS = 240;

// The env that relocates the runner's `~/.stigmer` under a harness-owned
// directory. Both names because the runner's home reader
// (shared/workspace/platform-dir.ts) checks HOME then USERPROFILE, and Node's
// os.homedir() — which the workspace-root and artifact defaults go through —
// reads the same two on the platforms the harness runs on. Exported so the
// unit arm pins the pair, and shared with the manager-mode spawner.
export function runnerHomeEnv(homeDir: string): Record<string, string> {
  return { HOME: homeDir, USERPROFILE: homeDir };
}

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
  // Mutually exclusive with cloudBootstrap: an explicit address makes the
  // runner skip its control-plane discovery entirely (bootstrap.ts branch 1).
  temporalHostPort?: string;
  // http(s) base URL of the backend's gRPC endpoint, for status streaming.
  backendEndpoint: string;
  // http(s) origin that serves /v1/proxy/model-registry — the control plane
  // the runner resolves model ids against (STIGMER_CLOUD_API_URL). The server's
  // base URL on the local targets; the composition's HTTP address on cloud.
  // Required, never defaulted: the runner's own fallback would ask the mock
  // proxy, and an unresolved registry fails no test on its own (see header).
  registryOrigin: string;
  // Cloud engine wiring: boot as a production embedded runner. The token is a
  // user credential (the primary conformance user); its presence — with NO
  // explicit Temporal address — triggers the runner's own bootstrap lane
  // (bootstrap.ts branch 2): getRunnerBootstrapConfig returns the Temporal
  // coordinates and mints the embedded_runner proxy token, the same door a
  // desktop embedder walks through. The user identity is what makes cloud
  // authorization work: runner credentials carry the user as `sub`, so FGA
  // authorizes the runner as the owner of the executions the suites create.
  cloudBootstrap?: { token: string };
  // Optional hermetic LLM wiring; present only for agent-execution runs.
  proxy?: RunnerProxyOptions;
  // The server's artifact root + serve URL. When provided (with a proxy), the
  // runner shares the server's local store so a storage-key attachment the
  // server wrote resolves here (#285). Omitted → a throwaway store, which is
  // fine for runs that never resolve a cross-process artifact.
  artifactDir?: string;
  artifactServeUrl?: string;
  // Presign-capable artifact lane (stigmer#803): base URL of a REAL service
  // serving /v1/proxy/artifacts/... (the hermetic Java service's HTTP port).
  // Routes the runner's artifact storage there via
  // STIGMER_ARTIFACT_PROXY_ENDPOINT while LLM traffic stays on `proxy`.
  // Mutually exclusive with artifactDir (shared-local vs proxy store).
  artifactProxy?: { endpoint: string };
  // When set, the runner's combined stdout/stderr is also streamed to this
  // file (directory created as needed). The cloud-execution target points it
  // under test/integration/.test-output/logs/ so a red CI run's uploaded
  // environment-logs artifact carries the runner's side of the story — the
  // in-memory logTail() only surfaces on SPAWN failure, which leaves an
  // execution that failed mid-run undiagnosable after teardown.
  logFile?: string;
}

export interface RunningRunner {
  // Last ~8KB of combined stdout/stderr, surfaced in failures for diagnosis.
  logTail(): string;
  // The runner's HOME for this run — where its `~/.stigmer/sessions/<id>/…`
  // tree lands (session checkpoints, the platform dir attachments materialize
  // into). A suite that reads what the runner wrote to disk reads under this,
  // never under the test process's own home.
  homeDir: string;
  stop(): Promise<void>;
}

export async function spawnRunner(opts: RunnerOptions): Promise<RunningRunner> {
  if ((opts.temporalHostPort === undefined) === (opts.cloudBootstrap === undefined)) {
    throw new Error(
      "spawnRunner needs exactly one of temporalHostPort (local engine) or " +
        "cloudBootstrap (embedded-runner discovery); got " +
        (opts.temporalHostPort === undefined ? "neither" : "both"),
    );
  }
  const workspaceDir = await mkdtemp(join(tmpdir(), "stigmer-conformance-runner-"));
  // The runner's home for this run: its `~/.stigmer` (session checkpoints,
  // platform dirs, workspace locks) lands here and is removed with it.
  const homeDir = await mkdtemp(join(tmpdir(), "stigmer-conformance-runner-home-"));
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
      ...runnerHomeEnv(homeDir),
      // STIGMER_RUNNER_MODE intentionally unset -> static (single-queue) mode.
      MODE: "local",
      STIGMER_TASK_QUEUE: "stigmer_runner",
      STIGMER_CLOUD_API_URL: opts.registryOrigin,
      // Local engine: pin the Temporal address (skips discovery). Cloud engine:
      // deliberately UNSET, so the token below triggers the runner's own
      // bootstrap discovery against the backend (bootstrap.ts branch 2).
      ...(opts.temporalHostPort !== undefined
        ? { TEMPORAL_SERVICE_ADDRESS: opts.temporalHostPort, TEMPORAL_NAMESPACE: "default" }
        : {}),
      STIGMER_BACKEND_ENDPOINT: opts.backendEndpoint,
      // The runner's one token env var serves control-plane auth AND (until a
      // token is minted) the proxy bearer. Cloud bootstrap needs the USER
      // credential here — discovery authenticates with it, and the coordinator
      // swaps the proxy sink to the minted embedded_runner token afterwards —
      // so it wins over the proxy's placeholder (which the mock ignores anyway).
      ...(opts.cloudBootstrap !== undefined ? { STIGMER_TOKEN: opts.cloudBootstrap.token } : {}),
      WORKSPACE_ROOT_DIR: workspaceDir,
      LOG_LEVEL: "info",
      // Avoid a boot-time MCP backfill network call (hermetic test detail).
      SKIP_MCP_CONNECT_BACKFILL: "true",
      // Hermetic LLM wiring, only when an agent execution needs it. Absent for the
      // data-only WorkflowExecution path, which stays fully offline. When present:
      // - STIGMER_PROXY_ENDPOINT/STIGMER_TOKEN route LLM calls to the mock proxy;
      // - artifacts go to a local on-disk store (a configured proxy would
      //   otherwise default artifacts to presign calls against the mock and
      //   throw at setup) — UNLESS artifactProxy routes them at a real
      //   presign-capable endpoint (stigmer#803).
      // STIGMER_CHECKPOINTER_TYPE is deliberately NOT set: MODE=local makes the
      // runner pick its production default, the durable SQLite saver under the
      // harness-owned HOME above (header; entry 20260910.02 ruling 2).
      ...(opts.proxy !== undefined
        ? {
            STIGMER_PROXY_ENDPOINT: opts.proxy.endpoint,
            ...(opts.cloudBootstrap === undefined ? { STIGMER_TOKEN: opts.proxy.token } : {}),
            // The mock proxy speaks ONLY Anthropic. Background LLM callers
            // (session titling, #690) route by config.primaryModel, whose
            // baked default is an OpenAI model — without this pin their
            // requests leave on the OpenAI proxy path, where the mock cannot
            // recognize or answer them, and historically they silently ATE
            // queued agent turns (#715). Keep every LLM caller on the one
            // provider the mock implements.
            STIGMER_PRIMARY_MODEL: "claude-sonnet-4-6",
            ...(opts.artifactProxy !== undefined
              ? {
                  ARTIFACT_STORAGE_TYPE: "proxy",
                  STIGMER_ARTIFACT_PROXY_ENDPOINT: opts.artifactProxy.endpoint,
                }
              : {
                  ARTIFACT_STORAGE_TYPE: "local",
                  LOCAL_ARTIFACT_PATH: artifactDir,
                  // Point blob downloads at the server's artifact file server
                  // when we know it; the runner's own reads go straight to
                  // disk regardless.
                  ...(opts.artifactServeUrl !== undefined
                    ? { LOCAL_ARTIFACT_SERVE_URL: opts.artifactServeUrl }
                    : {}),
                }),
          }
        : {}),
    },
  });

  // STIGMER_CONFORMANCE_LOG_DIR: the same teardown-surviving tee the
  // server harness offers, for diagnosing writer-ordering races that need
  // the runner's cancellation/persist lines (see server-process.ts).
  const teeFile =
    opts.logFile ??
    (process.env.STIGMER_CONFORMANCE_LOG_DIR
      ? join(
          process.env.STIGMER_CONFORMANCE_LOG_DIR,
          `runner-${Date.now()}.log`,
        )
      : undefined);
  let ready = false;
  const output = teeChildOutput(child, {
    tailBytes: LOG_TAIL_BYTES,
    file: teeFile,
    onChunk: (text) => {
      if (text.includes(READY_MARKER)) ready = true;
    },
  });

  let exit: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  child.on("exit", (code, signal) => {
    exit = { code, signal };
  });

  const stop = async (): Promise<void> => {
    // SIGTERM triggers the runner's graceful shutdown (drains the worker).
    // The order is the discipline child-process.ts documents: exit first,
    // then the tee (its sink ends only once stdio has closed — the runner's
    // shutdown lines land in the file instead of throwing write-after-end),
    // then the directories the runner was still using.
    await stopChild(child, {
      signal: "SIGTERM",
      graceMs: SHUTDOWN_GRACE_MS,
      onForceKill: () => console.error(describeRunnerForceKill(output.tail())),
    });
    await output.close();
    await rm(workspaceDir, { recursive: true, force: true });
    await rm(homeDir, { recursive: true, force: true });
    // Only remove a store we minted; a server-shared dir is the server's to clean.
    if (ownedArtifactDir !== undefined) {
      await rm(ownedArtifactDir, { recursive: true, force: true });
    }
  };

  try {
    await waitForReady(
      () => ready,
      () => exit,
      () => output.tail(),
    );
  } catch (err) {
    await stop();
    throw err;
  }

  return {
    logTail: () => output.tail(),
    homeDir,
    stop,
  };
}

// The line stop() prints when the runner outlives its grace and is SIGKILLed.
// It has to carry its own evidence: on a green CI run the runner's log file is
// not retained (the workflow uploads logs on failure only), so the job log is
// the only surface a reader has, and "the harness had to kill a runner" alone
// cannot say whether that is stigmer#1008 — the worker drained and stopped,
// then the process idled instead of exiting — or a hang of a new shape where
// the drain itself never finished (stigmer#1010).
//
// The verdict is decided on the one axis #1008 is defined by: did the runner
// print WORKER_STOPPED_MARKER? A line-exact match anywhere in the tail — not
// "the last line", because the runner may legitimately print after the worker
// stops (a parked Cursor agent being closed, say), and such a line must not
// turn a #1008 hang into a false alarm. Whatever followed the marker is in the
// quoted excerpt, where a reader can see it, not folded into the verdict.
// Pure, so the unit arms drive it directly; it never throws, because it runs
// inside stopChild's grace timer during teardown.
export function describeRunnerForceKill(tail: string): string {
  const lines = tail.split(/\r?\n/);
  const workerStopped = lines.some((line) => line.trim() === WORKER_STOPPED_MARKER);
  const verdict = workerStopped
    ? 'worker="stopped" — the process idled after its worker drained (stigmer#1008)'
    : 'worker="not stopped" — the drain itself did not finish; NOT the #1008 shape, read the runner log';
  return (
    `[runner] did not exit within ${SHUTDOWN_GRACE_MS}ms of SIGTERM — SIGKILL fallback; ${verdict}\n` +
    `[runner] last output:\n${quoteLastLines(lines)}`
  );
}

// The tail's last non-blank lines as an indented quotation, each clipped so one
// long line (an activity's completion summary, say) cannot swallow the log.
function quoteLastLines(lines: string[]): string {
  const kept = lines.filter((line) => line.trim() !== "").slice(-FORCE_KILL_EXCERPT_LINES);
  if (kept.length === 0) return "    | (no runner output captured)";
  return kept
    .map((line) =>
      line.length > FORCE_KILL_EXCERPT_LINE_CHARS
        ? `    | ${line.slice(0, FORCE_KILL_EXCERPT_LINE_CHARS)}…`
        : `    | ${line}`,
    )
    .join("\n");
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
