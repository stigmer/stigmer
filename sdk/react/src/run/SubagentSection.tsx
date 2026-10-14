"use client";

import { memo, useMemo } from "react";
import type { Thread, ToolUse, TurnItem } from "@stigmer/sdk";
import { useRenderTracer } from "../internal/dev/index.js";
import { useAutoDisclosure } from "../internal/useAutoDisclosure.js";
import { useElapsedSince, formatElapsed } from "../internal/useElapsedSince.js";
import { cn } from "@stigmer/theme";
import { formatHeaderDuration } from "./ToolCallDetail.js";
import { MessageEntry, type ThreadMessage } from "./MessageEntry.js";
import { ToolCallGroup } from "./ToolCallGroup.js";
import { isInternalTool } from "./tool-categories.js";
import { SpinnerIcon } from "../internal/thread-card/glyphs.js";

/** Props for {@link SubagentSection}. */
export interface SubagentSectionProps {
  /** The subagent's thread, from the session's fold (`ToolUse.thread`). */
  readonly thread: Thread;
  /**
   * What the subagent was asked to do, in a few words (the `task` call's
   * description, {@link subagentSubjectOf}); the card's title beside the
   * agent's name. Omitted, the agent's name titles it.
   */
  readonly subject?: string;
  /** When the subagent started (its `task` call's time), for the duration. */
  readonly startedAt?: string;
  /** When it finished (its `task` call's result time), for the duration. */
  readonly completedAt?: string;
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
 * What a `task` call asked its subagent to do, in a few words: the call's
 * `description` input, or "" when it carries none.
 */
export function subagentSubjectOf(toolUse: Pick<ToolUse, "input">): string {
  const description = toolUse.input["description"];
  return typeof description === "string" ? description : "";
}

/**
 * Renders a subagent's thread as a nested mini-thread inside the parent
 * conversation: its messages and tool uses, in the order it produced them.
 *
 * When `collapsible` is `true` (default), the component renders as a
 * bordered card with a clickable summary row. The card is open while the
 * subagent works or one of its calls waits for a person, and settles closed
 * when it finishes — the summary row shows status, subject, and duration at
 * a glance.
 *
 * Visually distinguished from {@link ToolCallGroup} via a left
 * accent border and bot icon, signaling delegated subagent work.
 *
 * When `collapsible` is `false`, the component renders flat content
 * without a toggle — suitable for embedding inside a parent that
 * already provides expand/collapse (e.g. {@link ToolCallItem}).
 *
 * Composes {@link MessageEntry} and {@link ToolCallGroup} — the same
 * building blocks the top-level {@link MessageThread} uses.
 *
 * Wrapped in `React.memo` — the session fold keeps an unchanged thread's
 * reference, so a finished subagent skips re-renders entirely.
 *
 * @example
 * ```tsx
 * // Standalone collapsible card (default)
 * <SubagentSection thread={toolUse.thread} subject={subagentSubjectOf(toolUse)} />
 *
 * // Flat layout inside a parent expand/collapse
 * <SubagentSection thread={toolUse.thread} collapsible={false} />
 * ```
 */
export const SubagentSection = memo(function SubagentSection({
  thread,
  subject = "",
  startedAt = "",
  completedAt = "",
  collapsible = true,
  className,
}: SubagentSectionProps) {
  useRenderTracer("SubagentSection", { status: thread.state, name: thread.agentName });

  // Header chip threshold (>= 1s) shared with ToolCallItem — a sub-second
  // subagent is noise by the same rule, and the two row kinds must speak
  // one duration vocabulary.
  const duration = formatHeaderDuration(startedAt, completedAt);
  const statusInfo = SUB_AGENT_STATUS_MAP[thread.state];
  const StatusIcon = statusInfo.icon;
  const threadItems = useMemo(() => buildSubagentThreadItems(thread.items), [thread.items]);
  // A failed subagent's reply is its error.
  const error = thread.state === "failed" ? thread.reply : "";

  const displayLabel = subject || thread.agentName;

  if (!collapsible) {
    return (
      <FlatContent
        thread={thread}
        subject={subject}
        statusInfo={statusInfo}
        StatusIcon={StatusIcon}
        duration={duration}
        threadItems={threadItems}
        error={error}
        className={className}
      />
    );
  }

  return (
    <CollapsibleCard
      thread={thread}
      statusInfo={statusInfo}
      displayLabel={displayLabel}
      startedAt={startedAt}
      duration={duration}
      threadItems={threadItems}
      error={error}
      className={className}
    />
  );
});

// ---------------------------------------------------------------------------
// Collapsible card — progressive disclosure (default mode)
// ---------------------------------------------------------------------------

interface CollapsibleCardProps {
  readonly thread: Thread;
  readonly statusInfo: SubagentStatusInfo;
  readonly displayLabel: string;
  readonly startedAt: string;
  readonly duration: string | null;
  readonly threadItems: readonly SubagentThreadItem[];
  readonly error: string;
  readonly className?: string;
}

function CollapsibleCard({
  thread,
  statusInfo,
  displayLabel,
  startedAt,
  duration,
  threadItems,
  error,
  className,
}: CollapsibleCardProps) {
  const isRunning = thread.state === "running";

  // A call inside this subagent that waits for a person must be reachable:
  // a delegated tool can hold the turn just like a top-level one, so the
  // card opens while one waits and its inline decision (rendered by the
  // nested ToolCallItem) is visible without a click.
  const waitsInside = useMemo(() => threadWaits(thread), [thread]);

  // Open while running or while a nested call waits; settle closed when done
  // — unless the user takes manual control.
  const [expanded, handleToggle] = useAutoDisclosure(isRunning || waitsInside);

  const ariaLabel = `Subagent: ${displayLabel}, ${statusInfo.label}`;

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
          <RunningDuration startedAt={startedAt} />
        ) : (
          duration && (
            <span className="stg:shrink-0 stg:tabular-nums stg:text-muted-foreground">
              {duration}
            </span>
          )
        )}
        <ChevronIcon expanded={expanded} />
      </button>

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
              <SubagentThreadContent
                threadItems={threadItems}
                input={thread.input}
                error={error}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Ticking elapsed time for a running subagent's header, where the static
 * duration (which needs the finish time) is still null.
 *
 * The honest live affordance for a running subagent: an engine that
 * reports a subagent's work only when its `task` call returns streams no
 * nested items meanwhile, so a counter that visibly advances tells the user
 * work is progressing without fabricating intermediate state. An engine that
 * streams nested items as they happen shows them beside it.
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
  readonly thread: Thread;
  readonly subject: string;
  readonly statusInfo: SubagentStatusInfo;
  readonly StatusIcon: () => React.JSX.Element;
  readonly duration: string | null;
  readonly threadItems: readonly SubagentThreadItem[];
  readonly error: string;
  readonly className?: string;
}

function FlatContent({
  thread,
  subject,
  statusInfo,
  StatusIcon,
  duration,
  threadItems,
  error,
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
          {thread.agentName}
        </span>
        {subject && (
          <span className="stg:text-muted-foreground">
            {subject}
          </span>
        )}
        {duration && (
          <span className="stg:tabular-nums stg:text-muted-foreground">
            {duration}
          </span>
        )}
      </div>

      <SubagentThreadContent
        threadItems={threadItems}
        input={thread.input}
        error={error}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared thread content renderer
// ---------------------------------------------------------------------------

interface SubagentThreadContentProps {
  readonly threadItems: readonly SubagentThreadItem[];
  readonly input: string;
  /** The failed subagent's error; "" otherwise. */
  readonly error: string;
}

function SubagentThreadContent({
  threadItems,
  input,
  error,
}: SubagentThreadContentProps) {
  return (
    <>
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
                    toolUses={item.toolUses}
                  />
                );
            }
          })}
        </div>
      )}

      {error && (
        <div className="stg:rounded-md stg:border stg:border-destructive/20 stg:bg-destructive-subtle stg:px-2 stg:py-1.5 stg:text-xs stg:text-destructive">
          {error}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Thread item builder for a subagent's items
// ---------------------------------------------------------------------------

type SubagentThreadItem =
  | { readonly kind: "message"; readonly message: ThreadMessage; readonly key: string }
  | { readonly kind: "tool-group"; readonly toolUses: readonly ToolUse[]; readonly key: string };

/**
 * A subagent's items as rows: each message, thinking or note on its own,
 * each run of consecutive tool uses (internal to-do calls left out) as one
 * group. A compaction marker is not shown inside a subagent.
 */
function buildSubagentThreadItems(items: ReadonlyArray<TurnItem>): SubagentThreadItem[] {
  const rows: SubagentThreadItem[] = [];
  let group: ToolUse[] = [];
  const flush = (): void => {
    if (group.length === 0) return;
    rows.push({ kind: "tool-group", toolUses: group, key: `${group[0]!.id}-tc` });
    group = [];
  };
  for (const item of items) {
    switch (item.kind) {
      case "tool_use":
        if (!isInternalTool(item.name)) group.push(item);
        break;
      case "message":
      case "thinking":
      case "note":
        flush();
        rows.push({ kind: "message", message: item, key: item.id });
        break;
      case "compacted":
        break;
    }
  }
  flush();
  return rows;
}

/** Whether any call of a thread (or of a subagent it started) waits for a person. */
function threadWaits(thread: Thread): boolean {
  return thread.items.some(
    (item) =>
      item.kind === "tool_use" &&
      (item.state === "waiting" || (item.thread !== undefined && threadWaits(item.thread))),
  );
}

// ---------------------------------------------------------------------------
// Subagent status mapping
// ---------------------------------------------------------------------------

interface SubagentStatusInfo {
  label: string;
  colorClass: string;
  badgeClass: string;
  icon: () => React.JSX.Element;
}

const SUB_AGENT_STATUS_MAP: Record<Thread["state"], SubagentStatusInfo> = {
  running: {
    label: "Running",
    colorClass: "stg:text-foreground",
    badgeClass: "stg:bg-muted stg:text-foreground",
    // Sized up to match this map's 12px siblings (the glyph defaults to 10).
    icon: () => <SpinnerIcon size={12} />,
  },
  completed: {
    label: "Completed",
    colorClass: "stg:text-success",
    badgeClass: "stg:bg-success/15 stg:text-success",
    icon: CheckCircleIcon,
  },
  failed: {
    label: "Failed",
    colorClass: "stg:text-destructive",
    badgeClass: "stg:bg-destructive/15 stg:text-destructive",
    icon: XCircleIcon,
  },
  // Its turn ended before the subagent finished.
  stopped: {
    label: "Stopped",
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
