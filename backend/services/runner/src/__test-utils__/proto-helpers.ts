/**
 * Shared protobuf message factories for tests.
 *
 * Centralizes the `create(Schema, {...})` patterns that appear across
 * many test files. Reduces import boilerplate and ensures consistent
 * proto construction.
 */

import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionStatusSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

export function emptyStatus(): AgentExecutionStatus {
  return create(AgentExecutionStatusSchema, {});
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
