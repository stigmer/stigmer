/**
 * Dynamic per-session runner manager.
 *
 * Unlike {@link createStigmerRunner} which creates a single Worker polling
 * one task queue, the RunnerManager maintains a pool of Workers — one per
 * session — all sharing a single Temporal connection and a shared set of
 * activities.
 *
 * Used by the desktop app and any multi-session host that needs to
 * dynamically add/remove sessions without restarting the process.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { createRequire } from "node:module";
import {
  NativeConnection,
  Worker,
  bundleWorkflowCode,
  type ActivityInterceptorsFactory,
  type InjectedSinks,
  type WorkflowBundleOption,
} from "@temporalio/worker";
import type { PayloadCodec } from "@temporalio/common";
import type { Config } from "./config.js";
import { DEFAULT_CURSOR_AGENT_RESOLVE_TIMEOUT_MS, DEFAULT_CURSOR_STREAM_STALL_TIMEOUT_MS, DEFAULT_WORKSPACE_LOCK_TIMEOUT_MS } from "./config.js";
import type { WorkerActivities } from "./worker.js";
import { resolveWorkflowSource, OTEL_WORKFLOW_INTERCEPTOR_MODULE } from "./workflow-source.js";
import { resolveRunnerBootstrap, refreshRunnerAccessToken } from "./bootstrap.js";
import { createRunnerTokenCoordinator } from "./runner-token-coordinator.js";
// Per-task-queue in-flight activity tracking lives in ./in-flight.ts so the
// activity interceptor (no manager-closure handle) and unit tests can reach it.
// This is what keeps a session worker alive while ExecuteCursor is running, so a
// view close can no longer reap the worker mid-run.
import {
  activityStartedOnQueue,
  activityFinishedOnQueue,
  inFlightCountForQueue,
  setQueueDrainCallback,
  forgetQueue,
} from "./in-flight.js";

const SESSION_QUEUE_PREFIX = "session:";
const WFEXEC_QUEUE_PREFIX = "wfexec:";

/**
 * Module-level registry of shutdown signals per task queue.
 * Activities running in the same process can read this to determine
 * whether their worker is being shut down (vs orchestrator pause).
 */
const _shutdownSignalRegistry = new Map<string, AbortSignal>();

export function getShutdownSignalForQueue(taskQueue: string): AbortSignal | undefined {
  return _shutdownSignalRegistry.get(taskQueue);
}

export interface RunnerManagerOptions {
  /**
   * Temporal server address (e.g. "localhost:7233"). Optional: when omitted, the
   * runner self-discovers it during boot from the control plane using
   * {@link stigmerToken} (see bootstrap.ts). Provide it explicitly to bypass
   * discovery — an explicit value always wins.
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

  /** Maximum concurrent activity executions per session Worker. @default 5 */
  readonly maxConcurrentActivitiesPerSession?: number;

  /** Stigmer proxy endpoint for cloud mode. */
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

  /** Enable Cursor cloud mode. @default false */
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
   * artifacts through the proxy. Defaults to "local".
   *
   * @default "local"
   */
  readonly executionMode?: "local" | "cloud";
}

export interface StigmerRunnerManager {
  /** Add a session — creates a Worker polling session:{sessionId}. Idempotent. */
  addSession(sessionId: string): Promise<void>;

  /** Remove a session — gracefully shuts down that session's Worker. */
  removeSession(sessionId: string): Promise<void>;

  /** List currently active session IDs. */
  activeSessions(): string[];

  /** Add a workflow execution — creates a Worker polling wfexec:{executionId}. Idempotent. */
  addWorkflowExecution(executionId: string): Promise<void>;

  /** Remove a workflow execution — gracefully shuts down that execution's Worker. */
  removeWorkflowExecution(executionId: string): Promise<void>;

  /** List currently active workflow execution IDs. */
  activeWorkflowExecutions(): string[];

  /**
   * Push a refreshed *control-plane* auth token (the host's durable credential,
   * e.g. the desktop's Auth0 token) to all activity clients.
   *
   * This updates the control-plane credential only. The proxy credential
   * (x-stigmer-auth) follows it in lockstep UNLESS the runner minted its own
   * proxy token during bootstrap, in which case the runner owns and refreshes
   * that token itself and this push must not clobber it. See the two-writer note
   * on the implementation.
   */
  updateToken(token: string | null): void;

  /** Graceful shutdown of all Workers and the Temporal connection. */
  shutdown(): Promise<void>;
}

interface ManagedSession {
  worker: Worker;
  runPromise: Promise<void>;
  shutdownController: AbortController;
  /**
   * Set when a remove was requested while an activity was still in flight, so
   * the worker is kept alive in the background and torn down only once the last
   * activity finishes. Cleared if the session is re-opened before it drains.
   */
  pendingClose: boolean;
}

/**
 * Create a runner manager that dynamically manages per-session Workers.
 *
 * One shared NativeConnection to Temporal, one shared set of activities.
 * Each call to `addSession(id)` creates a new Worker polling `session:{id}`.
 *
 * @example
 * ```ts
 * import { createStigmerRunnerManager } from '@stigmer/runner';
 *
 * const manager = await createStigmerRunnerManager({
 *   temporalAddress: 'localhost:7233',
 *   stigmerEndpoint: 'http://localhost:7234',
 * });
 *
 * await manager.addSession('ses_abc123');
 * await manager.addSession('ses_def456');
 *
 * // Later:
 * await manager.removeSession('ses_abc123');
 * await manager.shutdown();
 * ```
 */
export async function createStigmerRunnerManager(
  options: RunnerManagerOptions,
): Promise<StigmerRunnerManager> {
  validateManagerOptions(options);

  const { registerStigmerDeepagentsProfiles } = await import(
    "./activities/execute-deep-agent/deepagents-profiles.js"
  );
  registerStigmerDeepagentsProfiles();

  // `tokenRef` holds the control-plane token (the host's durable credential,
  // e.g. the desktop's Auth0 token) and is shared with activity clients via
  // config.stigmerTokenRef. The proxy credential (x-stigmer-auth) is managed
  // separately by a RunnerTokenCoordinator (created after the interceptors are
  // installed) — see that module for the two-writer rationale and the staleness
  // history it guards.
  const tokenRef = { current: options.stigmerToken ?? null };
  // `runnerTokenRef` mirrors the coordinator's proxy credential for gRPC use:
  // the minted runner token (token_type=embedded_runner) once adopted, tracking
  // the control-plane token in lockstep before that. StigmerClient authenticates
  // ExecutionContext reads with it so cloud's runner-class decrypt gate
  // (stigmer-cloud#152) recognizes the desktop runner — its control-plane token
  // is the user's own Auth0 token, which the server treats as a browsing user
  // and answers with redacted secrets. Pre-mint the ref equals the control-plane
  // token, which is exactly what the client would fall back to anyway.
  const runnerTokenRef = { current: options.stigmerToken ?? null };
  const baseConfig = mapManagerOptionsToConfig(options, tokenRef, runnerTokenRef);

  // Install the Cursor SDK interceptors BEFORE resolving Temporal coordinates.
  // Coordinate discovery dials the control plane via StigmerClient, which loads
  // @connectrpc/connect-node and snapshots the node:http2 ESM facade on first
  // import. The HTTP/2 interceptor patches http2.connect and only propagates to
  // that facade if it runs first, so install MUST precede any connect-node load
  // (discovery here, and the SDK later). The interceptors depend only on
  // proxyEndpoint/stigmerToken (already in baseConfig), not resolved coordinates.

  // Install fetch interceptor before any @cursor/sdk imports
  const { installFetchInterceptor, updateInterceptorToken, getExecutionContext } = await import(
    "./activities/execute-cursor/fetch-interceptor.js"
  );
  installFetchInterceptor({
    proxyEndpoint: baseConfig.proxyEndpoint ?? undefined,
    stigmerToken: baseConfig.stigmerToken ?? undefined,
  });

  // HTTP/2 interceptor for Connect RPC auth + execution ID injection (BiDi billing)
  const { installHttp2Interceptor, updateHttp2InterceptorToken, assertHttp2ConnectPatched } = await import(
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

  // The token coordinator owns the proxy credential (x-stigmer-auth) and its
  // refresh lifecycle. It writes ONLY its sinks (the interceptors plus the gRPC
  // runner-credential ref) and re-mints using the always-fresh control-plane
  // token in `tokenRef` — never the (possibly expired) minted token itself, so
  // a slept-past-TTL runner recovers without a restart.
  const tokenCoordinator = createRunnerTokenCoordinator({
    applyProxyToken: (token) => {
      updateInterceptorToken(token);
      updateHttp2InterceptorToken(token);
      // Third sink: keeps the ExecutionContext-read credential in lockstep with
      // the proxy credential across mint and refresh (see runnerTokenRef above).
      runnerTokenRef.current = token;
    },
    reMint: () =>
      refreshRunnerAccessToken({
        token: tokenRef.current,
        stigmerEndpoint: baseConfig.stigmerBackendEndpoint,
      }),
  });

  // Resolve the runner bootstrap after the http2 patch is in place (discovery
  // dials the control plane through connect-node). An explicit address wins;
  // otherwise a token triggers control-plane discovery; otherwise localhost.
  // Must happen before createAllActivities so runtime activities that dial
  // Temporal (e.g. emit-event) see the resolved address too.
  const bootstrap = await resolveRunnerBootstrap({
    explicitAddress: options.temporalAddress,
    explicitNamespace: options.temporalNamespace,
    token: options.stigmerToken,
    stigmerEndpoint: baseConfig.stigmerBackendEndpoint,
  });
  const config: Config = {
    ...baseConfig,
    temporalAddress: bootstrap.temporalAddress,
    temporalNamespace: bootstrap.temporalNamespace,
  };

  // Adopt the minted proxy token (cloud): it diverges from the control-plane
  // token from here on, and the coordinator refreshes it before expiry.
  if (bootstrap.runnerAccessToken) {
    tokenCoordinator.adoptMintedToken(
      bootstrap.runnerAccessToken,
      bootstrap.runnerAccessTokenExpiresInSeconds,
    );
    console.log("[runner-manager] Adopted minted proxy token from bootstrap");
  } else if (baseConfig.proxyEndpoint && tokenRef.current) {
    // Proxy is configured but no token was minted (OSS, signing key unset, or an
    // explicit Temporal address pinned so bootstrap discovery was skipped). The
    // runner keeps using the control-plane token for proxy traffic; warn so a
    // resulting 401 is diagnosable rather than silent.
    console.warn(
      "[runner-manager] Proxy endpoint configured but no runner token was minted; " +
        "falling back to the control-plane token for x-stigmer-auth",
    );
  }

  const { setExecutionContextRef } = await import(
    "./activities/execute-cursor/rejection-capture.js"
  );
  setExecutionContextRef(getExecutionContext());

  const activities = await createAllActivities(config);
  const payloadCodec = await createPayloadCodec(config);

  const connection = await NativeConnection.connect({
    address: config.temporalAddress,
  });

  const interceptorConfig = await buildInterceptorConfig();

  // Prefer the build-time workflow bundle (slim/packaged artifacts ship it and
  // cannot bundle at runtime); fall back to bundle-on-boot for dev and tests.
  const workflowSource = resolveWorkflowSource();
  let workflowBundle: WorkflowBundleOption;
  if (workflowSource.kind === "prebuilt") {
    console.log(`[runner-manager] Using pre-built workflow bundle: ${workflowSource.codePath}`);
    workflowBundle = { codePath: workflowSource.codePath };
  } else {
    console.log("[runner-manager] Pre-bundling workflow code...");
    workflowBundle = await bundleWorkflowCode({
      workflowsPath: workflowSource.workflowsPath,
      workflowInterceptorModules: interceptorConfig.workflowInterceptorModules,
    });
    console.log("[runner-manager] Workflow code bundled successfully");
  }

  const sessions = new Map<string, ManagedSession>();
  const workflowExecutions = new Map<string, ManagedSession>();
  const shutdownSignals = new Map<string, AbortController>();
  let shuttingDown = false;

  async function createWorkerOnQueue(taskQueue: string): Promise<ManagedSession> {
    const shutdownController = new AbortController();
    shutdownSignals.set(taskQueue, shutdownController);
    _shutdownSignalRegistry.set(taskQueue, shutdownController.signal);

    const worker = await Worker.create({
      connection,
      namespace: config.temporalNamespace,
      taskQueue,
      activities,
      workflowBundle,
      maxConcurrentActivityTaskExecutions: config.maxConcurrentActivities,
      dataConverter: payloadCodec
        ? { payloadCodecs: [payloadCodec] }
        : undefined,
      sinks: interceptorConfig.sinks,
      interceptors: interceptorConfig.interceptors,
    });

    const runPromise = worker.run().catch((err) => {
      console.error(
        `[runner-manager] Worker for queue ${taskQueue} exited with error:`,
        err,
      );
    });

    return { worker, runPromise, shutdownController, pendingClose: false };
  }

  /**
   * Re-opening a session/execution whose teardown was deferred: cancel the
   * pending close so the worker keeps serving the reused queue. Returns true
   * when an existing managed worker was found (caller should not recreate one).
   */
  function reuseExistingWorker(
    registry: Map<string, ManagedSession>,
    id: string,
    taskQueue: string,
    kind: string,
  ): boolean {
    const existing = registry.get(id);
    if (!existing) return false;
    if (existing.pendingClose) {
      existing.pendingClose = false;
      setQueueDrainCallback(taskQueue, undefined);
      console.log(`[runner-manager] Re-opened ${kind} ${id}; cancelled deferred teardown`);
    }
    return true;
  }

  /**
   * Graceful teardown of a managed worker. Never aborts: callers only reach the
   * actual teardown once no activity is in flight, so a plain worker.shutdown()
   * drains the (idle) queue cleanly. The abort-before-shutdown that used to live
   * here is what killed running activities on a view close.
   */
  async function teardownManaged(
    registry: Map<string, ManagedSession>,
    id: string,
    taskQueue: string,
    kind: string,
  ): Promise<void> {
    const managed = registry.get(id);
    if (!managed) return;
    managed.worker.shutdown();
    await managed.runPromise;
    registry.delete(id);
    shutdownSignals.delete(taskQueue);
    _shutdownSignalRegistry.delete(taskQueue);
    forgetQueue(taskQueue);
    console.log(`[runner-manager] Removed ${kind} ${id} (active=${registry.size})`);
  }

  /**
   * Remove a managed worker, deferring teardown while activities are in flight.
   * This is the server-side safety invariant that lets a run continue in the
   * background after its session view closes: the worker is reaped only when the
   * last activity finishes (or immediately if the queue is already idle).
   */
  async function removeManaged(
    registry: Map<string, ManagedSession>,
    id: string,
    taskQueue: string,
    kind: string,
  ): Promise<void> {
    const managed = registry.get(id);
    if (!managed) return;

    if (inFlightCountForQueue(taskQueue) > 0) {
      managed.pendingClose = true;
      setQueueDrainCallback(taskQueue, () => {
        // Skip if a full shutdown() is already reaping every worker, so we
        // never call worker.shutdown() twice on the same worker.
        if (shuttingDown) return;
        void teardownManaged(registry, id, taskQueue, kind);
      });
      console.log(
        `[runner-manager] Deferring teardown of ${kind} ${id} — ` +
        `${inFlightCountForQueue(taskQueue)} activity(ies) still in flight (runs in background)`,
      );
      return;
    }

    await teardownManaged(registry, id, taskQueue, kind);
  }

  return {
    async addSession(sessionId: string): Promise<void> {
      if (shuttingDown) {
        throw new Error("RunnerManager is shutting down");
      }
      const taskQueue = SESSION_QUEUE_PREFIX + sessionId;
      if (reuseExistingWorker(sessions, sessionId, taskQueue, "session")) {
        return;
      }

      const managed = await createWorkerOnQueue(taskQueue);
      sessions.set(sessionId, managed);
      console.log(
        `[runner-manager] Added session ${sessionId} (queue=${taskQueue}, active=${sessions.size})`,
      );
    },

    async removeSession(sessionId: string): Promise<void> {
      await removeManaged(
        sessions, sessionId, SESSION_QUEUE_PREFIX + sessionId, "session",
      );
    },

    activeSessions(): string[] {
      return Array.from(sessions.keys());
    },

    async addWorkflowExecution(executionId: string): Promise<void> {
      if (shuttingDown) {
        throw new Error("RunnerManager is shutting down");
      }
      const taskQueue = WFEXEC_QUEUE_PREFIX + executionId;
      if (reuseExistingWorker(workflowExecutions, executionId, taskQueue, "workflow execution")) {
        return;
      }

      const managed = await createWorkerOnQueue(taskQueue);
      workflowExecutions.set(executionId, managed);
      console.log(
        `[runner-manager] Added workflow execution ${executionId} (queue=${taskQueue}, active=${workflowExecutions.size})`,
      );
    },

    async removeWorkflowExecution(executionId: string): Promise<void> {
      await removeManaged(
        workflowExecutions, executionId, WFEXEC_QUEUE_PREFIX + executionId,
        "workflow execution",
      );
    },

    activeWorkflowExecutions(): string[] {
      return Array.from(workflowExecutions.keys());
    },

    updateToken(token: string | null): void {
      // Writes the control-plane credential. The coordinator decides whether the
      // proxy credential follows it: only when no token has been minted (so the
      // pre-mint lockstep is preserved), never once the runner owns a minted
      // token. See runner-token-coordinator.ts and the staleness changelogs.
      tokenRef.current = token;
      if (token) {
        process.env.STIGMER_TOKEN = token;
      } else {
        delete process.env.STIGMER_TOKEN;
      }
      tokenCoordinator.onControlPlaneTokenChanged(token);
      console.log("[runner-manager] Auth token updated");
    },

    async shutdown(): Promise<void> {
      shuttingDown = true;
      tokenCoordinator.stop();
      const totalWorkers = sessions.size + workflowExecutions.size;
      console.log(
        `[runner-manager] Shutting down ${totalWorkers} workers (${sessions.size} sessions, ${workflowExecutions.size} workflow executions)...`,
      );

      const shutdownPromises = [
        ...Array.from(sessions.entries()).map(
          async ([id, session]) => {
            session.worker.shutdown();
            await session.runPromise;
            console.log(`[runner-manager] Session worker ${id} stopped`);
          },
        ),
        ...Array.from(workflowExecutions.entries()).map(
          async ([id, execution]) => {
            execution.worker.shutdown();
            await execution.runPromise;
            console.log(`[runner-manager] Workflow execution worker ${id} stopped`);
          },
        ),
      ];

      await Promise.all(shutdownPromises);
      sessions.clear();
      workflowExecutions.clear();
      connection.close();
      console.log("[runner-manager] All workers stopped, connection closed");
    },
  };
}

function validateManagerOptions(options: RunnerManagerOptions): void {
  if (!options.stigmerEndpoint) {
    throw new Error(
      "RunnerManagerOptions.stigmerEndpoint is required — specify the Stigmer server endpoint",
    );
  }
  // temporalAddress is intentionally NOT required: when omitted, the runner
  // discovers it from the control plane (token-only embedding). If neither an
  // explicit address nor a token is present, discovery falls back to localhost.
}

export function mapManagerOptionsToConfig(
  options: RunnerManagerOptions,
  tokenRef?: { current: string | null },
  runnerTokenRef?: { current: string | null },
): Config {
  const proxyActive = !!options.proxyEndpoint;

  // Execution location is independent of proxy transport. Do NOT derive `mode`
  // from `proxyActive`: the desktop runner executes LOCALLY (local-path
  // workspaces must work) while still routing Cursor traffic through the proxy.
  // Coupling the two here is exactly what previously broke local-path sessions.
  const mode = options.executionMode ?? ("local" as const);

  return {
    taskQueue: "manager", // not used for Workers — each Worker gets its own
    // May be empty here; createStigmerRunnerManager resolves it via
    // resolveTemporalCoordinates before any Temporal connection is opened.
    temporalAddress: options.temporalAddress ?? "",
    temporalNamespace: options.temporalNamespace ?? "default",
    stigmerBackendEndpoint: normalizeEndpoint(options.stigmerEndpoint),
    stigmerToken: options.stigmerToken ?? null,
    // Env-only like the env-loaded path (loadConfig): the bridge endpoint
    // is deployment topology, not per-session state.
    mcpBridgeEndpoint: process.env.STIGMER_MCP_BRIDGE_ENDPOINT ?? null,
    stigmerTokenRef: tokenRef,
    stigmerRunnerTokenRef: runnerTokenRef,
    cursorApiKey: proxyActive
      ? (options.cursorApiKey ?? "proxy-managed")
      : (options.cursorApiKey ?? ""),
    workspaceRootDir: options.workspaceRootDir ?? resolveDefaultWorkspaceDir(),
    mode,
    proxyEndpoint: options.proxyEndpoint ?? null,
    maxConcurrentActivities: options.maxConcurrentActivitiesPerSession ?? 5,
    idleTimeoutSeconds: null,
    cloudModeEnabled: options.cloudModeEnabled ?? false,
    checkpointerType:
      options.checkpointerType ?? (proxyActive ? "http" : "sqlite"),
    checkpointerProxyEndpoint:
      options.checkpointerProxyEndpoint ?? options.proxyEndpoint ?? null,
    primaryModel: options.primaryModel ?? "gpt-4.1",
    cursorStreamStallTimeoutMs:
      options.cursorStreamStallTimeoutMs ?? DEFAULT_CURSOR_STREAM_STALL_TIMEOUT_MS,
    agentResolveTimeoutMs:
      options.agentResolveTimeoutMs ?? DEFAULT_CURSOR_AGENT_RESOLVE_TIMEOUT_MS,
    workspaceLockTimeoutMs:
      options.workspaceLockTimeoutMs ?? DEFAULT_WORKSPACE_LOCK_TIMEOUT_MS,
  };
}

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
  };
}

async function createPayloadCodec(
  config: Config,
): Promise<PayloadCodec | undefined> {
  const { loadClaimcheckConfig, ClaimcheckPayloadCodec } = await import(
    "./claimcheck/index.js"
  );
  const claimcheckConfig = loadClaimcheckConfig();
  if (!claimcheckConfig.enabled) {
    return undefined;
  }

  const { loadArtifactStorageConfig, createArtifactStorage } = await import(
    "./shared/artifact-storage.js"
  );
  const storageConfig = loadArtifactStorageConfig(config);
  const storage = createArtifactStorage(storageConfig);
  return new ClaimcheckPayloadCodec(storage, claimcheckConfig);
}

interface InterceptorConfig {
  sinks: InjectedSinks<any>;
  interceptors: Record<string, any>;
  /**
   * Workflow-side interceptor modules. These must be compiled INTO the
   * workflow bundle (Worker.create ignores `interceptors.workflowModules`
   * when a pre-built `workflowBundle` is supplied), so the runtime-bundling
   * path passes them to `bundleWorkflowCode` and the pre-built path relies
   * on the build script having baked them in.
   */
  workflowInterceptorModules: string[];
}

async function buildInterceptorConfig(): Promise<InterceptorConfig> {
  const { createWorkflowMetricsSinks } = await import(
    "./interceptors/workflow-metrics-sink.js"
  );

  const activityInterceptors: ActivityInterceptorsFactory[] = [];
  let sinks: InjectedSinks<any> = { ...createWorkflowMetricsSinks() };
  const workflowInterceptorModules: string[] = [];

  // In-flight activity counter: keeps a session/wfexec worker alive while one of
  // its activities (notably the long ExecuteCursor) is running, so a view close
  // can no longer reap the worker mid-run. Always installed; cheap and global.
  activityInterceptors.push((ctx) => ({
    inbound: {
      async execute(input, next) {
        const taskQueue = ctx.info.taskQueue;
        activityStartedOnQueue(taskQueue);
        try {
          return await next(input);
        } finally {
          activityFinishedOnQueue(taskQueue);
        }
      },
    },
  }));

  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const { OpenTelemetryActivityInboundInterceptor, makeWorkflowExporter } =
      await import("@temporalio/interceptors-opentelemetry");
    const { OTLPTraceExporter } = await import(
      "@opentelemetry/exporter-trace-otlp-grpc"
    );
    const { resourceFromAttributes } = await import(
      "@opentelemetry/resources"
    );

    activityInterceptors.push((ctx) => ({
      inbound: new OpenTelemetryActivityInboundInterceptor(ctx),
    }));

    const resource = resourceFromAttributes({
      "service.name": "stigmer-runner-manager",
    });
    const exporter = new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
    });
    const otelSinks = makeWorkflowExporter(
      exporter as any,
      resource as any,
    ) as unknown as InjectedSinks<any>;
    sinks = { ...sinks, ...otelSinks };

    const esmRequire = createRequire(import.meta.url);
    workflowInterceptorModules.push(
      esmRequire.resolve(OTEL_WORKFLOW_INTERCEPTOR_MODULE),
    );
  }

  return {
    sinks,
    interceptors: {
      ...(activityInterceptors.length > 0
        ? { activity: activityInterceptors }
        : {}),
    },
    workflowInterceptorModules,
  };
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
