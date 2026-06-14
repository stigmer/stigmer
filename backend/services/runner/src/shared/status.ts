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

/**
 * Persist execution status via gRPC. Returns the control signal from the
 * backend (e.g. STOP to abort the execution).
 *
 * This is the single chokepoint where the status payload is kept under the
 * 4 MiB gRPC cap (see status-offload.ts). When `offload` is supplied, oversized
 * tool outputs are spilled to artifact storage first; an aggregate size
 * backstop then runs unconditionally so callers without storage are still
 * protected. A `resource_exhausted` is never silently swallowed: we hard-elide
 * and retry once before giving up, so an oversized payload can never freeze
 * persistence invisibly (the bug that stalled the UI mid-execution).
 */
export async function persistStatus(
  client: StigmerClient,
  executionId: string,
  status: AgentExecutionStatus,
  offload?: ToolOutputOffloadContext,
): Promise<ExecutionControlSignal> {
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

  try {
    const response = await client.updateStatus(executionId, status);
    return response.signal;
  } catch (err) {
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
    console.error(`Failed to persist status for ${executionId}:`, err);
    return ExecutionControlSignal.UNSPECIFIED;
  }
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
