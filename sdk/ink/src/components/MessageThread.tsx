import React, { useMemo } from "react";
import { Box, Text, Static } from "ink";
import { create } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type {
  AgentMessage,
  ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import {
  ApprovalAction,
  ExecutionPhase,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { isTerminalPhase } from "@stigmer/react";
import { MessageEntry } from "./MessageEntry.js";
import { ToolCallGroup } from "./ToolCallGroup.js";
import { ExecutionProgress } from "./ExecutionProgress.js";
import { ApprovalPrompt } from "./ApprovalPrompt.js";

/** Props for {@link MessageThread}. */
export interface MessageThreadProps {
  /** Completed executions in chronological order. */
  readonly executions: readonly AgentExecution[];
  /** The currently streaming execution (appended after `executions`). */
  readonly activeStreamExecution?: AgentExecution | null;
  /** Optimistic user message shown before the stream delivers it. */
  readonly pendingUserMessage?: string | null;
  /** Callback for approval actions. Shows approval UI when provided. */
  readonly onApprovalSubmit?: (
    toolCallId: string,
    action: ApprovalAction,
  ) => void;
  /** Set of tool call IDs currently being submitted for approval. */
  readonly submittingApprovalIds?: ReadonlySet<string>;
}

type ThreadItem =
  | { readonly kind: "message"; readonly message: AgentMessage; readonly key: string }
  | { readonly kind: "tool-group"; readonly toolCalls: readonly ToolCall[]; readonly key: string }
  | { readonly kind: "phase"; readonly phase: ExecutionPhase; readonly key: string }
  | { readonly kind: "pending-message"; readonly content: string; readonly key: string }
  | { readonly kind: "approval"; readonly pendingApproval: PendingApproval; readonly key: string };

function buildThreadItems(
  executions: readonly AgentExecution[],
  activeStreamExecution: AgentExecution | null | undefined,
  pendingUserMessage: string | null | undefined,
  includeApprovals: boolean,
): ThreadItem[] {
  const items: ThreadItem[] = [];
  const allExecutions = activeStreamExecution
    ? [...executions, activeStreamExecution]
    : executions;

  for (let ei = 0; ei < allExecutions.length; ei++) {
    const exec = allExecutions[ei];
    const messages = exec.status?.messages ?? [];

    const specMessage = exec.spec?.message;
    if (specMessage && specMessage !== "execute") {
      const humanMsg = create(AgentMessageSchema);
      humanMsg.type = MessageType.MESSAGE_HUMAN;
      humanMsg.content = specMessage;
      items.push({ kind: "message", message: humanMsg, key: `e${ei}-spec` });
    }

    for (let mi = 0; mi < messages.length; mi++) {
      const msg = messages[mi];
      if (msg.type === MessageType.MESSAGE_TOOL) continue;

      const isEmptyAi =
        msg.type === MessageType.MESSAGE_AI && !msg.content.trim();

      if (!isEmptyAi) {
        items.push({ kind: "message", message: msg, key: `e${ei}-m${mi}` });
      }

      if (msg.type === MessageType.MESSAGE_AI && msg.toolCalls.length > 0) {
        items.push({
          kind: "tool-group",
          toolCalls: msg.toolCalls,
          key: `e${ei}-m${mi}-tc`,
        });
      }
    }
  }

  const lastExec = allExecutions[allExecutions.length - 1];
  const lastPhase =
    lastExec?.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;

  if (
    isTerminalPhase(lastPhase) &&
    lastPhase !== ExecutionPhase.EXECUTION_COMPLETED
  ) {
    items.push({ kind: "phase", phase: lastPhase, key: `phase-${lastPhase}` });
  }

  if (includeApprovals) {
    const approvals = lastExec?.status?.pendingApprovals ?? [];
    for (let ai = 0; ai < approvals.length; ai++) {
      items.push({
        kind: "approval",
        pendingApproval: approvals[ai],
        key: `approval-${approvals[ai].toolCallId || ai}`,
      });
    }
  }

  if (pendingUserMessage) {
    const alreadySynthesized = lastExec?.spec?.message === pendingUserMessage;
    if (!alreadySynthesized) {
      items.push({
        kind: "pending-message",
        content: pendingUserMessage,
        key: "pending-user-msg",
      });
    }
  }

  return items;
}

/**
 * Renders a continuous conversation thread from one or more
 * `AgentExecution` snapshots in the terminal.
 *
 * Composes {@link MessageEntry}, {@link ToolCallGroup},
 * {@link ExecutionProgress}, and {@link ApprovalPrompt} into a
 * scrolling terminal log.
 *
 * Historical items are rendered via Ink's `<Static>` component so
 * they are written once and don't re-render, keeping terminal
 * output efficient for long conversations.
 */
export function MessageThread({
  executions,
  activeStreamExecution,
  pendingUserMessage,
  onApprovalSubmit,
  submittingApprovalIds,
}: MessageThreadProps) {
  const includeApprovals = onApprovalSubmit != null;
  const items = useMemo(
    () =>
      buildThreadItems(
        executions,
        activeStreamExecution,
        pendingUserMessage,
        includeApprovals,
      ),
    [executions, activeStreamExecution, pendingUserMessage, includeApprovals],
  );

  const historyItems = activeStreamExecution ? items.slice(0, -getActiveCount(items)) : items;
  const liveItems = activeStreamExecution ? items.slice(items.length - getActiveCount(items)) : [];

  return (
    <Box flexDirection="column">
      <Static items={historyItems}>
        {(item) => (
          <Box key={item.key} flexDirection="column" marginBottom={1}>
            {renderItem(item, onApprovalSubmit, submittingApprovalIds)}
          </Box>
        )}
      </Static>

      {liveItems.map((item) => (
        <Box key={item.key} flexDirection="column" marginBottom={1}>
          {renderItem(item, onApprovalSubmit, submittingApprovalIds)}
        </Box>
      ))}
    </Box>
  );
}

function getActiveCount(items: ThreadItem[]): number {
  let count = 0;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (
      item.kind === "approval" ||
      item.kind === "pending-message" ||
      item.kind === "phase"
    ) {
      count++;
    } else if (
      item.kind === "message" &&
      item.message.type === MessageType.MESSAGE_AI &&
      item.message.isStreaming
    ) {
      count++;
      break;
    } else {
      break;
    }
  }
  return count;
}

function renderItem(
  item: ThreadItem,
  onApprovalSubmit?: (toolCallId: string, action: ApprovalAction) => void,
  submittingApprovalIds?: ReadonlySet<string>,
): React.ReactNode {
  switch (item.kind) {
    case "message":
      return <MessageEntry message={item.message} />;
    case "tool-group":
      return <ToolCallGroup toolCalls={item.toolCalls} />;
    case "phase":
      return <ExecutionProgress phase={item.phase} />;
    case "approval":
      return onApprovalSubmit ? (
        <ApprovalPrompt
          pendingApproval={item.pendingApproval}
          onSubmit={(action) =>
            onApprovalSubmit(item.pendingApproval.toolCallId, action)
          }
          isSubmitting={
            submittingApprovalIds?.has(item.pendingApproval.toolCallId) ?? false
          }
        />
      ) : null;
    case "pending-message":
      return (
        <Box paddingLeft={1}>
          <Text dimColor italic>
            {item.content}
          </Text>
        </Box>
      );
  }
}
