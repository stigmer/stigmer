/**
 * Streaming execution loop for ExecuteDeepAgent.
 *
 * Replaces the Phase 3a invoke() approach with streamEvents() v2
 * consumption. Feeds events to the StatusBuilder, persists status
 * via the scheduler + retry executor, handles terminal conditions
 * (STOP signal, stall, recursion limit, cancellation).
 *
 * Phase 3b-iii: inline artifact publish and incremental git writeback
 * on file-modifying tool completions (write, edit, create).
 */

import { create, toJson } from "@bufbuild/protobuf";
import {
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  ExecutionControlSignal,
  ExecutionPhase,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { StatusBuilder, type StreamEvent, type ApprovalPolicyProvider } from "./status-builder.js";
import {
  handlePause,
  handleStop,
  handleRecursionLimit,
  isGraphRecursionError,
} from "./streaming-terminal.js";
import {
  StreamingUpdateScheduler,
  type StreamingConfig,
} from "../../shared/streaming-scheduler.js";
import { type RetryOptions } from "../../shared/grpc-retry.js";
import { persistStatus, slimStatus, utcTimestamp } from "../../shared/status.js";
import type { ToolOutputOffloadContext } from "../../shared/status-offload.js";
import type { StigmerClient } from "../../client/stigmer-client.js";
import type { GracefulStopMiddleware } from "../../middleware/index.js";
import type { InlinePublisher } from "./inline-publisher.js";
import type { WriteBackCoordinator } from "./writeback-coordinator.js";
import { createV2EventRecorder } from "./event-recorder.js";
import { streamExecutionV3 } from "./streaming-v3.js";
import { extractFilePath, isFileModifyingTool } from "../../shared/file-tools.js";

const DEFAULT_STALL_TIMEOUT_MS = 120_000;

export interface StreamDependencies {
  readonly agentGraph: {
    streamEvents(
      input: Record<string, unknown>,
      config: Record<string, unknown>,
      options: { version: string },
    ): AsyncIterable<StreamEvent>;
  };
  readonly langgraphInput: Record<string, unknown>;
  readonly langgraphConfig: Record<string, unknown>;
  readonly executionId: string;
  readonly client: StigmerClient;
  readonly initialStatus: AgentExecutionStatus;
  readonly streamingConfig?: StreamingConfig;
  readonly retryOptions?: RetryOptions;
  /**
   * Offload context for the persist chokepoint. When set, oversized tool
   * outputs (e.g. computer-use screenshots) are spilled to artifact storage so
   * the UI can render them; when omitted, the aggregate size backstop still
   * keeps the payload under the gRPC cap.
   */
  readonly offload?: ToolOutputOffloadContext;
  readonly stallTimeoutMs?: number;
  /** Temporal heartbeat. Injected so the loop is testable without Temporal. */
  readonly heartbeatFn?: (details: Record<string, unknown>) => void;
  /** Temporal cancellation check. */
  readonly isCancelledFn?: () => boolean;
  /** GracefulStopMiddleware instance for platform STOP signal handling. */
  readonly gracefulStop?: GracefulStopMiddleware;
  /** Inline artifact publisher for file-modifying tool completions. */
  readonly inlinePublisher?: InlinePublisher;
  /** Incremental git write-back coordinator. */
  readonly writebackCoordinator?: WriteBackCoordinator;
  /** Approval policy provider for StatusBuilder tool-call phase tracking. */
  readonly approvalProvider?: ApprovalPolicyProvider;
  /** Streaming protocol version. Defaults to "v2" if unset. */
  readonly streamVersion?: "v2" | "v3";
}

export interface StreamResult {
  readonly eventsProcessed: number;
  readonly terminalStatus?: unknown;
  readonly pendingPublishPromises: readonly Promise<void>[];
  readonly pendingWritebackPromises: readonly Promise<void>[];
  /** v3 only: the final state from run.output (includes structuredResponse if present). */
  readonly runOutput?: Record<string, unknown>;
}

/**
 * Run the streaming loop: consume streamEvents, map to proto via
 * StatusBuilder, persist on schedule, and handle terminal conditions.
 *
 * Routes to v3 when deps.streamVersion === "v3".
 */
export async function streamExecution(
  deps: StreamDependencies,
): Promise<StreamResult> {
  if (deps.streamVersion === "v3") {
    return streamExecutionV3(deps);
  }
  return streamExecutionV2(deps);
}

async function streamExecutionV2(
  deps: StreamDependencies,
): Promise<StreamResult> {
  const {
    agentGraph,
    langgraphInput,
    langgraphConfig,
    executionId,
    client,
    initialStatus,
    streamingConfig,
    retryOptions,
    offload,
    stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS,
    heartbeatFn,
    isCancelledFn,
    gracefulStop,
    inlinePublisher,
    writebackCoordinator,
    approvalProvider,
  } = deps;

  const statusBuilder = new StatusBuilder(executionId, initialStatus);
  if (approvalProvider) {
    statusBuilder.setApprovalProvider(approvalProvider);
  }
  const scheduler = new StreamingUpdateScheduler(streamingConfig);
  const recorder = createV2EventRecorder(executionId, process.env.V2_EVENT_RECORD_DIR);

  let eventsProcessed = 0;
  let lastEventTime = performance.now();
  let lastHeartbeatTime = performance.now();
  const heartbeatIntervalMs = 2000;

  const pendingPublishPromises: Promise<void>[] = [];
  const pendingWritebackPromises: Promise<void>[] = [];

  try {
    const stream = agentGraph.streamEvents(
      langgraphInput,
      langgraphConfig,
      { version: "v2" },
    );

    for await (const event of stream) {
      if (isCancelledFn?.()) {
        return handlePause(statusBuilder, eventsProcessed, pendingPublishPromises, pendingWritebackPromises);
      }

      lastEventTime = performance.now();
      recorder?.record(event, eventsProcessed);
      statusBuilder.processEvent(event);
      eventsProcessed++;

      if (event.event === "on_tool_end" && (inlinePublisher || writebackCoordinator)) {
        const filePath = extractFilePathFromToolEnd(event);
        if (filePath) {
          if (inlinePublisher) {
            pendingPublishPromises.push(inlinePublisher.publish(filePath));
          }
          if (writebackCoordinator) {
            pendingWritebackPromises.push(writebackCoordinator.onFileModified(filePath));
          }
        }
      }

      const now = performance.now();
      if (heartbeatFn && (now - lastHeartbeatTime) >= heartbeatIntervalMs) {
        sendHeartbeat(heartbeatFn, executionId, eventsProcessed, statusBuilder);
        lastHeartbeatTime = now;
      }

      const shouldPersist = statusBuilder.forceNextUpdate ||
        scheduler.shouldSendUpdate(eventsProcessed);

      if (shouldPersist) {
        if (statusBuilder.forceNextUpdate) {
          statusBuilder.clearForceFlag();
        }

        const signal = await persistStatus(
          client,
          executionId,
          statusBuilder.currentStatus,
          { offload, retry: retryOptions },
        );
        scheduler.markUpdateSent(eventsProcessed);

        if (signal === ExecutionControlSignal.STOP) {
          console.warn(
            `[streaming] STOP signal received for execution ${executionId}`,
          );
          if (gracefulStop) {
            gracefulStop.activate("Platform STOP signal");
          } else {
            return handleStop(statusBuilder, eventsProcessed, pendingPublishPromises, pendingWritebackPromises);
          }
        }
      }

      checkStallTimeout(lastEventTime, stallTimeoutMs, executionId);
    }
  } catch (err: unknown) {
    if (isGraphRecursionError(err)) {
      return handleRecursionLimit(statusBuilder, eventsProcessed, pendingPublishPromises, pendingWritebackPromises);
    }
    throw err;
  }

  await recorder?.flush();

  if (eventsProcessed === 0) {
    throw new Error(
      "Stream completed without processing any events. " +
      "This may indicate a configuration error.",
    );
  }

  if (initialStatus.phase === ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL) {
    console.log(
      `[streaming] execution=${executionId} stream ended with WAITING_FOR_APPROVAL. ` +
      `Not setting COMPLETED. pending_approvals computed server-side.`,
    );
    return {
      eventsProcessed,
      terminalStatus: slimStatus(initialStatus),
      pendingPublishPromises,
      pendingWritebackPromises,
    };
  }

  console.log(
    `[streaming] execution=${executionId} stream finished — ` +
    `processed ${eventsProcessed} events`,
  );

  return { eventsProcessed, pendingPublishPromises, pendingWritebackPromises };
}

// Terminal state handlers imported from streaming-terminal.ts

// ── Helpers ──────────────────────────────────────────────────────────

function sendHeartbeat(
  fn: (details: Record<string, unknown>) => void,
  executionId: string,
  eventsProcessed: number,
  sb: StatusBuilder,
): void {
  try {
    fn({
      executionId,
      eventsProcessed,
      messages: sb.currentStatus.messages.length,
      phase: sb.currentStatus.phase,
    });
  } catch (err) {
    console.warn(`[streaming] Heartbeat failed for ${executionId}:`, err);
  }
}

function checkStallTimeout(
  lastEventTime: number,
  stallTimeoutMs: number,
  executionId: string,
): void {
  const elapsed = performance.now() - lastEventTime;
  if (elapsed > stallTimeoutMs) {
    throw new StallTimeoutError(
      `Agent stream stalled: no events received for ${Math.round(elapsed / 1000)}s ` +
      `for execution ${executionId}`,
    );
  }
}

function extractFilePathFromToolEnd(event: StreamEvent): string | null {
  const toolName = event.name ?? "";
  if (!isFileModifyingTool(toolName)) return null;

  const input = event.data?.input as Record<string, unknown> | undefined;
  if (!input) return null;

  return extractFilePath(input);
}

export class StallTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StallTimeoutError";
  }
}
