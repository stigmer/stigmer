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
import type { WorkerActivities } from "./worker.js";

/**
 * Configuration for creating a Stigmer runner.
 *
 * Required fields must be provided by the consumer. Optional fields
 * have sensible defaults for local development.
 */
export interface StigmerRunnerOptions {
  /** Temporal task queue to poll for work. */
  readonly taskQueue: string;

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

  /** Checkpointer type for LangGraph agent state. @default "memory" (or "http" if proxyEndpoint is set) */
  readonly checkpointerType?: "memory" | "http";

  /** Checkpointer proxy endpoint. Falls back to proxyEndpoint. */
  readonly checkpointerProxyEndpoint?: string;

  /** Enable Cursor cloud mode for workspace-less execution. @default false */
  readonly cloudModeEnabled?: boolean;
}

/** Handle returned by {@link createStigmerRunner}. */
export interface StigmerRunner {
  /** Start polling for tasks. Blocks until the worker is shut down. */
  start(): Promise<void>;

  /** Signal graceful shutdown — drains in-flight activities then stops. */
  shutdown(): void;
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

  const config = mapOptionsToConfig(options);

  // The Cursor SDK captures a reference to global.fetch at import time.
  // The fetch interceptor MUST be installed before any @cursor/sdk import.
  const { installFetchInterceptor } = await import(
    "./activities/execute-cursor/fetch-interceptor.js"
  );
  installFetchInterceptor({
    proxyEndpoint: config.proxyEndpoint ?? undefined,
    stigmerToken: config.stigmerToken ?? undefined,
  });

  const activities = await createAllActivities(config);

  console.log(
    `[runner] Registered activities: ${Object.keys(activities).join(", ")}`,
  );
  console.log(
    `[runner] Task queue: ${config.taskQueue} | ` +
      `Mode: ${config.mode} | ` +
      `Max concurrency: ${config.maxConcurrentActivities}`,
  );

  const payloadCodec = await createPayloadCodec(config);

  const { startWorker } = await import("./worker.js");
  const worker = await startWorker({ config, activities, payloadCodec });

  return {
    async start() {
      console.log("Worker ready, polling for tasks...");
      await worker.run();
      console.log("Worker stopped");
    },
    shutdown() {
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
  if (!options.temporalAddress) {
    throw new Error(
      "StigmerRunnerOptions.temporalAddress is required — specify the Temporal server address (e.g. 'localhost:7233')",
    );
  }
  if (!options.stigmerEndpoint) {
    throw new Error(
      "StigmerRunnerOptions.stigmerEndpoint is required — specify the Stigmer server endpoint (e.g. 'http://localhost:7234')",
    );
  }
}

function mapOptionsToConfig(options: StigmerRunnerOptions): Config {
  const proxyActive = !!options.proxyEndpoint;
  const mode = proxyActive ? "cloud" as const : "local" as const;

  return {
    taskQueue: options.taskQueue,
    temporalAddress: options.temporalAddress,
    temporalNamespace: options.temporalNamespace ?? "default",
    stigmerBackendEndpoint: normalizeEndpoint(options.stigmerEndpoint),
    stigmerToken: options.stigmerToken ?? null,
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
      ?? (proxyActive ? "http" : "memory"),
    checkpointerProxyEndpoint: options.checkpointerProxyEndpoint
      ?? options.proxyEndpoint
      ?? null,
    primaryModel: options.primaryModel ?? "gpt-4.1",
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
