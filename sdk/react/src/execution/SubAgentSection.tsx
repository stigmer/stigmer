"use client";

import { memo, useContext, useMemo } from "react";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import type { TodoItem } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import type { AgentMessage, ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  MessageType,
  SubAgentStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { useRenderTracer } from "../internal/dev/index.js";
import { useAutoDisclosure } from "../internal/useAutoDisclosure.js";
import { useElapsedSince, formatElapsed } from "../internal/useElapsedSince.js";
import { cn } from "@stigmer/theme";
import { formatDuration } from "./ToolCallDetail.js";
import { MessageEntry } from "./MessageEntry.js";
import { ToolCallGroup } from "./ToolCallGroup.js";
import { ApprovalContext } from "./ApprovalContext.js";
import { isInternalTool } from "./tool-categories.js";
import {
  TodoList,
  TodoInProgressIcon,
  findActiveTodo,
  todoCompletionSummary,
} from "./TodoList.js";

/** Props for {@link SubAgentSection}. */
export interface SubAgentSectionProps {
  /** The sub-agent execution to render. */
  readonly subAgentExecution: SubAgentExecution;
  /**
   * Whether to render as a collapsible card with expand/collapse
   * toggle. Defaults to `true`.
   *
   * Set to `false` when rendered inside a parent that already
   * provides its own expand/collapse (e.g. {@link ToolCallItem}).
   */
  readonly collapsible?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a sub-agent execution as a nested mini-thread inside the
 * parent conversation.
 *
 * When `collapsible` is `true` (default), the component renders as a
 * bordered card with a clickable summary row. Cards start collapsed
 * — the summary row shows status, subject, and duration at a glance.
 * Users click to expand and see the nested messages and tool calls.
 *
 * Visually distinguished from {@link ToolCallGroup} via a left
 * accent border and bot icon, signaling delegated sub-agent work.
 *
 * When `collapsible` is `false`, the component renders flat content
 * without a toggle — suitable for embedding inside a parent that
 * already provides expand/collapse (e.g. {@link ToolCallItem}).
 *
 * Composes {@link MessageEntry} and {@link ToolCallGroup} to display
 * the sub-agent's internal messages and tool calls — the same
 * building blocks used by the top-level {@link MessageThread}.
 *
 * Wrapped in `React.memo` — structural sharing (T04) preserves the
 * `SubAgentExecution` reference when the sub-agent's state is
 * unchanged, so completed sub-agents skip re-renders entirely.
 *
 * @example
 * ```tsx
 * // Standalone collapsible card (default)
 * <SubAgentSection subAgentExecution={sub} />
 *
 * // Flat layout inside a parent expand/collapse
 * <SubAgentSection subAgentExecution={sub} collapsible={false} />
 * ```
 */
export const SubAgentSection = memo(function SubAgentSection({
  subAgentExecution: sub,
  collapsible = true,
  className,
}: SubAgentSectionProps) {
  useRenderTracer("SubAgentSection", { status: sub.status, name: sub.name });

  const duration = formatDuration(sub.startedAt, sub.completedAt);
  const statusInfo = SUB_AGENT_STATUS_MAP[sub.status];
  const StatusIcon = statusInfo.icon;
  const isFailed = sub.status === SubAgentStatus.SUB_AGENT_FAILED;
  const threadItems = buildSubAgentThreadItems(sub.id, sub.messages);

  const displayLabel = sub.subject || sub.name;

  if (!collapsible) {
    return (
      <FlatContent
        sub={sub}
        statusInfo={statusInfo}
        StatusIcon={StatusIcon}
        duration={duration}
        isFailed={isFailed}
        threadItems={threadItems}
        className={className}
      />
    );
  }

  return (
    <CollapsibleCard
      sub={sub}
      statusInfo={statusInfo}
      displayLabel={displayLabel}
      duration={duration}
      isFailed={isFailed}
      threadItems={threadItems}
      className={className}
    />
  );
});

// ---------------------------------------------------------------------------
// Collapsible card — progressive disclosure (default mode)
// ---------------------------------------------------------------------------

interface CollapsibleCardProps {
  readonly sub: SubAgentExecution;
  readonly statusInfo: SubAgentStatusInfo;
  readonly displayLabel: string;
  readonly duration: string | null;
  readonly isFailed: boolean;
  readonly threadItems: SubAgentThreadItem[];
  readonly className?: string;
}

function CollapsibleCard({
  sub,
  statusInfo,
  displayLabel,
  duration,
  isFailed,
  threadItems,
  className,
}: CollapsibleCardProps) {
  const hasTodos =
    sub.todos != null && Object.keys(sub.todos).length > 0;
  const isRunning = sub.status === SubAgentStatus.SUB_AGENT_IN_PROGRESS;
  const isCompleted = sub.status === SubAgentStatus.SUB_AGENT_COMPLETED;

  // A gate raised inside this sub-agent must be reachable: a delegated tool
  // can stop the run just like a top-level one. We detect one of this
  // sub-agent's tool calls awaiting approval and auto-open so its inline
  // approval (rendered by the nested ToolCallItem) is visible without a click.
  const { approvalsByToolCallId } = useContext(ApprovalContext);
  const hasPendingApprovalInside = useMemo(() => {
    if (approvalsByToolCallId.size === 0) return false;
    for (const msg of sub.messages) {
      if (msg.type !== MessageType.MESSAGE_AI) continue;
      for (const tc of msg.toolCalls) {
        if (tc.id && approvalsByToolCallId.has(tc.id)) return true;
      }
    }
    return false;
  }, [sub.messages, approvalsByToolCallId]);

  // Open while running or while a nested gate waits; settle closed (keeping the
  // todo/summary preview) when done — unless the user takes manual control.
  const [expanded, handleToggle] = useAutoDisclosure(
    isRunning || hasPendingApprovalInside,
  );

  const activeTodo = useMemo(() => findActiveTodo(sub.todos), [sub.todos]);
  const completionLabel = useMemo(
    () => (isCompleted && hasTodos ? todoCompletionSummary(sub.todos) : null),
    [sub.todos, isCompleted, hasTodos],
  );

  const collapsedPreview =
    isRunning && activeTodo
      ? activeTodo.content
      : isCompleted && completionLabel
        ? completionLabel
        : null;

  const ariaLabel = `Sub-agent: ${displayLabel}, ${statusInfo.label}`;

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "rounded-md border border-border border-l-2 border-l-primary/30 bg-muted-faint",
        className,
      )}
    >
      {/* Summary trigger */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={handleToggle}
        className={cn(
          "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs text-muted-foreground transition-colors",
          "hover:bg-muted-subtle",
          "cursor-pointer",
        )}
      >
        <span className="shrink-0 text-primary-muted" aria-hidden="true">
          <BotIcon />
        </span>
        <span className="min-w-0 flex-1 truncate">{displayLabel}</span>
        {isRunning && (
          <span className="shrink-0 text-muted-foreground" aria-hidden="true">
            <SpinnerIcon />
          </span>
        )}
        <span
          className={cn(
            "shrink-0 rounded px-1 py-0.5 text-[10px] font-medium leading-none",
            statusInfo.badgeClass,
          )}
        >
          {statusInfo.label}
        </span>
        {isRunning ? (
          <RunningDuration startedAt={sub.startedAt} />
        ) : (
          duration && (
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {duration}
            </span>
          )
        )}
        <ChevronIcon expanded={expanded} />
      </button>

      {/* Active todo preview — visible when collapsed */}
      {collapsedPreview && !expanded && (
        <div className="flex items-center gap-1.5 px-2.5 pb-1.5 text-xs text-muted-foreground">
          <span className="ml-[20px] shrink-0" aria-hidden="true">
            {isRunning && activeTodo ? (
              <TodoInProgressIcon />
            ) : (
              <TodoCompletedSmallIcon />
            )}
          </span>
          <span className="min-w-0 truncate">{collapsedPreview}</span>
        </div>
      )}

      {/* Expanded content — CSS grid-rows animation */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-150 ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          {expanded && (
            <div className="border-t border-border-muted px-2.5 pb-2 pt-1.5">
              <SubAgentThreadContent
                threadItems={threadItems}
                todos={sub.todos}
                input={sub.input}
                isFailed={isFailed}
                error={sub.error}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Ticking elapsed time for an IN_PROGRESS sub-agent's header, where the
 * static duration (which needs `completedAt`) is still null.
 *
 * This is the honest live affordance for a running sub-agent: the Cursor
 * SDK returns sub-agent internals only as a blob when the task tool
 * completes (verified against SDK 1.0.13 and 1.0.22 — zero events reach the
 * parent stream while the sub-agent runs), so there are no nested tool calls
 * to stream here. A counter that visibly advances tells the user work is
 * progressing without fabricating intermediate state. The native harness
 * streams nested messages as they happen; this counter simply accompanies
 * them.
 */
function RunningDuration({ startedAt }: { readonly startedAt: string }) {
  const elapsed = useElapsedSince(startedAt);
  if (elapsed === null) return null;

  return (
    <span className="shrink-0 tabular-nums text-muted-foreground">
      {formatElapsed(elapsed)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Flat content — no toggle (used inside ToolCallItem detail panel)
// ---------------------------------------------------------------------------

interface FlatContentProps {
  readonly sub: SubAgentExecution;
  readonly statusInfo: SubAgentStatusInfo;
  readonly StatusIcon: () => React.JSX.Element;
  readonly duration: string | null;
  readonly isFailed: boolean;
  readonly threadItems: SubAgentThreadItem[];
  readonly className?: string;
}

function FlatContent({
  sub,
  statusInfo,
  StatusIcon,
  duration,
  isFailed,
  threadItems,
  className,
}: FlatContentProps) {
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
          <StatusIcon />
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

      <SubAgentThreadContent
        threadItems={threadItems}
        todos={sub.todos}
        input={sub.input}
        isFailed={isFailed}
        error={sub.error}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared thread content renderer
// ---------------------------------------------------------------------------

interface SubAgentThreadContentProps {
  readonly threadItems: SubAgentThreadItem[];
  readonly todos?: { readonly [key: string]: TodoItem };
  readonly input?: string;
  readonly isFailed: boolean;
  readonly error: string;
}

function SubAgentThreadContent({
  threadItems,
  todos,
  input,
  isFailed,
  error,
}: SubAgentThreadContentProps) {
  const hasTodos = todos != null && Object.keys(todos).length > 0;

  return (
    <>
      {hasTodos && <TodoList todos={todos!} className="pb-1" />}

      {input && (
        <div
          className="border-l-2 border-muted-foreground/25 pl-2.5 text-xs text-muted-foreground whitespace-pre-wrap mb-1"
        >
          {input}
        </div>
      )}

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

      {isFailed && error && (
        <div className="rounded-md border border-destructive/20 bg-destructive-subtle px-2 py-1.5 text-xs text-destructive">
          {error}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Thread item builder for sub-agent messages
// ---------------------------------------------------------------------------

type SubAgentThreadItem =
  | { readonly kind: "message"; readonly message: AgentMessage; readonly key: string }
  | { readonly kind: "tool-group"; readonly toolCalls: readonly ToolCall[]; readonly key: string };

function buildSubAgentThreadItems(
  subAgentId: string,
  messages: readonly AgentMessage[],
): SubAgentThreadItem[] {
  const items: SubAgentThreadItem[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.type === MessageType.MESSAGE_TOOL) continue;

    items.push({ kind: "message", message: msg, key: `${subAgentId}-m${i}` });

    if (msg.type === MessageType.MESSAGE_AI && msg.toolCalls.length > 0) {
      const visibleTools = msg.toolCalls.filter((tc) => !isInternalTool(tc.name));
      if (visibleTools.length > 0) {
        items.push({
          kind: "tool-group",
          toolCalls: visibleTools.length === msg.toolCalls.length ? msg.toolCalls : visibleTools,
          key: `${subAgentId}-m${i}-tc`,
        });
      }
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
  badgeClass: string;
  icon: () => React.JSX.Element;
}

const SUB_AGENT_STATUS_MAP: Record<SubAgentStatus, SubAgentStatusInfo> = {
  [SubAgentStatus.SUB_AGENT_STATUS_UNSPECIFIED]: {
    label: "Unknown",
    colorClass: "text-muted-foreground",
    badgeClass: "bg-muted text-muted-foreground",
    icon: DotIcon,
  },
  [SubAgentStatus.SUB_AGENT_PENDING]: {
    label: "Pending",
    colorClass: "text-muted-foreground",
    badgeClass: "bg-muted text-muted-foreground",
    icon: DotIcon,
  },
  [SubAgentStatus.SUB_AGENT_IN_PROGRESS]: {
    label: "Running",
    colorClass: "text-foreground",
    badgeClass: "bg-muted text-foreground",
    icon: SpinnerIcon,
  },
  [SubAgentStatus.SUB_AGENT_COMPLETED]: {
    label: "Completed",
    colorClass: "text-success",
    badgeClass: "bg-success/15 text-success",
    icon: CheckCircleIcon,
  },
  [SubAgentStatus.SUB_AGENT_FAILED]: {
    label: "Failed",
    colorClass: "text-destructive",
    badgeClass: "bg-destructive/15 text-destructive",
    icon: XCircleIcon,
  },
  [SubAgentStatus.SUB_AGENT_CANCELLED]: {
    label: "Cancelled",
    colorClass: "text-muted-foreground",
    badgeClass: "bg-muted text-muted-foreground",
    icon: XCircleIcon,
  },
};

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

function SpinnerIcon() {
  return (
    <svg
      width="12"
      height="12"
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
      width="12"
      height="12"
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
      width="12"
      height="12"
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

function TodoCompletedSmallIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 6L5 8.5L9.5 3.5" />
    </svg>
  );
}

function BotIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="6" width="12" height="8" rx="2" />
      <path d="M5.5 10H5.51M10.5 10H10.51" strokeWidth="2" />
      <path d="M8 2V6" />
      <circle cx="8" cy="1.5" r="1" />
      <path d="M0.5 9.5H2M14 9.5H15.5" />
    </svg>
  );
}


function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn(
        "shrink-0 text-muted-foreground transition-transform duration-150",
        expanded && "rotate-90",
      )}
      aria-hidden="true"
    >
      <path d="M4.5 2.5L7.5 6L4.5 9.5" />
    </svg>
  );
}
