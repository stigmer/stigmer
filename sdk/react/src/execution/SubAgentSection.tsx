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
import { SpinnerIcon } from "../internal/thread-card/glyphs.js";

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
        "stg:rounded-md stg:border stg:border-border stg:border-l-2 stg:border-l-primary/30 stg:bg-muted-faint",
        className,
      )}
    >
      {/* Summary trigger */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={handleToggle}
        className={cn(
          "stg:flex stg:w-full stg:items-center stg:gap-2 stg:px-2.5 stg:py-1.5 stg:text-left stg:text-xs stg:text-muted-foreground stg:transition-colors",
          "stg:hover:bg-muted-subtle",
          "stg:cursor-pointer",
        )}
      >
        <span className="stg:shrink-0 stg:text-primary-muted" aria-hidden="true">
          <BotIcon />
        </span>
        <span className="stg:min-w-0 stg:flex-1 stg:truncate">{displayLabel}</span>
        {isRunning && (
          <span className="stg:shrink-0 stg:text-muted-foreground" aria-hidden="true">
            <SpinnerIcon size={12} />
          </span>
        )}
        <span
          className={cn(
            "stg:shrink-0 stg:rounded stg:px-1 stg:py-0.5 stg:text-[10px] stg:font-medium stg:leading-none",
            statusInfo.badgeClass,
          )}
        >
          {statusInfo.label}
        </span>
        {isRunning ? (
          <RunningDuration startedAt={sub.startedAt} />
        ) : (
          duration && (
            <span className="stg:shrink-0 stg:tabular-nums stg:text-muted-foreground">
              {duration}
            </span>
          )
        )}
        <ChevronIcon expanded={expanded} />
      </button>

      {/* Active todo preview — visible when collapsed */}
      {collapsedPreview && !expanded && (
        <div className="stg:flex stg:items-center stg:gap-1.5 stg:px-2.5 stg:pb-1.5 stg:text-xs stg:text-muted-foreground">
          <span className="stg:ml-[20px] stg:shrink-0" aria-hidden="true">
            {isRunning && activeTodo ? (
              <TodoInProgressIcon />
            ) : (
              <TodoCompletedSmallIcon />
            )}
          </span>
          <span className="stg:min-w-0 stg:truncate">{collapsedPreview}</span>
        </div>
      )}

      {/* Expanded content — CSS grid-rows animation */}
      <div
        className={cn(
          "stg:grid stg:transition-[grid-template-rows] stg:duration-150 stg:ease-out",
          expanded ? "stg:grid-rows-[1fr]" : "stg:grid-rows-[0fr]",
        )}
      >
        <div className="stg:overflow-hidden">
          {expanded && (
            <div className="stg:border-t stg:border-border-muted stg:px-2.5 stg:pb-2 stg:pt-1.5">
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
    <span className="stg:shrink-0 stg:tabular-nums stg:text-muted-foreground">
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
        "stg:border-l-2 stg:border-primary/20 stg:pl-3",
        className,
      )}
    >
      {/* Header */}
      <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-x-2 stg:gap-y-1 stg:py-1.5 stg:text-xs">
        <span
          className={cn("stg:shrink-0", statusInfo.colorClass)}
          aria-hidden="true"
        >
          <StatusIcon />
        </span>
        <span className="stg:font-medium stg:text-foreground">
          {sub.name}
        </span>
        {sub.subject && (
          <span className="stg:text-muted-foreground">
            {sub.subject}
          </span>
        )}
        {duration && (
          <span className="stg:tabular-nums stg:text-muted-foreground">
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
      {hasTodos && <TodoList todos={todos!} className="stg:pb-1" />}

      {input && (
        <div
          className="stg:border-l-2 stg:border-muted-foreground/25 stg:pl-2.5 stg:text-xs stg:text-muted-foreground stg:whitespace-pre-wrap stg:mb-1"
        >
          {input}
        </div>
      )}

      {threadItems.length > 0 && (
        <div className="stg:flex stg:flex-col stg:gap-1 stg:pb-1">
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
        <div className="stg:rounded-md stg:border stg:border-destructive/20 stg:bg-destructive-subtle stg:px-2 stg:py-1.5 stg:text-xs stg:text-destructive">
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
    colorClass: "stg:text-muted-foreground",
    badgeClass: "stg:bg-muted stg:text-muted-foreground",
    icon: DotIcon,
  },
  [SubAgentStatus.SUB_AGENT_PENDING]: {
    label: "Pending",
    colorClass: "stg:text-muted-foreground",
    badgeClass: "stg:bg-muted stg:text-muted-foreground",
    icon: DotIcon,
  },
  [SubAgentStatus.SUB_AGENT_IN_PROGRESS]: {
    label: "Running",
    colorClass: "stg:text-foreground",
    badgeClass: "stg:bg-muted stg:text-foreground",
    // Sized up to match this map's 12px siblings (the glyph defaults to 10).
    icon: () => <SpinnerIcon size={12} />,
  },
  [SubAgentStatus.SUB_AGENT_COMPLETED]: {
    label: "Completed",
    colorClass: "stg:text-success",
    badgeClass: "stg:bg-success/15 stg:text-success",
    icon: CheckCircleIcon,
  },
  [SubAgentStatus.SUB_AGENT_FAILED]: {
    label: "Failed",
    colorClass: "stg:text-destructive",
    badgeClass: "stg:bg-destructive/15 stg:text-destructive",
    icon: XCircleIcon,
  },
  [SubAgentStatus.SUB_AGENT_CANCELLED]: {
    label: "Cancelled",
    colorClass: "stg:text-muted-foreground",
    badgeClass: "stg:bg-muted stg:text-muted-foreground",
    icon: XCircleIcon,
  },
};

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

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
        "stg:shrink-0 stg:text-muted-foreground stg:transition-transform stg:duration-150",
        expanded && "stg:rotate-90",
      )}
      aria-hidden="true"
    >
      <path d="M4.5 2.5L7.5 6L4.5 9.5" />
    </svg>
  );
}
