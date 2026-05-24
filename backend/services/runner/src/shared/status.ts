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

export function utcTimestamp(): string {
  return new Date().toISOString().replace("+00:00", "Z");
}

/**
 * Persist execution status via gRPC. Returns the control signal from the
 * backend (e.g. STOP to abort the execution). Errors are logged and
 * swallowed — a failed status update should not crash the activity.
 */
export async function persistStatus(
  client: StigmerClient,
  executionId: string,
  status: AgentExecutionStatus,
): Promise<ExecutionControlSignal> {
  try {
    const response = await client.updateStatus(executionId, status);
    return response.signal;
  } catch (err) {
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
  return toJson(AgentExecutionStatusSchema, slim);
}
