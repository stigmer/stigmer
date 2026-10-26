// Boots the TypeScript unified runner in static mode and waits for it to begin
// polling its Temporal task queue.
// Domain: test support (stack spawns).
//
// The runner is the execution engine: the server dispatches the real work to
// it over Temporal (queue `stigmer_runner`). We run the compiled entry
// (`node dist/main.js`) rather than tsx so the on-boot Temporal workflow bundle
// is built from compiled JS, which sidesteps the raw-.ts proto-stub bundler
// failure. Readiness is the runner's own stdout marker (printed once the
// Temporal connection is up and the worker is about to poll) — the execution
// analogue of server-process.ts waiting for the server's ready line.
//
// The runner runs in its PRODUCTION OSS POSTURE, not a test-only one. Two
// things follow:
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
// A Run runs an LLM loop. Without `proxy` the runner calls its
// providers directly with whatever keys its environment holds (the live
// benchmark's direct mode). When `proxy` is supplied the runner is pointed at
// the mock LLM proxy (a base-URL override via
// STIGMER_PROXY_ENDPOINT). Configuring a proxy flips one runner default —
// artifact storage would default to `proxy` against the mock (which serves no
// presign routes -> setup-time throw) — so artifacts default to a local store,
// UNLESS `artifactProxy` routes them at a real presign-capable endpoint via
// STIGMER_ARTIFACT_PROXY_ENDPOINT (stigmer#803): the cloud-execution target
// points artifacts at the composition's HTTP port while LLM traffic stays on
// the mock. The artifact store is set in both modes (runnerArtifactEnv): in
// direct mode too, the runner's file-review blobs must land where the server
// reads them back (stigmer#2142).
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { stopChild, teeChildOutput } from "./child-process.ts";
import { runnerDir } from "./runner-build.ts";

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
// How long a healthy runner may take from SIGTERM to exit before this
// harness says so. The worker drains in milliseconds and the process has
// nothing else to wait on, so an exit measured in seconds means a handle —
// a timer, a socket, a child — outlived the worker. That is exactly the
// stigmer#1008 shape, and at 29 s it hid inside the 30 s grace above with
// no line printed: the fallback only speaks when the grace EXPIRES. This
// threshold gives a slow-but-not-forced exit a voice of its own. Generous
// against CI jitter (a real drain is ~2 ms) and far under the grace.
const PROMPT_EXIT_MS = 2_000;

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

// The env that picks the runner's artifact store, in either LLM mode: none,
// the presign-capable proxy lane, or the local directory at `artifactDir`
// (the server's, when shared). Never left to the runner's default, which is
// a directory under the harness-owned HOME that the server never reads: a
// non-git workspace's file-review blobs written there cannot be read back
// (stigmer#2142). Exported so the unit arm pins each posture.
export function runnerArtifactEnv(
  opts: Pick<RunnerOptions, "artifactStore" | "artifactProxy">,
  artifactDir: string,
): Record<string, string> {
  if (opts.artifactStore === "none") {
    return { ARTIFACT_STORAGE_TYPE: "none" };
  }
  if (opts.artifactProxy !== undefined) {
    return { ARTIFACT_STORAGE_TYPE: "proxy", STIGMER_ARTIFACT_PROXY_ENDPOINT: opts.artifactProxy.endpoint };
  }
  return { ARTIFACT_STORAGE_TYPE: "local", LOCAL_ARTIFACT_PATH: artifactDir };
}

// Hermetic LLM wiring for agent executions. Omit it entirely for direct mode,
// where the runner reaches real providers.
export interface RunnerProxyOptions {
  // Base URL of the mock LLM proxy (becomes STIGMER_PROXY_ENDPOINT). The runner
  // appends the provider path; the proxy serves canned Anthropic SSE.
  endpoint: string;
  // Bearer token sent to the proxy — and, because the runner has ONE token
  // variable (STIGMER_TOKEN) for the proxy bearer and its control-plane
  // credential alike, the credential the runner presents to the server as
  // its process. The mock ignores it. Against the trusted-local primary the
  // server verifies nothing, so any placeholder serves; against the
  // enforcing lane's sibling (enforcing-execution-lane.ts) this is the
  // operator's `stk_` API key, the Helm chart's install shape — the
  // runner's PROCESS credential, while each run it serves acts through the
  // run's own credential the server dispatched with it.
  token: string;
}

export interface RunnerOptions {
  // Absolute path to the runner's compiled entry (dist/main.js).
  entryPath: string;
  // The Node that runs the entry: this process's own unless a staged payload
  // brings its own (the desktop app's resources/runtime/node runs its
  // resources/runner/dist/main.js), so the payload runs as it ships.
  nodePath?: string;
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
  // The server's artifact root. When provided, the runner shares the server's
  // local store, with a proxy or without: a storage-key attachment the server
  // wrote resolves here (#285), and a file-review blob the runner wrote is read
  // back by the server (stigmer#2142). Omitted → a throwaway store, which is
  // fine for runs that never resolve a cross-process artifact. The runner mints
  // no download links from it, so it needs no serve URL.
  artifactDir?: string;
  // Presign-capable artifact lane (stigmer#803): base URL of a REAL service
  // serving /v1/proxy/artifacts/... (the hermetic Java service's HTTP port).
  // Routes the runner's artifact storage there via
  // STIGMER_ARTIFACT_PROXY_ENDPOINT while LLM traffic stays on `proxy`.
  // Mutually exclusive with artifactDir (shared-local vs proxy store).
  artifactProxy?: { endpoint: string };
  // `none` boots the runner with NO artifact store (ARTIFACT_STORAGE_TYPE=none,
  // with a proxy): a non-git workspace then has no capture substrate, so file
  // writes take the pre-execution approval gate instead of apply-then-review.
  // The e2e file-gate stack is the one shape that needs it. Requires a
  // proxy; mutually exclusive with artifactDir and artifactProxy.
  artifactStore?: "none";
  // When set, the runner's combined stdout/stderr is also streamed to this
  // file (directory created as needed). The cloud-execution target points it
  // under test/conformance/.test-output/logs/ so a red CI run's uploaded
  // environment-logs artifact carries the runner's side of the story — the
  // in-memory logTail() only surfaces on SPAWN failure, which leaves an
  // execution that failed mid-run undiagnosable after teardown. When neither
  // this nor STIGMER_CONFORMANCE_LOG_DIR is given, the tee still runs, into
  // `<homeDir>/runner.log`, removed with the home on stop: the runner's
  // `stigmer_timing` lines (the `turn_phases` and `execution_setup`
  // timelines) exist nowhere but its stdout, and the benchmark readers and
  // their smoke read them from this file.
  logFile?: string;
  // Where the runner sends its traces: an OTLP/HTTP JSON receiver's endpoint
  // and the login header it requires, with the conversation's text on, the
  // standard OpenTelemetry settings an operator would set
  // (docs/guides/self-hosting/tracing.mdx). Spans leave every 200 ms so a
  // suite reads a finished run's trace without waiting the SDK's 5 s.
  // Omitted, the runner exports nothing.
  telemetry?: { readonly endpoint: string; readonly login: string };
  // The runner's HOME and workspace root, owned by the caller: stop() and
  // kill() never remove them. A runner spawned on the directories another
  // left behind sees what that one wrote (its sqlite checkpoints and
  // workspace locks under HOME, the sessions' trees under the workspace
  // root), as a pod restarted on a durable volume does. Omitted, the runner
  // gets fresh directories of its own, removed with it.
  dirs?: RunnerDirs;
  // Settings the caller adds to the runner's environment, an operator's
  // choice such as STIGMER_SHELL_BACKGROUND_ENABLED (the live benchmark's
  // arm). Laid over this process's environment and under every variable
  // this module sets, so the stack's own wiring always wins.
  env?: Readonly<Record<string, string>>;
}

// A runner's two state directories (RunnerOptions.dirs).
export interface RunnerDirs {
  readonly homeDir: string;
  readonly workspaceDir: string;
}

// Fresh state directories a caller owns for a runner and its replacements
// (RunnerOptions.dirs); the caller removes them.
export async function makeRunnerDirs(): Promise<RunnerDirs> {
  return {
    homeDir: await mkdtemp(join(tmpdir(), "stigmer-conformance-runner-home-")),
    workspaceDir: await mkdtemp(join(tmpdir(), "stigmer-conformance-runner-")),
  };
}

export interface RunningRunner {
  // Last ~8KB of combined stdout/stderr, surfaced in failures for diagnosis.
  logTail(): string;
  // The file the runner's whole combined output is tee'd to (see
  // RunnerOptions.logFile): the one place a reader finds a `stigmer_timing`
  // line for an execution that ran minutes ago.
  logFile: string;
  // The runner's HOME for this run — where its `~/.stigmer/sessions/<id>/…`
  // tree lands (session checkpoints, the platform dir a conversation's Files
  // are mounted into). A suite that reads what the runner wrote to disk reads under this,
  // never under the test process's own home.
  homeDir: string;
  // The public address this runner was launched with
  // (STIGMER_MCP_PUBLIC_ENDPOINT): what it fills a declared but unsaved
  // STIGMER_SERVER_ADDRESS from, so a suite can name the value a fill delivers.
  publicEndpoint: string;
  // The state directories this runner runs on; the caller's when it passed
  // `dirs`, else the runner's own, removed with it.
  dirs: RunnerDirs;
  // The runner's process id: the root a reader walks the process table
  // from to tell the runner's own children from processes a run left behind.
  pid: number;
  stop(): Promise<void>;
  // Ends the runner by `signal` and resolves once it has exited: SIGKILL is
  // a crash (nothing drains, nothing is written), SIGTERM a drain (the
  // runner's own graceful shutdown, then SIGKILL after the grace). The
  // output tee is closed and the runner's own directories are removed, as
  // stop() does; caller-owned `dirs` are kept for a replacement.
  kill(signal: "SIGKILL" | "SIGTERM"): Promise<void>;
}

// The process a runner is started as: its entry on its Node (RunnerOptions.nodePath).
export function runnerCommand(opts: Pick<RunnerOptions, "entryPath" | "nodePath">): { command: string; args: string[] } {
  return { command: opts.nodePath ?? process.execPath, args: [opts.entryPath] };
}

export async function spawnRunner(opts: RunnerOptions): Promise<RunningRunner> {
  if ((opts.temporalHostPort === undefined) === (opts.cloudBootstrap === undefined)) {
    throw new Error(
      "spawnRunner needs exactly one of temporalHostPort (local engine) or " +
        "cloudBootstrap (embedded-runner discovery); got " +
        (opts.temporalHostPort === undefined ? "neither" : "both"),
    );
  }
  if (opts.artifactStore === "none") {
    if (opts.proxy === undefined) {
      throw new Error("spawnRunner: artifactStore \"none\" needs a proxy (it is the agent-execution artifact posture)");
    }
    if (opts.artifactDir !== undefined || opts.artifactProxy !== undefined) {
      throw new Error("spawnRunner: artifactStore \"none\" excludes artifactDir and artifactProxy");
    }
  }
  // The runner's home for this run: its `~/.stigmer` (session checkpoints,
  // platform dirs, workspace locks) lands here and, unless the caller owns
  // it (`dirs`), is removed with it.
  const ownsDirs = opts.dirs === undefined;
  const { homeDir, workspaceDir } = opts.dirs ?? (await makeRunnerDirs());
  // Share the server's artifact store when given (#285); otherwise mint a
  // throwaway one. Only a dir we minted here is ours to remove on stop — the
  // server owns and cleans its own.
  const ownedArtifactDir =
    opts.artifactDir === undefined
      ? await mkdtemp(join(tmpdir(), "stigmer-conformance-artifacts-"))
      : undefined;
  const artifactDir = opts.artifactDir ?? ownedArtifactDir!;

  const { command, args } = runnerCommand(opts);
  const child = spawn(command, args, {
    cwd: runnerDir(),
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...opts.env,
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
      // The public address the runner fills a declared STIGMER_SERVER_ADDRESS
      // from, set the way `stigmer up` sets it
      // (client-apps/cli/src/local/daemon/components.ts): the server on this
      // machine is its own public address. A fill is therefore observable.
      STIGMER_MCP_PUBLIC_ENDPOINT: opts.backendEndpoint,
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
      // The artifact store, in both LLM modes (runnerArtifactEnv).
      ...runnerArtifactEnv(opts, artifactDir),
      // Hermetic LLM wiring, only when the caller asks for the mock. Absent in
      // direct mode, where the runner reaches real providers. When present,
      // STIGMER_PROXY_ENDPOINT/STIGMER_TOKEN route LLM calls to the mock proxy.
      // STIGMER_CHECKPOINTER_TYPE is deliberately NOT set: MODE=local makes the
      // runner pick its production default, the durable SQLite saver under the
      // harness-owned HOME above (header).
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
          }
        : {}),
      ...(opts.telemetry !== undefined
        ? {
            OTEL_EXPORTER_OTLP_ENDPOINT: opts.telemetry.endpoint,
            OTEL_EXPORTER_OTLP_PROTOCOL: "http/json",
            OTEL_EXPORTER_OTLP_HEADERS: `authorization=${encodeURIComponent(opts.telemetry.login)}`,
            OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: "true",
            OTEL_BSP_SCHEDULE_DELAY: "200",
          }
        : {}),
    },
  });

  // STIGMER_CONFORMANCE_LOG_DIR: the same teardown-surviving tee the
  // server harness offers, for diagnosing writer-ordering races that need
  // the runner's cancellation/persist lines (see server-process.ts). With
  // neither lever set the tee lands under the run's own HOME, so the timing
  // lines are always readable and nothing outlives the run.
  const teeFile =
    opts.logFile ??
    (process.env.STIGMER_CONFORMANCE_LOG_DIR
      ? join(
          process.env.STIGMER_CONFORMANCE_LOG_DIR,
          `runner-${Date.now()}.log`,
        )
      : join(homeDir, "runner.log"));
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

  // The order is the discipline child-process.ts documents: exit first,
  // then the tee (its sink ends only once stdio has closed — the runner's
  // shutdown lines land in the file instead of throwing write-after-end),
  // then the directories the runner was still using.
  const end = async (signal: "SIGKILL" | "SIGTERM"): Promise<void> => {
    const outcome = await stopChild(child, {
      signal,
      graceMs: SHUTDOWN_GRACE_MS,
      onForceKill: () => console.error(describeRunnerForceKill(output.tail())),
    });
    // A forced kill already spoke, above; this line is for the drain that
    // stayed inside the grace but should not have taken that long.
    if (signal === "SIGTERM" && !outcome.forced && outcome.exitedAfterMs > PROMPT_EXIT_MS) {
      console.error(describeRunnerSlowExit(outcome.exitedAfterMs));
    }
    await output.close();
    if (ownsDirs) {
      await rm(workspaceDir, { recursive: true, force: true });
      await rm(homeDir, { recursive: true, force: true });
    }
    // Only remove a store we minted; a server-shared dir is the server's to clean.
    if (ownedArtifactDir !== undefined) {
      await rm(ownedArtifactDir, { recursive: true, force: true });
    }
  };
  // SIGTERM triggers the runner's graceful shutdown (drains the worker).
  const stop = (): Promise<void> => end("SIGTERM");

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
    logFile: teeFile,
    homeDir,
    publicEndpoint: opts.backendEndpoint,
    dirs: { homeDir, workspaceDir },
    // A spawn that failed throws before here (waitForReady), so the child has a pid.
    pid: child.pid!,
    stop,
    kill: end,
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

// The line stop() prints when the runner exited on its own but slowly: past
// PROMPT_EXIT_MS, inside SHUTDOWN_GRACE_MS. The force-kill line above cannot
// cover this case — it speaks only when the grace expires — and a leak whose
// timer happens to fire a second before the grace is the same bug as one
// that fires a second after (stigmer#1008 was both, depending on the file).
// Pure, like describeRunnerForceKill, so the unit arms drive it directly.
export function describeRunnerSlowExit(exitedAfterMs: number): string {
  return (
    `[runner] exited ${exitedAfterMs}ms after SIGTERM (expected within ${PROMPT_EXIT_MS}ms) — ` +
    `something kept the event loop alive after the worker drained: a timer, a socket or a child ` +
    `that outlived the execution (the stigmer#1008 shape). Not a failure; a leak to find.`
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
