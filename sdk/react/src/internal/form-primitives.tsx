"use client";

import { cn } from "@stigmer/theme";

// ---------------------------------------------------------------------------
// Shared form primitives for the operator consoles (pricing-governance
// editors and search inputs, cursor-accounts editor and key forms).
// Internal — never exported from the package barrel.
// ---------------------------------------------------------------------------

/**
 * Pointer cursor for buttons that are styled entirely by their content
 * (chips, image tiles, icon-only affordances) — surfaces where nothing else
 * signals clickability.
 *
 * This used to also carry `bg-transparent p-0` as a stopgap for
 * preflight-less hosts; the scoped form-control preflight in `styles.css`
 * (#374) now neutralizes the UA button box (background, padding, font) for
 * every button under `.stgm`, so only the cursor remains. The cursor stays
 * a per-component choice rather than a preflight rule on purpose: Tailwind's
 * preflight leaves buttons with the default arrow cursor, and the scoped
 * preflight mirrors it byte-for-byte so embeds render exactly like the
 * consoles.
 */
export const UNSTYLED_BUTTON = "cursor-pointer";

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
