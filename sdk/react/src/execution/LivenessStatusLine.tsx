"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";

/** Props for {@link LivenessStatusLine}. */
export interface LivenessStatusLineProps {
  /**
   * The status copy. Defaults to `"Working…"` — deliberately generic: the
   * thread has no model-authored account of what the agent is doing between
   * visible events (that seam is stigmer#276), so the line claims only what
   * is provably true.
   */
  readonly label?: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The thread's ambient-liveness anchor (stigmer#277): a quiet one-line status
 * at the bottom of the thread while an execution is live but nothing else on
 * screen is visibly moving — the exact stretches (model generation between
 * tool calls) where users conclude the agent died and reach for a restart.
 *
 * The label carries the shared `stgm-shimmer-label` sweep, the same treatment
 * as a running tool row's title and the thinking indicator, so "alive" reads
 * identically everywhere. {@link MessageThread} emits it only while the
 * active execution is `IN_PROGRESS` with no running tool call, no live
 * sub-agent, and no pending approval — when a gate is waiting on the *user*,
 * shimmering "Working…" would be a lie, and when a tool is running, its own
 * row carries the sweep. It disappears the moment the execution settles
 * (phase-driven, DD-009 — never inferred from the stream going quiet).
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
  className,
}: LivenessStatusLineProps) {
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
