"use client";

// A stretch of settled tool calls as one row ("Read 1 file, edited
// invoice.ts, wrote 2 files · 56 s") that opens to the rows it folds. For
// the people who want the result rather than the working (an embedding
// product's end user, a chat link's guest, a reviewer); a builder keeps
// every row. The thread folded whole turns once and stopped, because that
// hid shell output and screenshots (70cc36e729): this fold is per stretch,
// only once every call in it has returned, and one click shows them all.

import { useId, useState, type ReactNode } from "react";
import { settledStepsPhrase, stepsSpanMs, type ToolUse } from "@stigmer/client";
import { durationWords } from "../session/duration-words.js";

/** Props for {@link SettledStepsRow}. */
export interface SettledStepsRowProps {
  /** The settled calls, in order. */
  readonly toolUses: readonly ToolUse[];
  /** The rows the step row folds. */
  readonly children: ReactNode;
}

/** One row for a settled stretch of calls (module header). */
export function SettledStepsRow({ toolUses, children }: SettledStepsRowProps) {
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const words = settledStepsPhrase(toolUses);
  if (words === "") return <div className="stg:mx-4">{children}</div>;
  return (
    <div className="stg:mx-4">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen((was) => !was)}
        className="stg:flex stg:w-full stg:items-center stg:gap-2 stg:rounded-md stg:px-2 stg:py-1.5 stg:text-left stg:text-sm stg:text-muted-foreground stg:hover:bg-muted"
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className={open ? "stg:h-3 stg:w-3 stg:rotate-90" : "stg:h-3 stg:w-3"}>
          <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="stg:min-w-0 stg:flex-1 stg:truncate">{words}</span>
        <span className="stg:shrink-0 stg:text-xs">{durationWords(stepsSpanMs(toolUses))}</span>
      </button>
      {open && (
        <div id={regionId} className="stg:mt-1">
          {children}
        </div>
      )}
    </div>
  );
}
