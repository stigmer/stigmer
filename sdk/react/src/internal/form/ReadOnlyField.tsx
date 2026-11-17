"use client";

// What a form shows but doesn't let you change (an app's client id, an
// issuer's address, when a thing was made): a label and its value as a
// pair in a description list. On a wide page the label sits in a column
// at the left and the value beside it; on a phone the value goes under its
// label. The value is the page's body text, so a read-only pair reads as
// the same thing an editable field's value does. Before this part, each
// detail panel drew its own pairs at 11px and 12px.

import type { ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";

/** Props for {@link ReadOnlyFields}. */
export interface ReadOnlyFieldsProps {
  /** The pairs ({@link ReadOnlyField}s). */
  readonly children: ReactNode;
  /** Names the list, when no heading above does. */
  readonly "aria-label"?: string;
  readonly className?: string;
}

/** A list of read-only pairs. */
export function ReadOnlyFields({ children, "aria-label": ariaLabel, className }: ReadOnlyFieldsProps) {
  return (
    <dl aria-label={ariaLabel} className={cn("stg:m-0 stg:flex stg:flex-col stg:gap-2 stg:text-sm", className)}>
      {children}
    </dl>
  );
}

/** Props for {@link ReadOnlyField}. */
export interface ReadOnlyFieldProps {
  /** What the value is ("Client ID"). */
  readonly label: ReactNode;
  /** The value; nothing is drawn when it is empty. */
  readonly children?: ReactNode;
  /** The value is an identifier or code, set in the mono face. */
  readonly mono?: boolean;
  readonly className?: string;
}

/** One read-only pair: its label, and its value beside or under it. */
export function ReadOnlyField({ label, children, mono, className }: ReadOnlyFieldProps) {
  if (children === undefined || children === null || children === "" || children === false) return null;
  return (
    <div
      className={cn(
        "stg:grid stg:min-w-0 stg:gap-x-4 stg:gap-y-0.5 stg:sm:grid-cols-[minmax(7.5rem,12.5rem)_minmax(0,1fr)]",
        className,
      )}
    >
      <dt className="stg:text-muted-foreground">{label}</dt>
      <dd className={cn("stg:m-0 stg:min-w-0 stg:break-words stg:text-foreground", mono && "stg:font-mono")}>
        {children}
      </dd>
    </div>
  );
}
