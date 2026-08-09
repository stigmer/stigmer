/**
 * Public factory for the unified Stigmer runner.
 *
 * Encapsulates the full boot sequence: fetch interceptor installation,
 * dynamic activity imports, Temporal worker creation. Consumers call
 * {@link createStigmerRunner} with typed options and get back a handle
 * to start/shutdown the worker.
 *
 * OTel tracing and metrics are intentionally excluded — they mutate
 * global state and should be initialized by the consumer before calling
 * this factory. The Temporal OTel activity interceptor is still wired
 * internally when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import type { PayloadCodec } from "@temporalio/common";
import type { Config } from "./config.js";
import { DEFAULT_CURSOR_AGENT_RESOLVE_TIMEOUT_MS, DEFAULT_CURSOR_STREAM_STALL_TIMEOUT_MS, DEFAULT_WORKSPACE_LOCK_TIMEOUT_MS } from "./config.js";
import type { WorkerActivities } from "./worker.js";
import { resolveRunnerBootstrap } from "./bootstrap.js";
import { markBoot, emitRunnerBootTiming } from "./shared/cold-start-timing.js";

/**
 * Configuration for creating a Stigmer runner.
 *
 * Required fields must be provided by the consumer. Optional fields
 * have sensible defaults for local development.
 */
export interface StigmerRunnerOptions {
  /** Temporal task queue to poll for work. */
  readonly taskQueue: string;

  /**
   * Temporal server address (e.g. "localhost:7233"). Optional: when omitted, the
   * runner self-discovers it during boot from the control plane using
   * {@link stigmerToken} (see bootstrap.ts). An explicit value always wins.
   */
  readonly temporalAddress?: string;

  /** Stigmer server endpoint for status updates, artifacts, and blueprints. */
  readonly stigmerEndpoint: string;

  /** Temporal namespace. @default "default" */
  readonly temporalNamespace?: string;

  /** Auth token for authenticating with the Stigmer server. */
  readonly stigmerToken?: string;

  /** Cursor API key for direct mode (not needed in proxy mode). */
  readonly cursorApiKey?: string;

  /** Root directory for agent workspaces. Defaults to ~/.stigmer/workspaces/runner. */
  readonly workspaceRootDir?: string;

  /** Maximum concurrent Temporal activity executions. @default 5 */
  readonly maxConcurrentActivities?: number;

  /**
   * Stigmer proxy endpoint. When set, activates proxy mode: the fetch
   * interceptor rewrites outbound Cursor SDK requests through the proxy,
   * and cloud-specific behaviors (HTTP checkpointer, required auth) activate.
   */
  readonly proxyEndpoint?: string;

  /** Default LLM model identifier. @default "gpt-4.1" */
  readonly primaryModel?: string;

  /** No-progress bound for the Cursor harness stream (ms). @default 180000 */
  readonly cursorStreamStallTimeoutMs?: number;

  /** Bound for Cursor Agent.create/resume (ms). @default 120000 */
  readonly agentResolveTimeoutMs?: number;

  /** Max wait for the per-workspace turn lock (ms). @default 900000 */
  readonly workspaceLockTimeoutMs?: number;

  /** Checkpointer type for LangGraph agent state. @default "sqlite" (or "http" if proxyEndpoint is set) */
  readonly checkpointerType?: "memory" | "http" | "sqlite";

  /** Checkpointer proxy endpoint. Falls back to proxyEndpoint. */
  readonly checkpointerProxyEndpoint?: string;

  /** Enable Cursor cloud mode for workspace-less execution. @default false */
  readonly cloudModeEnabled?: boolean;

  /**
   * Workspace/filesystem execution location — where the agent actually runs.
   *
   * - "local": the agent operates on the host filesystem (local-path workspace
   *   entries are valid; the desktop app and CLI daemon use this).
   * - "cloud": the agent runs in a server-provisioned sandbox (git-only).
   *
   * This is intentionally distinct from {@link proxyEndpoint}, which controls
   * credential/artifact *transport*. The desktop runner is the canonical case
   * where the two diverge: it executes locally while routing Cursor traffic and
   * artifacts through the proxy.
   *
   * When unset, the location is derived from {@link proxyEndpoint} for backward
   * compatibility (proxy ⇒ "cloud", otherwise "local"). Set this explicitly to
   * express local execution with proxy transport — the same decoupling
   * {@link createStigmerRunnerManager} provides via its own `executionMode`.
   */
  readonly executionMode?: "local" | "cloud";
}

/** Handle returned by {@link createStigmerRunner}. */
export interface StigmerRunner {
  /** Start polling for tasks. Blocks until the worker is shut down. */
  start(): Promise<void>;

  /** Signal graceful shutdown — drains in-flight activities then stops. */
  shutdown(): void;
}

/**
 * Wire up self-renewal for a static cloud sandbox's control-plane credential
 * (see sandbox-token-renewal.ts for the model). The applied token reaches
 * every consumer: activity gRPC clients read {@code tokenRef} per request,
 * env-reading call sites (call-llm, registry-endpoint) read
 * {@code process.env.STIGMER_TOKEN} per call, artifact storage resolves the
 * ref per call, and the two Cursor SDK interceptors are updated directly —
 * a static runner has no {@code RunnerTokenCoordinator} minting a separate
 * proxy credential, so its x-stigmer-auth IS this token.
 */
async function startStaticSandboxTokenRenewal(
  config: Config,
  tokenRef: { current: string | null },
): Promise<{ stop(): void } | null> {
  const { isRenewableSandboxToken, startSandboxTokenRenewal } = await import(
    "./sandbox-token-renewal.js"
  );
  // Static mode's credential class never changes (it is baked into the pod's
  // env), so a non-renewable credential — desktop/OSS/local — never starts
  // the loop at all.
  if (!isRenewableSandboxToken(tokenRef.current)) {
    return null;
  }

  const { StigmerClient } = await import("./client/stigmer-client.js");
  const { updateInterceptorToken } = await import(
    "./activities/execute-cursor/fetch-interceptor.js"
  );
  const { updateHttp2InterceptorToken } = await import(
    "./activities/execute-cursor/http2-interceptor.js"
  );
  const client = new StigmerClient({
    endpoint: config.stigmerBackendEndpoint,
    token: null,
    tokenRef,
  });

  return startSandboxTokenRenewal({
    getToken: () => tokenRef.current,
    renew: (currentToken) =>
      client.getRunnerScopedToken({ renewal: true }, currentToken),
    applyToken: (token) => {
      tokenRef.current = token;
      process.env.STIGMER_TOKEN = token;
      updateInterceptorToken(token);
      updateHttp2InterceptorToken(token);
    },
  });
}

/**
 * Create a Stigmer runner ready to poll a Temporal task queue.
 *
 * Handles all internal setup: Cursor SDK fetch interceptor, activity
 * registration, and Temporal worker creation. Returns a handle with
 * `start()` and `shutdown()` methods.
 *
 * @example
 * ```ts
 * import { createStigmerRunner } from '@stigmer/runner';
 *
 * const runner = await createStigmerRunner({
 *   taskQueue: 'session:abc-123',
 *   temporalAddress: 'localhost:7233',
 *   stigmerEndpoint: 'http://localhost:7234',
 * });
 *
 * process.on('SIGTERM', () => runner.shutdown());
 * await runner.start();
 * ```
 */
export async function createStigmerRunner(
  options: StigmerRunnerOptions,
): Promise<StigmerRunner> {
  validateOptions(options);

  const { registerStigmerDeepagentsProfiles } = await import(
    "./activities/execute-deep-agent/deepagents-profiles.js"
  );
  registerStigmerDeepagentsProfiles();

  const baseConfig = mapOptionsToConfig(options);

  // Install the Cursor SDK interceptors BEFORE resolving Temporal coordinates.
  // Coordinate discovery dials the control plane via StigmerClient, which loads
  // @connectrpc/connect-node and snapshots the node:http2 ESM facade on first
  // import. The HTTP/2 interceptor patches http2.connect and only propagates to
  // that facade if it runs first, so install MUST precede any connect-node load
  // (discovery here, and the SDK later). The interceptors depend only on
  // proxyEndpoint/stigmerToken (already in baseConfig), not resolved coordinates.

  // The Cursor SDK captures a reference to global.fetch at import time.
  // The fetch interceptor MUST be installed before any @cursor/sdk import.
  const { installFetchInterceptor, getExecutionContext } = await import(
    "./activities/execute-cursor/fetch-interceptor.js"
  );
  installFetchInterceptor({
    proxyEndpoint: baseConfig.proxyEndpoint ?? undefined,
    stigmerToken: baseConfig.stigmerToken ?? undefined,
  });

  // The Cursor SDK's Connect RPC transport uses native HTTP/2, bypassing
  // globalThis.fetch. This interceptor injects x-stigmer-execution-id and
  // the Stigmer auth token on HTTP/2 streams so the BiDi proxy can
  // authenticate and meter billing.
  const { installHttp2Interceptor, assertHttp2ConnectPatched } = await import(
    "./activities/execute-cursor/http2-interceptor.js"
  );
  installHttp2Interceptor({
    proxyEndpoint: baseConfig.proxyEndpoint ?? undefined,
    stigmerToken: baseConfig.stigmerToken ?? undefined,
  });
  // Fail loudly at boot if a load-order regression left the node:http2 ESM
  // facade unpatched (otherwise BiDi streams would silently 401). No-op when
  // the interceptor is unconfigured (no proxy/token).
  await assertHttp2ConnectPatched();
  markBoot("interceptors_installed");

  // Resolve Temporal coordinates after the http2 patch is in place (discovery
  // dials the control plane through connect-node). Explicit address wins;
  // otherwise a token triggers control-plane discovery; otherwise localhost.
  // Activities that dial Temporal at runtime (e.g. emit-event) read
  // config.temporalAddress, so this must precede their creation.
  //
  // The static runner brings its own already-proxy-valid token (harness/CLI),
  // so it does not consume the minted runner token from the bootstrap response;
  // that proxy-credential lifecycle lives in createStigmerRunnerManager (the
  // long-lived desktop host that needs it). Only the coordinates are used here.
  const coordinates = await resolveRunnerBootstrap({
    explicitAddress: options.temporalAddress,
    explicitNamespace: options.temporalNamespace,
    token: options.stigmerToken,
    stigmerEndpoint: baseConfig.stigmerBackendEndpoint,
  });
  // The control-plane credential lives in a shared mutable ref (as in manager
  // mode) so the sandbox-token renewal below can rotate it in-process:
  // activity clients read the ref per request instead of pinning the boot
  // token for the pod's whole life.
  const tokenRef = { current: baseConfig.stigmerToken };
  const config: Config = {
    ...baseConfig,
    temporalAddress: coordinates.temporalAddress,
    temporalNamespace: coordinates.temporalNamespace,
    stigmerTokenRef: tokenRef,
  };
  markBoot("bootstrap_resolved");

  // Cloud sandbox credential self-renewal (no-op for desktop/OSS/local
  // credentials — see the helper). Started before the worker so the first
  // renewal point is scheduled even if the pod boots with a part-used token.
  const tokenRenewal = await startStaticSandboxTokenRenewal(config, tokenRef);

  const { setExecutionContextRef } = await import(
    "./activities/execute-cursor/rejection-capture.js"
  );
  setExecutionContextRef(getExecutionContext());

  const activities = await createAllActivities(config);
  markBoot("activities_imported");

  console.log(
    `[runner] Registered activities: ${Object.keys(activities).join(", ")}`,
  );
  console.log(
    `[runner] Task queue: ${config.taskQueue} | ` +
      `Mode: ${config.mode} | ` +
      `Max concurrency: ${config.maxConcurrentActivities}`,
  );
  // Surface the resolved artifact store at boot so a path/type misconfiguration
  // (the #285 class of failure) is visible immediately instead of only when an
  // attachment or offload read fails minutes into an execution.
  try {
    const { loadArtifactStorageConfig } = await import(
      "./shared/artifact-storage.js"
    );
    const artifactCfg = loadArtifactStorageConfig(config);
    console.log(
      `[runner] Artifact store: type=${artifactCfg.type}` +
        (artifactCfg.type === "local"
          ? ` | root=${artifactCfg.localPath}`
          : ` | proxy=${artifactCfg.proxyEndpoint ?? "(unset)"}`),
    );
  } catch (err) {
    console.warn(
      `[runner] Artifact store: could not resolve config for boot log: ${err}`,
    );
  }

  const payloadCodec = await createPayloadCodec(config);

  const { startWorker } = await import("./worker.js");
  const worker = await startWorker({ config, activities, payloadCodec });
  markBoot("worker_created");

  return {
    async start() {
      console.log("Worker ready, polling for tasks...");
      // The boot timeline ends here: the worker is about to poll, so the
      // sandbox can now receive its first activity. The final mark closes the
      // worker_created → about-to-poll span — without it, total_ms would stop
      // at worker_created and understate the boot time the warm-pool go/no-go
      // decision reads.
      markBoot("worker_polling");
      emitRunnerBootTiming({ task_queue: config.taskQueue, mode: config.mode });
      await worker.run();
      console.log("Worker stopped");
    },
    shutdown() {
      tokenRenewal?.stop();
      worker.shutdown();
    },
  };
}

function validateOptions(options: StigmerRunnerOptions): void {
  if (!options.taskQueue) {
    throw new Error(
      "StigmerRunnerOptions.taskQueue is required — specify the Temporal task queue to poll",
    );
  }
  if (!options.stigmerEndpoint) {
    throw new Error(
      "StigmerRunnerOptions.stigmerEndpoint is required — specify the Stigmer server endpoint (e.g. 'http://localhost:7234')",
    );
  }
  // temporalAddress is intentionally NOT required: when omitted, the runner
  // discovers it from the control plane (token-only embedding), falling back to
  // localhost when no token is present.
}

export function mapOptionsToConfig(options: StigmerRunnerOptions): Config {
  const proxyActive = !!options.proxyEndpoint;

  // Execution location is independent of proxy transport. An explicit
  // `executionMode` always wins; otherwise fall back to the proxy-derived
  // default for backward compatibility. Setting `executionMode: "local"` with a
  // proxy is the desktop case (local-path workspaces + proxied Cursor traffic).
  const mode = options.executionMode ?? (proxyActive ? "cloud" : "local");

  return {
    taskQueue: options.taskQueue,
    // May be empty here; createStigmerRunner resolves it via
    // resolveRunnerBootstrap before the worker connects to Temporal.
    temporalAddress: options.temporalAddress ?? "",
    temporalNamespace: options.temporalNamespace ?? "default",
    stigmerBackendEndpoint: normalizeEndpoint(options.stigmerEndpoint),
    stigmerToken: options.stigmerToken ?? null,
    // Env-only like the env-loaded path (loadConfig): the bridge endpoint
    // is deployment topology, not per-session state.
    mcpBridgeEndpoint: process.env.STIGMER_MCP_BRIDGE_ENDPOINT ?? null,
    cursorApiKey: proxyActive
      ? (options.cursorApiKey ?? "proxy-managed")
      : (options.cursorApiKey ?? ""),
    workspaceRootDir: options.workspaceRootDir ?? resolveDefaultWorkspaceDir(),
    mode,
    proxyEndpoint: options.proxyEndpoint ?? null,
    maxConcurrentActivities: options.maxConcurrentActivities ?? 5,
    idleTimeoutSeconds: null,
    cloudModeEnabled: options.cloudModeEnabled ?? false,
    checkpointerType: options.checkpointerType
      ?? (proxyActive ? "http" : "sqlite"),
    checkpointerProxyEndpoint: options.checkpointerProxyEndpoint
      ?? options.proxyEndpoint
      ?? null,
    primaryModel: options.primaryModel ?? "gpt-4.1",
    cursorStreamStallTimeoutMs:
      options.cursorStreamStallTimeoutMs ?? DEFAULT_CURSOR_STREAM_STALL_TIMEOUT_MS,
    agentResolveTimeoutMs:
      options.agentResolveTimeoutMs ?? DEFAULT_CURSOR_AGENT_RESOLVE_TIMEOUT_MS,
    workspaceLockTimeoutMs:
      options.workspaceLockTimeoutMs ?? DEFAULT_WORKSPACE_LOCK_TIMEOUT_MS,
  };
}

/**
 * Dynamically import all activity factories and merge into a single map.
 *
 * Dynamic imports are required because several modules transitively import
 * @cursor/sdk, which captures global.fetch at import time. The fetch
 * interceptor must be installed before these imports.
 */
async function createAllActivities(config: Config): Promise<WorkerActivities> {
  const [
    { createCursorActivities },
    { createDeepAgentActivities },
    { createEnsureThreadActivities },
    { createClassifyToolApprovalsActivities },
    { createDiscoverMcpServerActivities },
    { createEvaluateExpressionsActivities },
    { createCallHttpActivities },
    { createCallGrpcActivities },
    { createCallFunctionActivities },
    { createCallLlmActivities },
    { createCallAgentActivities },
    { createCallAgentStatusActivities },
    { createRunCommandActivities },
    { createHydrateWorkflowActivities },
    { createWorkflowEventActivities },
    { createPromoteTaskOutputActivities },
    { createAttachSessionActivities },
  ] = await Promise.all([
    import("./activities/execute-cursor/index.js"),
    import("./activities/execute-deep-agent/index.js"),
    import("./activities/ensure-thread.js"),
    import("./activities/classify-tool-approvals.js"),
    import("./activities/discover-mcp-server.js"),
    import("./activities/evaluate-expressions.js"),
    import("./activities/call-http.js"),
    import("./activities/call-grpc.js"),
    import("./activities/call-function.js"),
    import("./activities/call-llm.js"),
    import("./activities/call-agent.js"),
    import("./activities/call-agent-status.js"),
    import("./activities/run-command.js"),
    import("./activities/hydrate-workflow-execution.js"),
    import("./activities/workflow-event-activities.js"),
    import("./activities/promote-task-output.js"),
    import("./activities/attach-session.js"),
  ]);

  return {
    ...createCursorActivities(config),
    ...createDeepAgentActivities(config),
    ...createEnsureThreadActivities(),
    ...createClassifyToolApprovalsActivities(config),
    ...createDiscoverMcpServerActivities(config),
    ...createEvaluateExpressionsActivities(),
    ...createCallHttpActivities(),
    ...createCallGrpcActivities(),
    ...createCallFunctionActivities(),
    ...createCallLlmActivities(),
    ...createCallAgentActivities(),
    ...createCallAgentStatusActivities(),
    ...createRunCommandActivities(),
    ...createHydrateWorkflowActivities(config),
    ...createWorkflowEventActivities(),
    ...createPromoteTaskOutputActivities(),
    ...createAttachSessionActivities(config),
  };
}

async function createPayloadCodec(config: Config): Promise<PayloadCodec | undefined> {
  const { loadClaimcheckConfig, ClaimcheckPayloadCodec } = await import("./claimcheck/index.js");
  const claimcheckConfig = loadClaimcheckConfig();
  if (!claimcheckConfig.enabled) {
    return undefined;
  }

  const { loadArtifactStorageConfig, createArtifactStorage } = await import(
    "./shared/artifact-storage.js"
  );
  const storageConfig = loadArtifactStorageConfig(config);
  const storage = createArtifactStorage(storageConfig);

  console.log(
    `[runner] Claimcheck enabled (threshold=${claimcheckConfig.thresholdBytes}B, ` +
      `compression=${claimcheckConfig.compressionEnabled}, ` +
      `storage=${storageConfig.type})`,
  );

  return new ClaimcheckPayloadCodec(storage, claimcheckConfig);
}

function resolveDefaultWorkspaceDir(): string {
  try {
    const dir = join(homedir(), ".stigmer", "workspaces", "runner");
    mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    const dir = join(tmpdir(), "stigmer-runner-workspace");
    mkdirSync(dir, { recursive: true });
    return dir;
  }
}

function normalizeEndpoint(endpoint: string): string {
  if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
    return endpoint;
  }
  if (endpoint.endsWith(":443")) {
    return `https://${endpoint}`;
  }
  return `http://${endpoint}`;
}
