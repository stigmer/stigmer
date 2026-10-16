/**
 * Shared protobuf message factories for tests.
 *
 * Centralizes the `create(Schema, {...})` patterns that appear across
 * many test files. Reduces import boilerplate and ensures consistent
 * proto construction.
 */

import { create } from "@bufbuild/protobuf";
import {
  RunStatusSchema,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { RunStatus } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
  TurnRowsSchema,
  type AgentMessage,
  type ToolCall,
  type TurnRows,
} from "../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { MessageType, ToolCallStatus } from "../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

export function emptyStatus(): RunStatus {
  return create(RunStatusSchema, {});
}

export function emptyRows(): TurnRows {
  return create(TurnRowsSchema, {});
}

export function aiMessage(content: string): AgentMessage {
  return create(AgentMessageSchema, {
    type: MessageType.MESSAGE_AI,
    content,
  });
}

export function toolCall(
  id: string,
  name: string,
  status: ToolCallStatus = ToolCallStatus.TOOL_CALL_RUNNING,
): ToolCall {
  return create(ToolCallSchema, { id, name, status });
}

/** The tool-call row with this id, wherever it sits in the root transcript. */
export function findToolCallRow(rows: { readonly messages: readonly AgentMessage[] }, toolCallId: string): ToolCall | undefined {
  for (const message of rows.messages) {
    const row = message.toolCalls.find((tc) => tc.id === toolCallId);
    if (row) return row;
  }
  return undefined;
}

/**
 * A tool call withheld for approval — the row a harness writes when it
 * proposes a gated side effect: WAITING_APPROVAL, `requiresApproval` set, and
 * the approval fields the server owns (`approvalAction`, `approvalDecidedAt`)
 * left at their defaults for the decision to fill in.
 */
export function waitingToolCall(id: string, name: string, approvalMessage: string): ToolCall {
  return create(ToolCallSchema, {
    id,
    name,
    status: ToolCallStatus.TOOL_CALL_WAITING_APPROVAL,
    requiresApproval: true,
    approvalMessage,
  });
}
