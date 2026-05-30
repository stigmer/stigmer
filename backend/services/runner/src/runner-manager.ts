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
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  NativeConnection,
  Worker,
  bundleWorkflowCode,
  type ActivityInterceptorsFactory,
  type InjectedSinks,
} from "@temporalio/worker";
import type { PayloadCodec } from "@temporalio/common";
import type { Config } from "./config.js";
import type { WorkerActivities } from "./worker.js";

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
  /** Temporal server address (e.g. "localhost:7233"). */
  readonly temporalAddress: string;

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

  /** Checkpointer type for LangGraph agent state. @default "memory" (or "http" if proxyEndpoint is set) */
  readonly checkpointerType?: "memory" | "http";

  /** Checkpointer proxy endpoint. Falls back to proxyEndpoint. */
  readonly checkpointerProxyEndpoint?: string;

  /** Enable Cursor cloud mode. @default false */
  readonly cloudModeEnabled?: boolean;
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

  /** Push a refreshed auth token to all activity clients. */
  updateToken(token: string | null): void;

  /** Graceful shutdown of all Workers and the Temporal connection. */
  shutdown(): Promise<void>;
}

interface ManagedSession {
  worker: Worker;
  runPromise: Promise<void>;
  shutdownController: AbortController;
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

  const tokenRef = { current: options.stigmerToken ?? null };
  const config = mapManagerOptionsToConfig(options, tokenRef);

  // Install fetch interceptor before any @cursor/sdk imports
  const { installFetchInterceptor, updateInterceptorToken, getExecutionContext } = await import(
    "./activities/execute-cursor/fetch-interceptor.js"
  );
  installFetchInterceptor({
    proxyEndpoint: config.proxyEndpoint ?? undefined,
    stigmerToken: config.stigmerToken ?? undefined,
  });
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
  const workflowsPath = fileURLToPath(
    new URL("./workflows/index.js", import.meta.url),
  );

  console.log("[runner-manager] Pre-bundling workflow code...");
  const workflowBundle = await bundleWorkflowCode({ workflowsPath });
  console.log("[runner-manager] Workflow code bundled successfully");

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

    return { worker, runPromise, shutdownController };
  }

  return {
    async addSession(sessionId: string): Promise<void> {
      if (shuttingDown) {
        throw new Error("RunnerManager is shutting down");
      }
      if (sessions.has(sessionId)) {
        return;
      }

      const taskQueue = SESSION_QUEUE_PREFIX + sessionId;
      const managed = await createWorkerOnQueue(taskQueue);
      sessions.set(sessionId, managed);
      console.log(
        `[runner-manager] Added session ${sessionId} (queue=${taskQueue}, active=${sessions.size})`,
      );
    },

    async removeSession(sessionId: string): Promise<void> {
      const session = sessions.get(sessionId);
      if (!session) {
        return;
      }

      const taskQueue = SESSION_QUEUE_PREFIX + sessionId;
      session.shutdownController.abort();
      session.worker.shutdown();
      await session.runPromise;
      sessions.delete(sessionId);
      shutdownSignals.delete(taskQueue);
      _shutdownSignalRegistry.delete(taskQueue);
      console.log(
        `[runner-manager] Removed session ${sessionId} (active=${sessions.size})`,
      );
    },

    activeSessions(): string[] {
      return Array.from(sessions.keys());
    },

    async addWorkflowExecution(executionId: string): Promise<void> {
      if (shuttingDown) {
        throw new Error("RunnerManager is shutting down");
      }
      if (workflowExecutions.has(executionId)) {
        return;
      }

      const taskQueue = WFEXEC_QUEUE_PREFIX + executionId;
      const managed = await createWorkerOnQueue(taskQueue);
      workflowExecutions.set(executionId, managed);
      console.log(
        `[runner-manager] Added workflow execution ${executionId} (queue=${taskQueue}, active=${workflowExecutions.size})`,
      );
    },

    async removeWorkflowExecution(executionId: string): Promise<void> {
      const execution = workflowExecutions.get(executionId);
      if (!execution) {
        return;
      }

      const taskQueue = WFEXEC_QUEUE_PREFIX + executionId;
      execution.shutdownController.abort();
      execution.worker.shutdown();
      await execution.runPromise;
      workflowExecutions.delete(executionId);
      shutdownSignals.delete(taskQueue);
      _shutdownSignalRegistry.delete(taskQueue);
      console.log(
        `[runner-manager] Removed workflow execution ${executionId} (active=${workflowExecutions.size})`,
      );
    },

    activeWorkflowExecutions(): string[] {
      return Array.from(workflowExecutions.keys());
    },

    updateToken(token: string | null): void {
      tokenRef.current = token;
      if (token) {
        process.env.STIGMER_TOKEN = token;
        updateInterceptorToken(token);
      } else {
        delete process.env.STIGMER_TOKEN;
      }
      console.log("[runner-manager] Auth token updated");
    },

    async shutdown(): Promise<void> {
      shuttingDown = true;
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
  if (!options.temporalAddress) {
    throw new Error(
      "RunnerManagerOptions.temporalAddress is required — specify the Temporal server address",
    );
  }
  if (!options.stigmerEndpoint) {
    throw new Error(
      "RunnerManagerOptions.stigmerEndpoint is required — specify the Stigmer server endpoint",
    );
  }
}

function mapManagerOptionsToConfig(
  options: RunnerManagerOptions,
  tokenRef?: { current: string | null },
): Config {
  const proxyActive = !!options.proxyEndpoint;
  const mode = proxyActive ? ("cloud" as const) : ("local" as const);

  return {
    taskQueue: "manager", // not used for Workers — each Worker gets its own
    temporalAddress: options.temporalAddress,
    temporalNamespace: options.temporalNamespace ?? "default",
    stigmerBackendEndpoint: normalizeEndpoint(options.stigmerEndpoint),
    stigmerToken: options.stigmerToken ?? null,
    stigmerTokenRef: tokenRef,
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
      options.checkpointerType ?? (proxyActive ? "http" : "memory"),
    checkpointerProxyEndpoint:
      options.checkpointerProxyEndpoint ?? options.proxyEndpoint ?? null,
    primaryModel: options.primaryModel ?? "gpt-4.1",
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
}

async function buildInterceptorConfig(): Promise<InterceptorConfig> {
  const { createWorkflowMetricsSinks } = await import(
    "./interceptors/workflow-metrics-sink.js"
  );

  const activityInterceptors: ActivityInterceptorsFactory[] = [];
  let sinks: InjectedSinks<any> = { ...createWorkflowMetricsSinks() };
  const workflowInterceptorModules: string[] = [];

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
      esmRequire.resolve(
        "@temporalio/interceptors-opentelemetry/lib/workflow-interceptors",
      ),
    );
  }

  return {
    sinks,
    interceptors: {
      ...(activityInterceptors.length > 0
        ? { activity: activityInterceptors }
        : {}),
      ...(workflowInterceptorModules.length > 0
        ? { workflowModules: workflowInterceptorModules }
        : {}),
    },
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
