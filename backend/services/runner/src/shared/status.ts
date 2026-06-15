/**
 * Shared status persistence utilities for all runner activities.
 *
 * Both ExecuteCursor and ExecuteDeepAgent need to persist execution status
 * via gRPC, report setup progress phases, produce slim status payloads for
 * Temporal return values, and generate UTC timestamps. These thin utilities
 * are harness-agnostic — they operate on the common AgentExecutionStatus
 * proto without knowledge of Cursor SDK or LangGraph event shapes.
 */

import { create, toJson } from "@bufbuild/protobuf";
import {
  AgentExecutionStatusSchema,
  SetupProgressSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionControlSignal,
  ExecutionPhase,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { StigmerClient } from "../client/stigmer-client.js";
import {
  offloadOversizedToolOutputs,
  enforceStatusSizeLimit,
  STATUS_PAYLOAD_HARD_LIMIT_BYTES,
  type ToolOutputOffloadContext,
} from "./status-offload.js";
import {
  isRetryableError,
  isTerminalError,
  type RetryOptions,
} from "./grpc-retry.js";

export function utcTimestamp(): string {
  return new Date().toISOString().replace("+00:00", "Z");
}

/**
 * A connect-rpc `resource_exhausted` (gRPC code 8) — the payload exceeded the
 * server's receive cap. Matched by code and, defensively, by the message buf's
 * size check emits ("exceeds maximum size").
 */
function isPayloadTooLarge(err: unknown): boolean {
  if (typeof err === "object" && err !== null && "code" in err) {
    if ((err as { code?: unknown }).code === 8) return true;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return /resource_exhausted|exceeds maximum size/i.test(msg);
}

/** Options controlling how a status payload is bounded and persisted. */
export interface PersistStatusOptions {
  /**
   * When supplied, oversized tool outputs (a screenshot's base64, a multi-MB
   * dump) are spilled to artifact storage before persisting — the only path
   * that populates a renderable `ToolCallOutputRef`. When omitted, the
   * aggregate size backstop still runs, so the payload is bounded regardless.
   */
  readonly offload?: ToolOutputOffloadContext;
  /**
   * Transient-error backoff policy. Omitted fields fall back to
   * {@link DEFAULT_PERSIST_RETRY}; an omitted `retry` uses it entirely.
   */
  readonly retry?: RetryOptions;
}

/**
 * Default transient-retry policy: three attempts with exponential backoff.
 * Applied to every persist so a transient drop (server restart, brief
 * unavailability) recovers silently instead of dropping a status update.
 */
const DEFAULT_PERSIST_RETRY = {
  baseDelayMs: 100,
  backoffFactor: 2,
  maxRetries: 3,
} as const;

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Persist execution status via gRPC. Returns the control signal from the
 * backend (e.g. STOP to abort the execution).
 *
 * This is the single, unforgeable chokepoint for status persistence across
 * every harness (streaming and terminal, native and Cursor). Routing all
 * persistence through here guarantees three invariants that must never be
 * skipped by an individual call site:
 *
 *   1. Size bounding — when `offload` is supplied, oversized tool outputs are
 *      spilled to artifact storage first (the path that makes screenshots
 *      render); an aggregate backstop then runs unconditionally so callers
 *      without storage are still protected from the 4 MiB gRPC cap.
 *   2. Transient resilience — `Unavailable`/`DeadlineExceeded` back off and
 *      retry (default three attempts); terminal errors never retry.
 *   3. Oversize recovery — a `resource_exhausted` rejection is never silently
 *      swallowed: we hard-elide and retry once, so an oversized payload can
 *      never freeze persistence invisibly (the bug that stalled the UI).
 */
export async function persistStatus(
  client: StigmerClient,
  executionId: string,
  status: AgentExecutionStatus,
  options: PersistStatusOptions = {},
): Promise<ExecutionControlSignal> {
  const { offload, retry } = options;

  if (offload) {
    try {
      await offloadOversizedToolOutputs(status, offload);
    } catch (err) {
      console.warn(`[persistStatus] ${executionId}: tool-output offload failed (non-fatal): ${err}`);
    }
  }
  if (enforceStatusSizeLimit(status)) {
    console.warn(
      `[persistStatus] ${executionId}: status exceeded the soft size limit; ` +
      `elided oversized inline fields to fit under the gRPC cap`,
    );
  }

  const baseDelayMs = retry?.baseDelayMs ?? DEFAULT_PERSIST_RETRY.baseDelayMs;
  const backoffFactor = retry?.backoffFactor ?? DEFAULT_PERSIST_RETRY.backoffFactor;
  const maxRetries = retry?.maxRetries ?? DEFAULT_PERSIST_RETRY.maxRetries;
  const delay = retry?.delayFn ?? defaultDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.updateStatus(executionId, status);
      return response.signal;
    } catch (err) {
      // Oversize rejection is recoverable exactly once and out-of-band from the
      // transient budget: hard-elide the largest inline fields and retry now.
      if (isPayloadTooLarge(err)) {
        console.error(
          `[persistStatus] ${executionId}: payload rejected as too large despite ` +
          `the size guard; hard-eliding and retrying once`,
        );
        enforceStatusSizeLimit(status, STATUS_PAYLOAD_HARD_LIMIT_BYTES);
        try {
          const response = await client.updateStatus(executionId, status);
          return response.signal;
        } catch (retryErr) {
          console.error(`[persistStatus] ${executionId}: still failing after hard elide:`, retryErr);
          return ExecutionControlSignal.UNSPECIFIED;
        }
      }

      // Terminal errors (invalid argument, not found, permission denied) are
      // deterministic — retrying cannot help.
      if (isTerminalError(err)) {
        console.error(
          `[persistStatus] ${executionId}: terminal error persisting status ` +
          `(attempt ${attempt + 1}/${maxRetries + 1}): ${err}`,
        );
        return ExecutionControlSignal.UNSPECIFIED;
      }

      // Transient errors back off and retry until the budget is exhausted.
      if (isRetryableError(err) && attempt < maxRetries) {
        const delayMs = baseDelayMs * Math.pow(backoffFactor, attempt);
        console.warn(
          `[persistStatus] ${executionId}: retryable error ` +
          `(attempt ${attempt + 1}/${maxRetries + 1}, retry in ${delayMs}ms): ${err}`,
        );
        await delay(delayMs);
        continue;
      }

      // Non-retryable, non-terminal (e.g. a bare Error), or retries exhausted.
      console.error(`Failed to persist status for ${executionId}:`, err);
      return ExecutionControlSignal.UNSPECIFIED;
    }
  }

  return ExecutionControlSignal.UNSPECIFIED;
}

/**
 * Report a setup progress phase (e.g. "Resolving MCP servers") so the
 * frontend can display a spinner with context.
 */
export async function reportSetupProgress(
  client: StigmerClient,
  executionId: string,
  phase: string,
): Promise<void> {
  const status = create(AgentExecutionStatusSchema, {
    phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    setupProgress: create(SetupProgressSchema, { currentPhase: phase }),
  });
  await persistStatus(client, executionId, status);
}

/**
 * Strip heavy fields from a full status, keeping only workflow-critical
 * data for the Temporal return value. Messages and tool calls are already
 * persisted via gRPC — including them in the Temporal payload would
 * exceed size limits and cause serialization issues with protobuf bytes.
 *
 * Uses toJson() to produce canonical protobuf JSON (base64 bytes, string
 * enums, omitted defaults) instead of returning a raw @bufbuild/protobuf
 * message. Temporal's default JsonPayloadConverter calls JSON.stringify,
 * which serializes Uint8Array bytes fields as {} — invalid protobuf JSON
 * that the Java workflow's JsonFormat.Parser rejects.
 */
export function slimStatus(full: AgentExecutionStatus): unknown {
  const slim = create(AgentExecutionStatusSchema, {
    phase: full.phase,
    error: full.error,
    startedAt: full.startedAt,
    completedAt: full.completedAt,
    pendingApprovals: full.pendingApprovals,
    structuredOutput: full.structuredOutput,
  });
  const json = toJson(AgentExecutionStatusSchema, slim);
  if (full.structuredOutput) {
    const jsonObj = json as Record<string, unknown>;
    const hasField = "structuredOutput" in jsonObj;
    console.log(
      `[slimStatus] structuredOutput serialization: ` +
      `inputPresent=true, outputFieldPresent=${hasField}, ` +
      `outputKeys=${Object.keys(jsonObj).join(",")}`,
    );
  }
  return json;
}
