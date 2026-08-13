import { cn } from "@stigmer/theme";

/**
 * The SDK's canonical in-flight spinner: a three-quarter arc on a 16×16
 * grid, colored by `currentColor` so the consumer's text token drives it
 * (never hardcoded values — Dont-Do #3). Extracted from ~33 identical
 * per-component copies (stigmer-cloud#270); new busy states import this
 * instead of pasting another one.
 *
 * `size` is the rendered box; the glyph scales from the same viewBox, so
 * every size renders the identical shape. Decorative by contract
 * (`aria-hidden`) — pair it with visible or `sr-only` text when the busy
 * state itself must be announced.
 *
 * The thread-card rows deliberately use a finer quarter-arc micro-glyph
 * instead — see `internal/thread-card/glyphs.tsx`.
 *
 * @internal Not part of the public API.
 */
export function SpinnerIcon({
  size = 16,
  className,
}: {
  readonly size?: number;
  readonly className?: string;
} = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={cn("stg:animate-spin", className)}
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
