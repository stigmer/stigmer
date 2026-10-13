"use client";

import { memo } from "react";
import type { ToolUse } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import { useRenderTracer } from "../internal/dev/index.js";
import { useAutoDisclosure } from "../internal/useAutoDisclosure.js";
import { ToolCallItem, CATEGORY_ICON } from "./ToolCallItem.js";
import type { ToolCategory } from "./tool-categories.js";
import { SpinnerIcon } from "../internal/thread-card/glyphs.js";

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
 * calls (read / list / search) folded into one chip — the noise-reduction half
 * of the persistent-row timeline. Collapsed, it reads as one line ("Read 5
 * files"); expanded, it reveals the individual {@link ToolCallItem} rows.
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
  const isShimmering = status === "running";
  // Reads are not asked about by default, but a hook can ask about any
  // call: a waiting one inside the fold keeps the chip open, mirroring
  // SubAgentSection.
  const [expanded, handleToggle] = useAutoDisclosure(
    isShimmering || status === "waiting",
  );

  const label = formatLabel
    ? formatLabel(toolUses)
    : defaultRunLabel(category, toolUses.length);
  const Icon = CATEGORY_ICON[category];
  const StatusIcon = STATUS_ICON[status];

  return (
    <div
      role="group"
      aria-label={label}
      data-cursor-target="tool-run-group"
      className={className}
    >
      {/* Quiet chrome (stigmer#274): the folded run is metadata-only by
          construction (its categories are the quiet set), so the chip renders
          as an unboxed line — same tier as the lone read/list/search rows it
          folds — never a bordered card shouting over the conversation. */}
      <button
        type="button"
        aria-expanded={expanded}
        onClick={handleToggle}
        className={cn(
          "stg:flex stg:w-full stg:cursor-pointer stg:items-center stg:gap-2 stg:px-2.5 stg:py-1.5 stg:text-left stg:text-xs stg:text-muted-foreground stg:transition-colors",
          "stg:hover:bg-muted-subtle",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
        )}
      >
        <span className="stg:shrink-0 stg:text-muted-foreground" aria-hidden="true">
          <Icon />
        </span>
        {/* A running fold carries the ambient-liveness sweep on its label
            (stigmer#277); the shimmer class owns `color`, so it replaces the
            static color utility rather than fighting it. */}
        <span
          className={cn(
            "stg:min-w-0 stg:flex-1 stg:truncate stg:font-medium",
            isShimmering ? "stgm-shimmer-label" : "stg:text-foreground",
          )}
        >
          {label}
        </span>
        {StatusIcon && (
          <span className={cn("stg:shrink-0", STATUS_COLOR[status])} aria-hidden="true">
            <StatusIcon />
          </span>
        )}
        <ChevronIcon expanded={expanded} />
      </button>

      {expanded && (
        // With no card frame, the disclosed rows sit under a light left rail
        // (the quiet-tier body containment, mirroring ThreadCardBody's rail)
        // as divider-separated rows — their container owns the frame.
        <div className="stg:ml-1.5 stg:border-l-2 stg:border-border-muted stg:pl-2">
          {toolUses.map((tu) => (
            <ToolCallItem key={tu.id} toolUse={tu} bordered={false} />
          ))}
        </div>
      )}
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

const STATUS_COLOR: Record<AggregateStatus, string> = {
  running: "stg:text-foreground",
  waiting: "stg:text-warning",
  failed: "stg:text-destructive",
  completed: "stg:text-success",
};

// `completed` is deliberately iconless — success is the silent default,
// matching the tool rows' own status vocabulary (stigmer#274).
const STATUS_ICON: Record<AggregateStatus, (() => React.JSX.Element) | null> = {
  running: SpinnerIcon,
  waiting: ClockIcon,
  failed: XCircleIcon,
  completed: null,
};

// ---------------------------------------------------------------------------
// Inline SVG icons — kept inline for SDK independence (codebase pattern)
// ---------------------------------------------------------------------------

function ClockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="4.5" />
      <path d="M6 3.5V6L7.5 7.5" />
    </svg>
  );
}

function XCircleIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="4.5" />
      <path d="M4.5 4.5L7.5 7.5M7.5 4.5L4.5 7.5" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
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
      <path d="M3.5 2L6.5 5L3.5 8" />
    </svg>
  );
}
