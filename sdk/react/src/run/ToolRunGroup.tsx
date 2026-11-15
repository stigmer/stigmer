"use client";

import { memo, useMemo } from "react";
import type { ToolUse } from "@stigmer/client";
import { useRenderTracer } from "../internal/dev/index.js";
import { useAutoDisclosure } from "../internal/useAutoDisclosure.js";
import { ToolCallItem } from "./ToolCallItem.js";
import type { ToolCategory } from "@stigmer/react-core";
import { DoneTick, FailedGlyph, SpinnerIcon, ThreadCardStep } from "../internal/thread-card/index.js";
import { StepPlaceContext, useStepPlace } from "./step-place.js";

/** Props for {@link ToolRunGroup}. */
export interface ToolRunGroupProps {
  /** Shared category of every call in the run (e.g. `"read"`). */
  readonly category: ToolCategory;
  /** The consecutive same-category tool uses folded into this chip (length >= 2). */
  readonly toolUses: readonly ToolUse[];
  /**
   * Custom label formatter for the collapsed chip. When omitted, a
   * category-aware default is used ("Read 5 files"). Receives the run's tool
   * uses so a platform builder can phrase the summary however they like.
   */
  readonly formatLabel?: (toolUses: readonly ToolUse[]) => string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The thread's *only* collapse: a run of consecutive low-signal same-category
 * calls (read / list / search) folded into one step — the noise-reduction
 * half of the persistent-row timeline. Collapsed, it reads as one step ("Read
 * 5 files") with a step's mark (the tick once every call is done); opened, it
 * shows the individual {@link ToolCallItem} rows on a rail under its words.
 *
 * Unlike the old per-turn group, this folds *only* genuine repetition, and it
 * auto-opens (and stays open) while a folded call runs or waits for a person —
 * a gate raised inside a run must never be buried. It otherwise settles closed
 * when the run finishes, unless the user has taken manual control (see
 * {@link useAutoDisclosure}).
 *
 * `React.memo` with a by-reference comparator: the session fold keeps each
 * unchanged `ToolUse` stable, so a settled chip skips re-renders while
 * siblings stream.
 *
 * @example
 * ```tsx
 * <ToolRunGroup category="read" toolUses={reads} />
 * ```
 */
export const ToolRunGroup = memo(function ToolRunGroup({
  category,
  toolUses,
  formatLabel,
  className,
}: ToolRunGroupProps) {
  useRenderTracer("ToolRunGroup", { category, count: toolUses.length });

  const status = deriveAggregateStatus(toolUses);
  const isRunning = status === "running";
  // Reads are not asked about by default, but a hook can ask about any
  // call: a waiting one inside the fold keeps it open, mirroring
  // SubagentSection.
  const [expanded, handleToggle] = useAutoDisclosure(isRunning || status === "waiting");
  const outer = useStepPlace();
  const rail = useMemo(() => ({ rows: "rail", inHelper: outer.inHelper }) as const, [outer.inHelper]);

  const label = formatLabel ? formatLabel(toolUses) : defaultRunLabel(category, toolUses.length);

  return (
    <div role="group" aria-label={label} data-cursor-target="tool-run-group" className={className}>
      <ThreadCardStep
        gesture={{ kind: "expand", expanded, onToggle: handleToggle, label }}
        place={outer.rows === "rail" ? "rail" : "card"}
        mark={<RunMark status={status} />}
        titleClassName={isRunning || status === "failed" ? "stg:font-medium" : undefined}
        title={
          // A running fold reads bright, as a step at work does; done, it
          // goes quiet.
          <span className={isRunning || status === "failed" ? "stg:text-foreground" : "stg:text-muted-foreground"}>
            {label}
          </span>
        }
        // At work in a card of steps it sits on the running band; on a rail
        // the band is the to-do's or the helper's.
        band={isRunning && outer.rows !== "rail"}
        bodySpan="rail"
        body={
          expanded ? (
            // Its calls hang on a rail under its words, undivided, as a
            // to-do's steps do.
            <StepPlaceContext.Provider value={rail}>
              <div className="stg:border-l-2 stg:border-border stg:pl-3">
                {toolUses.map((tu) => (
                  <ToolCallItem key={tu.id} toolUse={tu} bordered={false} />
                ))}
              </div>
            </StepPlaceContext.Provider>
          ) : undefined
        }
      />
    </div>
  );
}, toolRunGroupPropsEqual);

/**
 * Shallow comparison for {@link ToolRunGroupProps}. The session fold keeps the
 * folded `ToolUse` objects stable, so we compare the array element-wise by
 * reference rather than by identity of the (freshly sliced) array.
 *
 * @internal Exported for testing — not part of the public API.
 */
export function toolRunGroupPropsEqual(
  prev: Readonly<ToolRunGroupProps>,
  next: Readonly<ToolRunGroupProps>,
): boolean {
  if (prev.category !== next.category) return false;
  if (prev.toolUses.length !== next.toolUses.length) return false;
  for (let i = 0; i < prev.toolUses.length; i++) {
    if (prev.toolUses[i] !== next.toolUses[i]) return false;
  }
  return prev.formatLabel === next.formatLabel && prev.className === next.className;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/** Category-aware default label for a folded run (count is always >= 2). */
function defaultRunLabel(category: ToolCategory, count: number): string {
  switch (category) {
    case "read":
      return `Read ${count} files`;
    case "list":
      return `Listed ${count} directories`;
    case "search":
      return `Searched ${count} times`;
    default:
      return `${count} calls`;
  }
}

// ---------------------------------------------------------------------------
// Aggregate status
// ---------------------------------------------------------------------------

type AggregateStatus = "running" | "waiting" | "failed" | "completed";

/**
 * Collapses a run's per-call states into a single chip status: running
 * wins, then waiting, then failed. Every other state is settled — a call its
 * turn stopped (issue #207) or a denied one included — so the chip never
 * pins to a pending state.
 */
function deriveAggregateStatus(toolUses: readonly ToolUse[]): AggregateStatus {
  if (toolUses.some((tu) => tu.state === "running")) return "running";
  if (toolUses.some((tu) => tu.state === "waiting")) return "waiting";
  if (toolUses.some((tu) => tu.state === "failed")) return "failed";
  return "completed";
}

/** The fold's mark, as a step's: the tick once all are done, the spinner while one works or waits, a red (!) when one failed. */
function RunMark({ status }: { readonly status: AggregateStatus }) {
  if (status === "completed") return <DoneTick />;
  if (status === "failed") {
    return (
      <span className="stg:flex stg:text-status-failed" aria-hidden="true">
        <FailedGlyph />
      </span>
    );
  }
  return (
    <span className="stg:flex stg:text-status-running" aria-hidden="true">
      <SpinnerIcon size={12} />
    </span>
  );
}
