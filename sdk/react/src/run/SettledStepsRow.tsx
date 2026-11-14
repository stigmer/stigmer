"use client";

// A stretch of settled steps as one line ("Read 1 file, edited invoice.ts,
// wrote 2 files · 56s") that opens to the steps it folds, for every reader:
// the thread folds a working turn's settled stretch this way, and a finished
// turn's whole working under "How it got there", so the answer leads and the
// working is one click away. The thread folded whole turns once and stopped,
// because that hid shell output and screenshots (70cc36e729): a stretch
// folds only once every call in it has returned, a turn that stopped or
// failed keeps its steps in view, and one click shows them all.

import { useId, useState, type ReactNode } from "react";
import { settledStepsPhrase, stepsSpanMs, type ToolUse } from "@stigmer/client";
import { cn } from "@stigmer/design-tokens";
import { formatElapsed } from "@stigmer/client";

/** Props for {@link SettledStepsRow}. */
export interface SettledStepsRowProps {
  /** The settled calls, in order: the line counts them and spans their time. */
  readonly toolUses: readonly ToolUse[];
  /**
   * What the line says before the calls' own words ("How it got there"); the
   * calls' words alone when omitted. With a prefix, the line shows even when
   * the calls have nothing to count.
   */
  readonly prefix?: string;
  /** The steps the line folds. */
  readonly children: ReactNode;
  /**
   * Whether the line draws its own card. Defaults to `true`; `false` inside
   * a container that already frames it (a plan's foot), where it is a
   * divider row.
   */
  readonly framed?: boolean;
  readonly className?: string;
}

/** One line for a settled stretch of steps (module header). */
export function SettledStepsRow({ toolUses, prefix, children, framed = true, className }: SettledStepsRowProps) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const words = settledStepsPhrase(toolUses);
  const label = prefix === undefined ? words : words === "" ? prefix : `${prefix}: ${words.charAt(0).toLowerCase()}${words.slice(1)}`;
  if (label === "") return <div className={className}>{children}</div>;
  const span = stepsSpanMs(toolUses);
  const header = open && prefix !== undefined;
  return (
    <div
      className={cn(
        framed ? "stg:overflow-hidden stg:rounded-lg stg:border stg:border-border stg:bg-card" : "stg:border-t stg:border-border-muted",
        className,
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((was) => !was)}
        className="stg:flex stg:w-full stg:items-center stg:gap-2 stg:px-3 stg:py-2 stg:text-left stg:text-sm stg:text-muted-foreground stg:hover:bg-muted-subtle stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className={cn("stg:h-3 stg:w-3 stg:shrink-0 stg:transition-transform", open && "stg:rotate-90")}>
          <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {/* Closed, the line says what the steps did; opened, it is the card's
            header: its name, and how many steps over how long, the steps
            themselves below it. */}
        <span className={cn("stg:min-w-0 stg:flex-1 stg:truncate", header && "stg:text-xs stg:font-medium")}>{header ? prefix : label}</span>
        <span className={cn("stg:shrink-0 stg:text-xs stg:tabular-nums", header && "stg:font-medium")}>
          {[header ? `${toolUses.length} ${toolUses.length === 1 ? "step" : "steps"}` : "", span >= 1000 ? formatElapsed(span) : ""].filter((part) => part !== "").join(" · ")}
        </span>
      </button>
      {open && (
        <div id={regionId} className="stg:border-t stg:border-border-muted">
          {children}
        </div>
      )}
    </div>
  );
}
