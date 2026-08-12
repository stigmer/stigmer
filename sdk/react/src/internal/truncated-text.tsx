"use client";

import * as React from "react";
import { cn } from "@stigmer/theme";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip.js";

// ---------------------------------------------------------------------------
// SDK-internal truncated-text span with an overflow-gated house tooltip.
//
// Replaces the `title={fullValue}` idiom on truncated cells (paths, hashes,
// model ids, …) after the native-title sweep (stigmer/stigmer-cloud#268).
// Native titles were OS-delayed and fired whether or not the text was
// actually clipped; this helper opens the house tooltip ONLY when the text
// truly overflows its box, checked at open time — a non-truncated cell
// stays tooltip-free.
//
// The trigger is a plain, non-focusable span (the StatusHint precedent in
// ConversationTimelineView): CSS truncation is purely visual, so the full
// text is already in the DOM for screen readers and selection — the tooltip
// is a sighted-pointer convenience, and a tab stop per table cell would be
// noise. Works with or without a `TooltipProvider` in scope (the provider
// only adds delay grouping); like ./tooltip.tsx, NOT exported from
// @stigmer/react.
// ---------------------------------------------------------------------------

interface TruncatedTextProps {
  /** The full value: rendered inside the span and shown by the tooltip. */
  readonly text: string;
  /**
   * Classes for the truncating span. `stg:truncate` is applied by default;
   * pass a `stg:line-clamp-*` class instead for multi-line clamping (the
   * overflow check covers both axes).
   */
  readonly className?: string;
  /** Tooltip placement; truncated cells read best with the default "top". */
  readonly side?: React.ComponentProps<typeof TooltipContent>["side"];
}

/** True when CSS actually clipped the element on either axis. */
function isOverflowing(el: HTMLElement): boolean {
  return el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;
}

export function TruncatedText({ text, className, side = "top" }: TruncatedTextProps) {
  const spanRef = React.useRef<HTMLSpanElement>(null);
  const [open, setOpen] = React.useState(false);

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    if (nextOpen && spanRef.current && !isOverflowing(spanRef.current)) {
      return; // Nothing is clipped — the tooltip would only repeat the cell.
    }
    setOpen(nextOpen);
  }, []);

  return (
    <Tooltip open={open} onOpenChange={handleOpenChange}>
      <TooltipTrigger
        render={
          <span
            ref={spanRef}
            className={cn(
              // A plain inline span can neither truncate (overflow does not
              // apply to inline boxes) nor be measured (clientWidth is 0 by
              // spec), so the span defaults to block; cn()'s conflict
              // resolution lets callers override with their own display
              // class (inline-block, flex-1 cells, …).
              "stg:block",
              className?.match(/(?:^|\s)stg:line-clamp-/) ? undefined : "stg:truncate",
              className,
            )}
          />
        }
      >
        {text}
      </TooltipTrigger>
      <TooltipContent side={side} className="stg:break-all">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
