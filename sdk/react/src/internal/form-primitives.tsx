"use client";

import { cn } from "@stigmer/theme";

// ---------------------------------------------------------------------------
// Shared form primitives for the operator consoles (pricing-governance
// editors and search inputs, cursor-accounts editor and key forms).
// Internal — never exported from the package barrel.
// ---------------------------------------------------------------------------

/**
 * Neutralizes the UA's default `<button>` styling (buttonface background,
 * padding, default cursor). The SDK's scoped preflight in `styles.css`
 * resets only borders/box-sizing; in the console and desktop app the host's
 * global Tailwind preflight covers the rest, but a preflight-less host
 * (docs tours, third-party embeds) would otherwise render every bare button
 * as a gray UA box. Font is NOT reset here — callers that render text set
 * `[font:inherit]` or explicit text utilities themselves.
 *
 * Applies to buttons that are styled entirely by their content (chips,
 * icon-only affordances), not to the themed button components.
 */
export const UNSTYLED_BUTTON = "cursor-pointer bg-transparent p-0";

/** Standard text-input styling for the operator consoles. */
export const INPUT_CLASSES = cn(
  "w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs text-foreground",
  "placeholder:text-muted-foreground",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
  "disabled:pointer-events-none disabled:opacity-50",
);

/** Labelled form field wrapper. */
export function Field({
  label,
  required,
  className,
  children,
}: {
  readonly label: string;
  readonly required?: boolean;
  readonly className?: string;
  readonly children: React.ReactNode;
}) {
  return (
    <label className={cn("block space-y-1", className)}>
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}
