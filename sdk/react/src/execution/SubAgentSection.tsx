"use client";

import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  MessageType,
  SubAgentStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { cn } from "@stigmer/theme";
import { formatDuration } from "./ToolCallDetail";
import { MessageEntry } from "./MessageEntry";
import { ToolCallGroup } from "./ToolCallGroup";

export interface SubAgentSectionProps {
  readonly subAgentExecution: SubAgentExecution;
  readonly className?: string;
}

/**
 * Renders a sub-agent execution as a nested mini-thread inside the
 * parent conversation.
 *
 * Composes {@link MessageEntry} and {@link ToolCallGroup} to display
 * the sub-agent's internal messages and tool calls — the same
 * building blocks used by the top-level {@link MessageThread}.
 *
 * Visually distinguished from the parent thread via a left border
 * and subtle background.
 *
 * @example
 * ```tsx
 * <SubAgentSection subAgentExecution={sub} />
 * ```
 */
export function SubAgentSection({
  subAgentExecution: sub,
  className,
}: SubAgentSectionProps) {
  const duration = formatDuration(sub.startedAt, sub.completedAt);
  const statusInfo = SUB_AGENT_STATUS_MAP[sub.status];
  const Icon = statusInfo.icon;
  const isFailed = sub.status === SubAgentStatus.SUB_AGENT_FAILED;
  const threadItems = buildSubAgentThreadItems(sub.messages);

  return (
    <div
      className={cn(
        "border-l-2 border-primary/20 pl-3",
        className,
      )}
    >
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-xs">
        <span
          className={cn("shrink-0", statusInfo.colorClass)}
          aria-hidden="true"
        >
          <Icon />
        </span>
        <span className="font-medium text-foreground">
          {sub.name}
        </span>
        {sub.subject && (
          <span className="text-muted-foreground">
            {sub.subject}
          </span>
        )}
        {duration && (
          <span className="tabular-nums text-muted-foreground">
            {duration}
          </span>
        )}
      </div>

      {/* Nested messages and tool groups */}
      {threadItems.length > 0 && (
        <div className="flex flex-col gap-1 pb-1">
          {threadItems.map((item) => {
            switch (item.kind) {
              case "message":
                return (
                  <MessageEntry key={item.key} message={item.message} />
                );
              case "tool-group":
                return (
                  <ToolCallGroup
                    key={item.key}
                    toolCalls={item.toolCalls}
                  />
                );
            }
          })}
        </div>
      )}

      {/* Error footer */}
      {isFailed && sub.error && (
        <div className="rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
          {sub.error}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Thread item builder for sub-agent messages
// ---------------------------------------------------------------------------

type SubAgentThreadItem =
  | { readonly kind: "message"; readonly message: AgentMessage; readonly key: string }
  | { readonly kind: "tool-group"; readonly toolCalls: readonly ToolCall[]; readonly key: string };

function buildSubAgentThreadItems(
  messages: readonly AgentMessage[],
): SubAgentThreadItem[] {
  const items: SubAgentThreadItem[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.type === MessageType.MESSAGE_TOOL) continue;

    items.push({ kind: "message", message: msg, key: `sa-m${i}` });

    if (msg.type === MessageType.MESSAGE_AI && msg.toolCalls.length > 0) {
      items.push({
        kind: "tool-group",
        toolCalls: msg.toolCalls,
        key: `sa-m${i}-tc`,
      });
    }
  }

  return items;
}

// ---------------------------------------------------------------------------
// Sub-agent status mapping
// ---------------------------------------------------------------------------

interface SubAgentStatusInfo {
  label: string;
  colorClass: string;
  icon: () => React.JSX.Element;
}

const SUB_AGENT_STATUS_MAP: Record<SubAgentStatus, SubAgentStatusInfo> = {
  [SubAgentStatus.SUB_AGENT_STATUS_UNSPECIFIED]: {
    label: "Unknown",
    colorClass: "text-muted-foreground",
    icon: DotIcon,
  },
  [SubAgentStatus.SUB_AGENT_PENDING]: {
    label: "Pending",
    colorClass: "text-muted-foreground",
    icon: DotIcon,
  },
  [SubAgentStatus.SUB_AGENT_IN_PROGRESS]: {
    label: "Running",
    colorClass: "text-foreground",
    icon: SpinnerIcon,
  },
  [SubAgentStatus.SUB_AGENT_COMPLETED]: {
    label: "Completed",
    colorClass: "text-success",
    icon: CheckCircleIcon,
  },
  [SubAgentStatus.SUB_AGENT_FAILED]: {
    label: "Failed",
    colorClass: "text-destructive",
    icon: XCircleIcon,
  },
  [SubAgentStatus.SUB_AGENT_CANCELLED]: {
    label: "Cancelled",
    colorClass: "text-muted-foreground",
    icon: XCircleIcon,
  },
};

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

function SpinnerIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="animate-spin"
    >
      <path d="M6 1.5A4.5 4.5 0 1 1 1.5 6" strokeLinecap="round" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="6" r="4.5" />
      <path d="M4 6L5.5 7.5L8 4.5" />
    </svg>
  );
}

function XCircleIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="6" r="4.5" />
      <path d="M4.5 4.5L7.5 7.5M7.5 4.5L4.5 7.5" />
    </svg>
  );
}

function DotIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
      <circle cx="4" cy="4" r="2.5" />
    </svg>
  );
}
