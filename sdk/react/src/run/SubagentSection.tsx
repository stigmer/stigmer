"use client";

// A helper's work inside the parent conversation, drawn as one more step: the
// step row's shell, the helper's subject as its line, its agent's name as a
// tag, its time on the right, and its own messages and steps in the body.

import { memo, useMemo } from "react";
import type { Thread, ToolUse, TurnItem } from "@stigmer/client";
import { useRenderTracer } from "../internal/dev/index.js";
import { useAutoDisclosure } from "../internal/useAutoDisclosure.js";
import { formatElapsed } from "@stigmer/client";
import { useElapsedSince } from "../internal/useElapsedSince.js";
import { cn } from "@stigmer/design-tokens";
import { formatHeaderDuration } from "./ToolCallDetail.js";
import { MessageEntry, type ThreadMessage } from "./MessageEntry.js";
import { ToolCallGroup } from "./ToolCallGroup.js";
import { isInternalTool } from "@stigmer/react-core/internal";
import {
  ThreadCardShell,
  ThreadCardHeader,
  ThreadCardBody,
  SpinnerIcon,
} from "../internal/thread-card/index.js";
import { Tag } from "../internal/surface/Tag.js";
import { HELPER_WORD, HelperEndingBadge, HelperGlyph, helperTagWord } from "./helper-step.js";

/** Props for {@link SubagentSection}. */
export interface SubagentSectionProps {
  /** The subagent's thread, from the session's fold (`ToolUse.thread`). */
  readonly thread: Thread;
  /**
   * What the subagent was asked to do, in a few words (the `task` call's
   * description, {@link subagentSubjectOf}); the step's line, with the
   * agent's name as a tag beside it. Omitted, the agent's name is the line.
   */
  readonly subject?: string;
  /** When the subagent started (its `task` call's time), for the duration. */
  readonly startedAt?: string;
  /** When it finished (its `task` call's result time), for the duration. */
  readonly completedAt?: string;
  /**
   * Whether to render as a step of its own, with a header and an
   * expand/collapse toggle. Defaults to `true`.
   *
   * Set to `false` when rendered inside a parent row that already draws
   * the helper's header and toggle (e.g. {@link ToolCallItem}): the flat
   * form is the helper's work alone (its brief, its steps, its error), with
   * no header of its own.
   */
  readonly collapsible?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a subagent's thread as a nested mini-thread inside the parent
 * conversation: its messages and tool uses, in the order it produced them.
 *
 * When `collapsible` is `true` (default), the helper reads as a step, drawn
 * on the same shell as every other step row: a helper glyph, its subject as
 * the line, its agent's name as a tag beside it ("Helper" when it has
 * none), and its time on the right (ticking while it works). It is open
 * while the helper works or one of its calls waits for a person, and
 * settles closed when it finishes; a click opens it again. Like the step
 * rows, it carries a pill only when it failed or stopped: a working or
 * finished helper says nothing beyond its line. Its own steps render at the
 * body's padding.
 *
 * When `collapsible` is `false`, the component renders the helper's work
 * alone, without a header or toggle, for a parent row that already draws
 * both (e.g. {@link ToolCallItem}).
 *
 * Composes {@link MessageEntry} and {@link ToolCallGroup} — the same
 * building blocks the top-level {@link MessageThread} uses.
 *
 * Wrapped in `React.memo` — the session fold keeps an unchanged thread's
 * reference, so a finished subagent skips re-renders entirely.
 *
 * @example
 * ```tsx
 * import type { ToolUse } from "@stigmer/client";
 *
 * function Subagent({ toolUse }: { toolUse: ToolUse }) {
 *   if (!toolUse.thread) return null;
 *   return <SubagentSection thread={toolUse.thread} subject={subagentSubjectOf(toolUse)} />;
 * }
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
  const threadItems = useMemo(() => buildSubagentThreadItems(thread.items), [thread.items]);
  // A failed subagent's reply is its error.
  const error = thread.state === "failed" ? thread.reply : "";

  const displayLabel = subject || thread.agentName || HELPER_WORD;

  if (!collapsible) {
    return (
      <div className={className}>
        <SubagentThreadContent threadItems={threadItems} input={thread.input} error={error} />
      </div>
    );
  }

  return (
    <CollapsibleCard
      thread={thread}
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
// The helper's step (default mode)
// ---------------------------------------------------------------------------

interface CollapsibleCardProps {
  readonly thread: Thread;
  readonly displayLabel: string;
  readonly startedAt: string;
  readonly duration: string | null;
  readonly threadItems: readonly SubagentThreadItem[];
  readonly error: string;
  readonly className?: string;
}

function CollapsibleCard({
  thread,
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
  // step opens while one waits and its inline decision (rendered by the
  // nested ToolCallItem) is visible without a click.
  const waitsInside = useMemo(() => threadWaits(thread), [thread]);

  // Open while running or while a nested call waits; settle closed when done
  // — unless the user takes manual control.
  const [expanded, handleToggle] = useAutoDisclosure(isRunning || waitsInside);

  const tag = helperTagWord(thread.agentName, displayLabel);
  const gesture = {
    kind: "expand",
    expanded,
    onToggle: handleToggle,
    label: tag === null ? displayLabel : `${displayLabel}, ${tag}`,
  } as const;

  // The group's name keeps the state a sighted person reads from the spinner
  // or the pill, so a screen reader hears it too.
  return (
    <div role="group" aria-label={`Subagent: ${displayLabel}, ${STATE_WORDS[thread.state]}`} className={className}>
      <ThreadCardShell cursorTarget="subagent-row">
        <ThreadCardHeader gesture={gesture}>
          <span className="stg:shrink-0 stg:text-muted-foreground" aria-hidden="true">
            <HelperGlyph />
          </span>
          <span className="stg:flex stg:min-w-0 stg:flex-1 stg:items-center stg:gap-2 stg:overflow-hidden">
            {/* While it works the line carries the step rows' liveness sweep;
                the shimmer class owns `color`, so it replaces the static one. */}
            <span className={cn("stg:min-w-0 stg:truncate", isRunning ? "stgm-shimmer-label" : "stg:text-foreground")}>
              {displayLabel}
            </span>
            {tag !== null && <Tag>{tag}</Tag>}
          </span>
          <HelperEndingBadge state={thread.state} />
          {isRunning && (
            <span className="stg:shrink-0 stg:text-foreground" aria-hidden="true">
              <SpinnerIcon />
            </span>
          )}
          {isRunning ? (
            <RunningDuration startedAt={startedAt} />
          ) : (
            duration && <span className={TIME_CLASSES}>{duration}</span>
          )}
        </ThreadCardHeader>
        {expanded && (
          <ThreadCardBody cursorTarget="subagent-body">
            <SubagentThreadContent threadItems={threadItems} input={thread.input} error={error} />
          </ThreadCardBody>
        )}
      </ThreadCardShell>
    </div>
  );
}

/** A step's time on the right: 12/16 meta, its digits aligned. */
const TIME_CLASSES = "stg:shrink-0 stg:text-xs stg:tabular-nums stg:text-muted-foreground";

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
  // Under a second says nothing yet.
  if (elapsed === null || elapsed < 1000) return null;

  return <span className={TIME_CLASSES}>{formatElapsed(elapsed)}</span>;
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

/**
 * Its messages sit at the body's padding, not the thread's: the thread's
 * `px-4` gutter is for a top-level message, and inside a step the body is
 * the inset.
 */
const MESSAGE_AT_BODY_PADDING = "stg:px-0";

function SubagentThreadContent({
  threadItems,
  input,
  error,
}: SubagentThreadContentProps) {
  return (
    <div className="stg:flex stg:flex-col stg:gap-2">
      {/* What it was asked, as one quiet line: the step's own line already
          says what it works on. */}
      {input && <p className="stg:truncate stg:text-xs stg:text-muted-foreground">{input}</p>}

      {threadItems.map((item) => {
        switch (item.kind) {
          case "message":
            return <MessageEntry key={item.key} message={item.message} className={MESSAGE_AT_BODY_PADDING} />;
          case "tool-group":
            // Its steps are step rows, as the plan's are: no card inside the card.
            return <ToolCallGroup key={item.key} toolUses={item.toolUses} framed={false} />;
        }
      })}

      {error && (
        <div className="stg:rounded-md stg:bg-destructive-subtle stg:px-3 stg:py-2 stg:text-xs stg:text-destructive">
          {error}
        </div>
      )}
    </div>
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
// Subagent state words
// ---------------------------------------------------------------------------

/** A subagent's state in words, for the group's accessible name. */
const STATE_WORDS: Record<Thread["state"], string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  // Its turn ended before the subagent finished.
  stopped: "Stopped",
};
