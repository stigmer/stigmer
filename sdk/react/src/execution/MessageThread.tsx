"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { create } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { AgentMessageSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import {
  ApprovalAction,
  ExecutionPhase,
  MessageType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { isTerminalPhase } from "./execution-phases";
import { MessageEntry } from "./MessageEntry";
import { ToolCallGroup } from "./ToolCallGroup";
import { ExecutionPhaseBadge } from "./ExecutionPhaseBadge";
import { ApprovalCard } from "./ApprovalCard";

export interface MessageThreadProps {
  /** Completed executions in chronological order. */
  readonly executions: readonly AgentExecution[];
  /**
   * The currently streaming execution. Appended after `executions` to
   * form a continuous thread. Pass `null` or `undefined` when no
   * execution is actively streaming.
   */
  readonly activeStreamExecution?: AgentExecution | null;
  /**
   * Optimistic user message shown at the end of the thread before the
   * stream delivers the real message. Rendered as a human message with
   * a sending indicator. Clear this prop once the stream delivers its
   * first snapshot.
   */
  readonly pendingUserMessage?: string | null;
  readonly className?: string;
  /**
   * Custom formatter for tool call summary labels. Passed through to
   * each {@link ToolCallGroup}.
   */
  readonly formatToolCallSummary?: (toolCalls: readonly ToolCall[]) => string;
  /**
   * Callback for approval actions. When provided and the active
   * execution has pending approvals, {@link ApprovalCard}s are
   * rendered as thread items. When omitted, no approval UI is
   * shown (backward compatible).
   */
  readonly onApprovalSubmit?: (
    toolCallId: string,
    action: ApprovalAction,
    comment?: string,
  ) => void;
  /**
   * Set of tool call IDs currently being submitted for approval.
   * Drives per-card loading state. Only meaningful when
   * `onApprovalSubmit` is provided.
   */
  readonly submittingApprovalIds?: ReadonlySet<string>;
  /**
   * Tool call IDs to exclude from the approval list. Used for
   * optimistic removal after a decision has been submitted --
   * the card disappears immediately without waiting for the next
   * stream snapshot. Managed by {@link useSessionConversation}.
   */
  readonly dismissedApprovalIds?: ReadonlySet<string>;
}

const AUTO_SCROLL_THRESHOLD_PX = 80;

/**
 * Flattened representation of one renderable item in the thread.
 *
 * Discriminated union keeps the render loop a simple switch with no
 * type narrowing gymnastics.
 */
type ThreadItem =
  | { readonly kind: "message"; readonly message: AgentMessage; readonly key: string }
  | { readonly kind: "tool-group"; readonly toolCalls: readonly ToolCall[]; readonly subAgentExecutions: readonly SubAgentExecution[]; readonly key: string }
  | { readonly kind: "phase-badge"; readonly phase: ExecutionPhase; readonly key: string }
  | { readonly kind: "pending-message"; readonly content: string; readonly key: string }
  | { readonly kind: "approval-request"; readonly pendingApproval: PendingApproval; readonly key: string };

function buildThreadItems(
  executions: readonly AgentExecution[],
  activeStreamExecution: AgentExecution | null | undefined,
  pendingUserMessage: string | null | undefined,
  includeApprovals: boolean,
  dismissedApprovalIds: ReadonlySet<string> | undefined,
): ThreadItem[] {
  const items: ThreadItem[] = [];
  const allExecutions = activeStreamExecution
    ? [...executions, activeStreamExecution]
    : executions;

  for (let ei = 0; ei < allExecutions.length; ei++) {
    const exec = allExecutions[ei];
    const messages = exec.status?.messages ?? [];
    const subAgents = exec.status?.subAgentExecutions ?? [];

    const specMessage = exec.spec?.message;
    if (specMessage && specMessage !== "execute") {
      const syntheticHumanMsg = create(AgentMessageSchema);
      syntheticHumanMsg.type = MessageType.MESSAGE_HUMAN;
      syntheticHumanMsg.content = specMessage;
      items.push({
        kind: "message",
        message: syntheticHumanMsg,
        key: `e${ei}-spec-msg`,
      });
    }

    for (let mi = 0; mi < messages.length; mi++) {
      const msg = messages[mi];

      if (msg.type === MessageType.MESSAGE_TOOL) continue;

      items.push({
        kind: "message",
        message: msg,
        key: `e${ei}-m${mi}`,
      });

      if (
        msg.type === MessageType.MESSAGE_AI &&
        msg.toolCalls.length > 0
      ) {
        items.push({
          kind: "tool-group",
          toolCalls: msg.toolCalls,
          subAgentExecutions: subAgents,
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
    items.push({
      kind: "phase-badge",
      phase: lastPhase,
      key: `phase-${lastPhase}`,
    });
  }

  if (includeApprovals) {
    const allApprovals = lastExec?.status?.pendingApprovals ?? [];
    for (let ai = 0; ai < allApprovals.length; ai++) {
      const approval = allApprovals[ai];
      if (dismissedApprovalIds?.has(approval.toolCallId)) continue;
      items.push({
        kind: "approval-request",
        pendingApproval: approval,
        key: `approval-${approval.toolCallId || ai}`,
      });
    }
  }

  if (pendingUserMessage) {
    const alreadySynthesized =
      lastExec?.spec?.message === pendingUserMessage;
    if (!alreadySynthesized) {
      items.push({
        kind: "pending-message",
        content: pendingUserMessage,
        key: "pending-user-message",
      });
    }
  }

  return items;
}

/**
 * Renders a continuous conversation thread from one or more
 * {@link AgentExecution} snapshots.
 *
 * Composes {@link MessageEntry}, {@link ToolCallGroup}, and
 * {@link ExecutionPhaseBadge} into a scrollable, auto-scrolling log
 * that follows new content when the user is near the bottom.
 *
 * Renders nothing when no executions are provided.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * const { executions } = useSessionExecutions(sessionId);
 * const stream = useExecutionStream(activeId);
 *
 * <MessageThread
 *   executions={executions ?? []}
 *   activeStreamExecution={stream.execution}
 * />
 * ```
 */
export function MessageThread({
  executions,
  activeStreamExecution,
  pendingUserMessage,
  className,
  formatToolCallSummary,
  onApprovalSubmit,
  submittingApprovalIds,
  dismissedApprovalIds,
}: MessageThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);

  const includeApprovals = onApprovalSubmit != null;
  const items = useMemo(
    () => buildThreadItems(executions, activeStreamExecution, pendingUserMessage, includeApprovals, dismissedApprovalIds),
    [executions, activeStreamExecution, pendingUserMessage, includeApprovals, dismissedApprovalIds],
  );

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isNearBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < AUTO_SCROLL_THRESHOLD_PX;
  }, []);

  useEffect(() => {
    if (!isNearBottomRef.current) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [items]);

  return (
    <div
      ref={scrollRef}
      role="log"
      aria-live="polite"
      aria-relevant="additions"
      onScroll={handleScroll}
      className={cn("flex flex-col gap-4 overflow-y-auto pt-6 pb-4", className)}
    >
      {items.map((item) => {
        switch (item.kind) {
          case "message":
            return <MessageEntry key={item.key} message={item.message} />;
          case "tool-group":
            return (
              <ToolCallGroup
                key={item.key}
                toolCalls={item.toolCalls}
                subAgentExecutions={item.subAgentExecutions}
                formatSummary={formatToolCallSummary}
                className="mx-4"
              />
            );
          case "phase-badge":
            return (
              <div key={item.key} className="flex justify-center py-3">
                <ExecutionPhaseBadge phase={item.phase} />
              </div>
            );
          case "approval-request":
            return (
              <ApprovalCard
                key={item.key}
                pendingApproval={item.pendingApproval}
                onSubmit={(action, comment) =>
                  onApprovalSubmit!(item.pendingApproval.toolCallId, action, comment)
                }
                isSubmitting={submittingApprovalIds?.has(item.pendingApproval.toolCallId) ?? false}
                className="mx-4"
              />
            );
          case "pending-message":
            return (
              <div
                key={item.key}
                role="article"
                aria-label="Sending message"
                className="rounded-lg bg-muted/50 px-4 py-3 opacity-70"
              >
                <p className="text-sm text-foreground whitespace-pre-wrap">
                  {item.content}
                </p>
              </div>
            );
        }
      })}
    </div>
  );
}
