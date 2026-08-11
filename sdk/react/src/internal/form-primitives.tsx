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
export const UNSTYLED_BUTTON = "stg:cursor-pointer";

/** Standard text-input styling for the operator consoles. */
export const INPUT_CLASSES = cn(
  "stg:w-full stg:rounded-md stg:border stg:border-input stg:bg-background stg:px-2.5 stg:py-1.5 stg:text-xs stg:text-foreground",
  "stg:placeholder:text-muted-foreground",
  "stg:focus-visible:outline-none stg:focus-visible:ring-1 stg:focus-visible:ring-ring",
  "stg:disabled:pointer-events-none stg:disabled:opacity-50",
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
    <label className={cn("stg:block stg:space-y-1", className)}>
      <span className="stg:text-[11px] stg:font-medium stg:text-muted-foreground">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
    </label>
  );
}
