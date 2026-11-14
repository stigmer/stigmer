"use client";

// A helper's work inside the parent conversation, drawn as one more step: the
// step's layout, the helper's subject as its line, its agent's name as a tag
// with the helper glyph, its time on the right, and its own steps in the
// body, on a rail, as the session page draws it (S43). Its brief and its
// messages are not drawn: its line says what it works on, and its steps
// what it did.

import { memo, useMemo } from "react";
import type { Thread, ToolUse, TurnItem } from "@stigmer/client";
import { useRenderTracer } from "../internal/dev/index.js";
import { useAutoDisclosure } from "../internal/useAutoDisclosure.js";
import { formatElapsed } from "@stigmer/client";
import { useElapsedSince } from "../internal/useElapsedSince.js";
import { cn } from "@stigmer/design-tokens";
import { formatHeaderDuration } from "./ToolCallDetail.js";
import { ToolCallGroup } from "./ToolCallGroup.js";
import { isInternalTool } from "@stigmer/react-core/internal";
import {
  ThreadCardShell,
  ThreadCardStep,
  DoneTick,
  FailedGlyph,
  SlashCircleIcon,
  SpinnerIcon,
  STEP_INSET,
} from "../internal/thread-card/index.js";
import { StepPlaceContext } from "./step-place.js";
import { Tag } from "../internal/surface/Tag.js";
import { HELPER_STATE_WORDS, HELPER_WORD, HelperEndingBadge, HelperGlyph, helperTagWord } from "./helper-step.js";

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
   * the helper's line and toggle (e.g. {@link ToolCallItem}): the flat
   * form is the helper's work alone (its steps on a rail, its error), with
   * no line of its own.
   */
  readonly collapsible?: boolean;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Renders a subagent's work inside the parent conversation as one step, the
 * session page's helper (S43).
 *
 * When `collapsible` is `true` (default), the helper reads as a step on the
 * step's own layout: the running spinner while it works and the tick once
 * done, its subject as the line (its first letter capitalised for display),
 * its agent's name as a tag with the helper glyph ("Helper" when it has
 * none), and its time on the right (ticking while it works). It is open
 * while the helper works or one of its calls waits for a person, and
 * settles closed when it finishes; a click opens it again. Like the step
 * rows, it carries a pill only when it failed or stopped.
 *
 * Opened, it shows the helper's own steps on a rail under its words, each
 * with its folder line and no time of its own; its brief and its messages
 * are not drawn. A failed helper's error sits under its steps.
 *
 * When `collapsible` is `false`, the component renders the helper's work
 * alone, without a line or toggle, for a parent row that already draws
 * both (e.g. {@link ToolCallItem}).
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

  const toolUses = useMemo(() => helperSteps(thread.items), [thread.items]);
  // A failed subagent's reply is its error.
  const error = thread.state === "failed" ? thread.reply : "";

  if (!collapsible) {
    return (
      <div className={className}>
        <HelperBody toolUses={toolUses} error={error} />
      </div>
    );
  }

  return (
    <HelperStep
      thread={thread}
      displayLabel={capitalised(subject) || thread.agentName || HELPER_WORD}
      startedAt={startedAt}
      // Header chip threshold (>= 1s) shared with ToolCallItem — a sub-second
      // subagent is noise by the same rule.
      duration={formatHeaderDuration(startedAt, completedAt)}
      toolUses={toolUses}
      error={error}
      className={className}
    />
  );
});

/** A string with its first letter capitalised, for display; the subject itself stays as written. */
function capitalised(text: string): string {
  return text === "" ? "" : text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// The helper's step (default mode)
// ---------------------------------------------------------------------------

interface HelperStepProps {
  readonly thread: Thread;
  readonly displayLabel: string;
  readonly startedAt: string;
  readonly duration: string | null;
  readonly toolUses: readonly ToolUse[];
  readonly error: string;
  readonly className?: string;
}

function HelperStep({ thread, displayLabel, startedAt, duration, toolUses, error, className }: HelperStepProps) {
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
  const shows = toolUses.length > 0 || error !== "";
  const gesture = shows
    ? ({ kind: "expand", expanded, onToggle: handleToggle, label: tag === null ? displayLabel : `${displayLabel}, ${tag}` } as const)
    : ({ kind: "none" } as const);

  // The group's name keeps the state a sighted person reads from the mark
  // or the pill, so a screen reader hears it too.
  return (
    <div role="group" aria-label={`Subagent: ${displayLabel}, ${HELPER_STATE_WORDS[thread.state]}`} className={className}>
      <ThreadCardShell cursorTarget="subagent-row">
        <ThreadCardStep
          gesture={gesture}
          mark={<HelperMark state={thread.state} />}
          titleClassName={isRunning || thread.state === "failed" ? "stg:font-medium" : undefined}
          title={
            <>
              {/* While it works the line carries the step rows' liveness
                  sweep; the shimmer class owns `color`, so it replaces the
                  static one. Done, its words go quiet. */}
              <span className={cn(isRunning ? "stgm-shimmer-label" : thread.state === "failed" ? "stg:text-foreground" : "stg:text-muted-foreground")}>
                {tag !== null ? `${displayLabel} ` : displayLabel}
              </span>
              {tag !== null && (
                <Tag>
                  <HelperGlyph />
                  {tag}
                </Tag>
              )}
            </>
          }
          trail={
            <>
              <HelperEndingBadge state={thread.state} />
              {isRunning ? <RunningDuration startedAt={startedAt} /> : duration && <span className={TIME_CLASSES}>{duration}</span>}
            </>
          }
          bodySpan="rail"
          bodyCursorTarget="subagent-body"
          body={expanded && shows ? <HelperBody toolUses={toolUses} error={error} /> : undefined}
        />
      </ThreadCardShell>
    </div>
  );
}

/**
 * A helper's mark, as a step's: the running spinner while it works, the tick
 * once it finished, a red (!) when it failed and a slash when its turn
 * stopped it (the pill beside its time says which).
 */
export function HelperMark({ state }: { readonly state: Thread["state"] }) {
  switch (state) {
    case "completed":
      return <DoneTick />;
    case "running":
      return (
        <span className="stg:flex stg:text-status-running" aria-hidden="true">
          <SpinnerIcon size={12} />
        </span>
      );
    case "failed":
      return (
        <span className="stg:flex stg:text-status-failed" aria-hidden="true">
          <FailedGlyph />
        </span>
      );
    case "stopped":
      return (
        <span className="stg:flex stg:text-muted-foreground" aria-hidden="true">
          <SlashCircleIcon />
        </span>
      );
  }
}

/** A step's time on the right: 12/16 meta, its digits aligned. */
const TIME_CLASSES = "stg:shrink-0 stg:text-xs stg:tabular-nums stg:text-muted-foreground";

/**
 * Ticking elapsed time for a running subagent's line, where the static
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
// The helper's body
// ---------------------------------------------------------------------------

/** Inside a helper: its steps hang on a rail and leave their time to the helper's line. */
const IN_A_HELPER = { rows: "rail", inHelper: true } as const;

/**
 * A helper's own steps, on a rail under its words, undivided, each with its
 * folder line and no time of its own; a failed helper's error under them in
 * the step's one box.
 */
function HelperBody({ toolUses, error }: { readonly toolUses: readonly ToolUse[]; readonly error: string }) {
  return (
    <div className="stg:flex stg:flex-col stg:gap-2">
      {toolUses.length > 0 && (
        <StepPlaceContext.Provider value={IN_A_HELPER}>
          <div className="stg:border-l-2 stg:border-border stg:pl-3">
            <ToolCallGroup toolUses={toolUses} framed={false} divided={false} />
          </div>
        </StepPlaceContext.Provider>
      )}
      {error && <pre className={cn(STEP_INSET, "stg:whitespace-pre-wrap stg:break-words")}>{error}</pre>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The helper's steps
// ---------------------------------------------------------------------------

/**
 * A helper's own steps, in the order it took them: its tool uses, internal
 * to-do calls left out. Its messages, thinking and notes are not drawn (its
 * line says what it works on; its steps what it did).
 */
function helperSteps(items: ReadonlyArray<TurnItem>): ToolUse[] {
  return items.filter((item): item is ToolUse => item.kind === "tool_use" && !isInternalTool(item.name));
}

/** Whether any call of a thread (or of a subagent it started) waits for a person. */
function threadWaits(thread: Thread): boolean {
  return thread.items.some(
    (item) =>
      item.kind === "tool_use" &&
      (item.state === "waiting" || (item.thread !== undefined && threadWaits(item.thread))),
  );
}
