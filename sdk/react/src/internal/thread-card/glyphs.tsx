import { cn } from "@stigmer/theme";

/**
 * The shared glyph vocabulary for thread cards (session tool-call rows and
 * workflow task cards). One set of status/affordance icons so the two
 * threads cannot drift apart visually — extracted from `ToolCallItem`,
 * which previously owned them and which the workflow card had copied.
 *
 * All glyphs inherit `currentColor`; the consumer colors them with status
 * token classes (`text-success`, `text-warning`, …) — never hardcoded
 * values (Dont-Do #3).
 *
 * @internal Not part of the public API.
 */

/**
 * Quarter-arc spinner for an in-flight item. Deliberately finer than the
 * SDK-wide `internal/SpinnerIcon` (1.5 stroke on a 12 grid vs 2 on 16) —
 * the micro-row weight this vocabulary is built around. Card-adjacent
 * surfaces that used to carry their own copies (tool-run groups, file
 * review, decision buttons) size it up via `size` instead.
 */
export function SpinnerIcon({
  size = 10,
  className,
}: {
  readonly size?: number;
  readonly className?: string;
} = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={cn("stg:animate-spin", className)}
      aria-hidden="true"
    >
      <path d="M6 1.5A4.5 4.5 0 1 1 1.5 6" strokeLinecap="round" />
    </svg>
  );
}

/** Clock for an item waiting on a human decision. */
export function ClockIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="4.5" />
      <path d="M6 3.5V6L7.5 7.5" />
    </svg>
  );
}

/** Check circle for a completed item. */
export function CheckCircleIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="4.5" />
      <path d="M4 6L5.5 7.5L8 4.5" />
    </svg>
  );
}

/** X circle for a failed item. */
export function XCircleIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="4.5" />
      <path d="M4.5 4.5L7.5 7.5M7.5 4.5L4.5 7.5" />
    </svg>
  );
}

/** Neutral dot for an item that has not started. */
export function DotIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor">
      <circle cx="4" cy="4" r="2.5" />
    </svg>
  );
}

/** Slashed circle for a settled-but-never-ran item (interrupted, skipped). */
export function SlashCircleIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="6" cy="6" r="4.5" />
      <path d="M2.8 9.2L9.2 2.8" />
    </svg>
  );
}

/** Magnifier for the opt-in Inspect drill-down button. */
export function InspectIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="5.5" cy="5.5" r="3.5" />
      <path d="M8 8L10.5 10.5" />
    </svg>
  );
}

/**
 * The expand/collapse chevron: points right when collapsed, rotates to
 * point down when expanded (the session card's canonical direction).
 */
export function ChevronIcon({ expanded }: { readonly expanded: boolean }) {
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
