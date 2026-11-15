"use client";

// The console's one count badge: a number on a round fill, beside or over
// the control it counts for (the panel button's new items, the composer's
// attached files, a tab's rows, the sidebar's waiting sessions). Its type is
// the scale's smallest step on its paired line (11px on 16px), so a count
// never sits on lines its step does not pair with. Internal: the kit's own
// components use it; where it sits (pinned to a corner) is its caller's.

import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";

/** How a {@link CountBadge} is filled. */
export type CountBadgeTone = "primary" | "primary-subtle" | "muted" | "sidebar";

/** Props for {@link CountBadge}. */
export interface CountBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** The count, already worded ("3", "99+"). */
  readonly children: ReactNode;
  /** `md` (the default) is 16px tall; `sm`, 14px, sits on the composer's small buttons. */
  readonly size?: "sm" | "md";
  /** The fill: the primary pair (the default), its subtle form, the muted pair, or the sidebar's primary pair. */
  readonly tone?: CountBadgeTone;
}

const TONES: Readonly<Record<CountBadgeTone, string>> = {
  primary: "stg:bg-primary stg:text-primary-foreground",
  "primary-subtle": "stg:bg-primary-subtle stg:text-primary",
  muted: "stg:bg-muted stg:text-muted-foreground",
  sidebar: "stg:bg-sidebar-primary stg:text-sidebar-primary-foreground",
};

/** The badge's classes, for a count that must itself be another element. */
export function countBadgeClasses({ size = "md", tone = "primary" }: { readonly size?: "sm" | "md"; readonly tone?: CountBadgeTone } = {}): string {
  return cn(
    "stg:inline-flex stg:shrink-0 stg:items-center stg:justify-center stg:rounded-full stg:text-2xs stg:font-medium stg:tabular-nums",
    size === "sm" ? "stg:h-3.5 stg:min-w-3.5 stg:px-0.5" : "stg:h-4 stg:min-w-4 stg:px-1",
    TONES[tone],
  );
}

/** A count on a round fill: 11px on 16px lines, 16px tall (14px at `sm`). */
export function CountBadge({ children, size, tone, className, ...rest }: CountBadgeProps) {
  return (
    <span className={cn(countBadgeClasses({ size, tone }), className)} {...rest}>
      {children}
    </span>
  );
}
