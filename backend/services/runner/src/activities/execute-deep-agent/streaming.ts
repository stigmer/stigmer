/**
 * Streaming execution loop for ExecuteDeepAgent.
 *
 * Replaces the Phase 3a invoke() approach with streamEvents() v2
 * consumption. Feeds events to the StatusBuilder, persists status
 * via the scheduler + retry executor, handles terminal conditions
 * (STOP signal, stall, recursion limit, cancellation).
 *
 * Phase 3b-i scope: no middleware, no inline publish, no git writeback.
 * Those plug in during Phases 3b-ii and 3b-iii.
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

import { StatusBuilder, type StreamEvent } from "./status-builder.js";
import {
  StreamingUpdateScheduler,
  type StreamingConfig,
} from "./streaming-scheduler.js";
import { persistWithRetry, type RetryOptions } from "../../shared/grpc-retry.js";
import { slimStatus, utcTimestamp } from "../../shared/status.js";
import type { StigmerClient } from "../../client/stigmer-client.js";
import type { GracefulStopMiddleware } from "../../middleware/index.js";

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
  readonly stallTimeoutMs?: number;
  /** Temporal heartbeat. Injected so the loop is testable without Temporal. */
  readonly heartbeatFn?: (details: Record<string, unknown>) => void;
  /** Temporal cancellation check. */
  readonly isCancelledFn?: () => boolean;
  /** GracefulStopMiddleware instance for platform STOP signal handling. */
  readonly gracefulStop?: GracefulStopMiddleware;
}

export interface StreamResult {
  readonly eventsProcessed: number;
  readonly terminalStatus?: unknown;
}

/**
 * Run the streaming loop: consume streamEvents, map to proto via
 * StatusBuilder, persist on schedule, and handle terminal conditions.
 */
export async function streamExecution(
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
    stallTimeoutMs = DEFAULT_STALL_TIMEOUT_MS,
    heartbeatFn,
    isCancelledFn,
    gracefulStop,
  } = deps;

  const statusBuilder = new StatusBuilder(executionId, initialStatus);
  const scheduler = new StreamingUpdateScheduler(streamingConfig);

  let eventsProcessed = 0;
  let lastEventTime = performance.now();
  let lastHeartbeatTime = performance.now();
  const heartbeatIntervalMs = 2000;

  try {
    const stream = agentGraph.streamEvents(
      langgraphInput,
      langgraphConfig,
      { version: "v2" },
    );

    for await (const event of stream) {
      if (isCancelledFn?.()) {
        return handlePause(statusBuilder, eventsProcessed);
      }

      lastEventTime = performance.now();
      statusBuilder.processEvent(event);
      eventsProcessed++;

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

        const signal = await persistWithRetry(
          client,
          executionId,
          statusBuilder.currentStatus,
          retryOptions,
        );
        scheduler.markUpdateSent(eventsProcessed);

        if (signal === ExecutionControlSignal.STOP) {
          console.warn(
            `[streaming] STOP signal received for execution ${executionId}`,
          );
          if (gracefulStop) {
            gracefulStop.activate("Platform STOP signal");
          } else {
            return handleStop(statusBuilder, eventsProcessed);
          }
        }
      }

      checkStallTimeout(lastEventTime, stallTimeoutMs, executionId);
    }
  } catch (err: unknown) {
    if (isGraphRecursionError(err)) {
      return handleRecursionLimit(statusBuilder, eventsProcessed);
    }
    throw err;
  }

  if (eventsProcessed === 0) {
    throw new Error(
      "Stream completed without processing any events. " +
      "This may indicate a configuration error.",
    );
  }

  console.log(
    `[streaming] execution=${executionId} stream finished — ` +
    `processed ${eventsProcessed} events`,
  );

  return { eventsProcessed };
}

// ── Terminal State Handlers ──────────────────────────────────────────

function handlePause(
  sb: StatusBuilder,
  eventsProcessed: number,
): StreamResult {
  const status = sb.currentStatus;
  status.phase = ExecutionPhase.EXECUTION_PAUSED;
  status.messages.push(create(AgentMessageSchema, {
    type: MessageType.MESSAGE_SYSTEM,
    content: "Execution paused by user. Use resume to continue from this checkpoint.",
    timestamp: utcTimestamp(),
  }));

  return {
    eventsProcessed,
    terminalStatus: slimStatus(status),
  };
}

function handleStop(
  sb: StatusBuilder,
  eventsProcessed: number,
): StreamResult {
  const status = sb.currentStatus;
  status.phase = ExecutionPhase.EXECUTION_COMPLETED;
  status.completedAt = utcTimestamp();
  status.messages.push(create(AgentMessageSchema, {
    type: MessageType.MESSAGE_SYSTEM,
    content: "Execution stopped by the platform.",
    timestamp: utcTimestamp(),
  }));

  return {
    eventsProcessed,
    terminalStatus: slimStatus(status),
  };
}

function handleRecursionLimit(
  sb: StatusBuilder,
  eventsProcessed: number,
): StreamResult {
  const status = sb.currentStatus;
  status.phase = ExecutionPhase.EXECUTION_TERMINATED;
  status.completedAt = utcTimestamp();
  status.error =
    `Agent reached the tool-call limit after processing ${eventsProcessed} events. ` +
    `Send another message to continue.`;
  status.messages.push(create(AgentMessageSchema, {
    type: MessageType.MESSAGE_SYSTEM,
    content:
      "The agent reached the tool-call limit for this message. " +
      "Work completed so far has been saved. " +
      "Send another message to continue where the agent left off.",
    timestamp: utcTimestamp(),
  }));

  return {
    eventsProcessed,
    terminalStatus: slimStatus(status),
  };
}

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

function isGraphRecursionError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.constructor.name === "GraphRecursionError" ||
      err.message.includes("GraphRecursionError") ||
      err.message.includes("Recursion limit");
  }
  return false;
}

export class StallTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StallTimeoutError";
  }
}
