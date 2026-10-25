"use client";

import { memo } from "react";
import { backgroundCommandText, type ToolUse } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import { DecisionButton } from "../internal/DecisionButton.js";
import { formatElapsed, useElapsedSince } from "../internal/useElapsedSince.js";
import { useBackgroundStop } from "./BackgroundCommandContext.js";

/** Props for {@link LivenessStatusLine}. */
export interface LivenessStatusLineProps {
  /**
   * The status copy. Defaults to `"Working…"` — deliberately generic: the
   * thread has no model-authored account of what the agent is doing between
   * visible events (that seam is stigmer#276), so the line claims only what
   * is provably true.
   */
  readonly label?: string;
  /**
   * The background commands the turn waits on, oldest first, when the agent
   * has ended its reply and the turn is held only for them; the line then
   * says so ("Waiting for `npm test` · 2m", "and 1 more") in place of
   * {@link label}, with Stop when there is one.
   */
  readonly waitingOn?: ReadonlyArray<ToolUse>;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/** What the line says while the turn waits on background commands: the oldest by its command, and how many more. */
export function backgroundWaitLabel(waitingOn: ReadonlyArray<ToolUse>, elapsedMs: number | null): string {
  const [oldest, ...others] = waitingOn;
  const command = oldest === undefined ? "" : backgroundCommandText(oldest);
  const what = command === "" ? "a background command" : `\`${command}\``;
  const more = others.length > 0 ? ` and ${others.length} more` : "";
  const since = elapsedMs !== null && elapsedMs >= 1000 ? ` · ${formatElapsed(elapsedMs)}` : "";
  return `Waiting for ${what}${more}${since}`;
}

/**
 * The thread's ambient-liveness anchor (stigmer#277): a quiet one-line status
 * at the bottom of the thread while a run is live but nothing else on
 * screen is visibly moving — the exact stretches (model generation between
 * tool calls) where users conclude the agent died and reach for a restart.
 *
 * The label carries the shared `stgm-shimmer-label` sweep, the same treatment
 * as a running tool row's title and the thinking indicator, so "alive" reads
 * identically everywhere. {@link MessageThread} emits it only while the
 * active run is `IN_PROGRESS` with no running tool call, no live
 * subagent, and no pending approval — when a gate is waiting on the *user*,
 * shimmering "Working…" would be a lie, and when a tool is running, its own
 * row carries the sweep. It disappears the moment the run settles
 * (phase-driven — never inferred from the stream going quiet).
 *
 * When the agent has ended its reply and the turn is held only for
 * commands it runs in the background ({@link LivenessStatusLineProps.waitingOn}),
 * the line says what it waits for, and offers Stop for a lone command: that
 * is when the turn is held for the person, and when a command's row may be
 * scrolled far away.
 *
 * Replaceable via {@link MessageThreadSlots.LivenessStatusLine} (the
 * SetupProgress precedent) for hosts that want their own liveness voice.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * <LivenessStatusLine />
 * <LivenessStatusLine label="Reviewing your data…" />
 * ```
 */
export const LivenessStatusLine = memo(function LivenessStatusLine({
  label = "Working\u2026",
  waitingOn,
  className,
}: LivenessStatusLineProps) {
  if (waitingOn !== undefined && waitingOn.length > 0) {
    return <BackgroundWaitLine waitingOn={waitingOn} className={className} />;
  }
  return (
    <div
      role="status"
      aria-label={label}
      data-cursor-target="liveness-status-line"
      className={cn("stg:flex stg:items-center stg:px-4 stg:py-1.5", className)}
    >
      <span className="stg:text-xs stgm-shimmer-label">{label}</span>
    </div>
  );
});

/** The line while the turn waits on background commands (see {@link LivenessStatusLine}). */
function BackgroundWaitLine({
  waitingOn,
  className,
}: {
  readonly waitingOn: ReadonlyArray<ToolUse>;
  readonly className?: string;
}) {
  const oldest = waitingOn[0]!;
  const elapsed = useElapsedSince(oldest.background?.startedAt ?? "");
  const stop = useBackgroundStop(oldest);
  const label = backgroundWaitLabel(waitingOn, elapsed);
  return (
    <div
      role="status"
      aria-label={label}
      data-cursor-target="liveness-status-line"
      className={cn("stg:flex stg:items-center stg:gap-2 stg:px-4 stg:py-1.5", className)}
    >
      <span className="stg:min-w-0 stg:truncate stg:text-xs stgm-shimmer-label">{label}</span>
      {waitingOn.length === 1 && stop && (
        <DecisionButton
          label={stop.isStopping ? "Stopping\u2026" : "Stop"}
          variant="danger"
          onClick={stop.onStop}
          isSubmitting={stop.isStopping}
          isActive={stop.isStopping}
          className="stg:px-2 stg:py-0.5"
          cursorTarget="background-wait-stop"
        />
      )}
    </div>
  );
}
