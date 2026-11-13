"use client";

// One strip above the composer. Every line that can sit between the thread
// and the reply box (reconnecting, a slow turn, files changing, auto-approve,
// a newer agent version, a read-only reader) draws here, so the stack reads
// as one family: one line at 14/20 under a hairline, a 16px glyph, the
// words, and at most one quiet act. A strip that opens (the files changing)
// is a disclosure: its line is the button, and what it holds draws under it.
// Internal: the session viewer's own strips use it; no host imports it.

import { useId, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";
import { UNSTYLED_BUTTON } from "../internal/form-primitives.js";

/** Props for {@link ComposerStrip}. */
export interface ComposerStripProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** The glyph at the left, 16px wide: a spinner, a clock, a shield, an info mark. */
  readonly icon: ReactNode;
  /** The words. */
  readonly children: ReactNode;
  /** At most one act at the right (an `xs` ghost Button). */
  readonly act?: ReactNode;
  /** `working` for a strip about something in motion (the words in the foreground); `plain` otherwise. @default "plain" */
  readonly tone?: "plain" | "working";
  /** A strip that opens: whether it is open, and the toggle. */
  readonly expanded?: boolean;
  readonly onToggle?: () => void;
  /** What an open strip shows under its line. */
  readonly below?: ReactNode;
}

/** One strip above the composer (module header). */
export function ComposerStrip({ icon, children, act, tone = "plain", expanded = false, onToggle, below, className, ...rest }: ComposerStripProps) {
  const belowId = useId();
  const line = (
    <>
      <span aria-hidden="true" className="stg:flex stg:w-4 stg:shrink-0 stg:items-center stg:justify-center">
        {icon}
      </span>
      <span className={cn("stg:min-w-0 stg:flex-1 stg:text-left", tone === "working" ? "stg:text-foreground" : "stg:text-muted-foreground")}>{children}</span>
    </>
  );
  return (
    <div {...rest} className={cn("stg:border-t stg:border-border-muted stg:px-4", className)}>
      <div className="stg:flex stg:min-h-11 stg:items-center stg:gap-2 stg:py-2 stg:text-sm">
        {onToggle === undefined ? (
          line
        ) : (
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={belowId}
            className={cn(UNSTYLED_BUTTON, "stg:flex stg:min-w-0 stg:flex-1 stg:items-center stg:gap-2 stg:rounded-md stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring")}
          >
            {line}
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className={cn("stg:shrink-0 stg:text-muted-foreground stg:transition-transform stg:motion-reduce:transition-none", expanded && "stg:rotate-90")}
            >
              <path d="m9 6 6 6-6 6" />
            </svg>
          </button>
        )}
        {act}
      </div>
      {onToggle !== undefined && (
        <div id={belowId} hidden={!expanded} className="stg:pb-3 stg:pl-6">
          {expanded && below}
        </div>
      )}
    </div>
  );
}
