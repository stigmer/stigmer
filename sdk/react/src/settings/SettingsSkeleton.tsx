"use client";

// What a settings page draws while its data is read, in the shape the page
// will show, in a region assistive technology hears as busy: rows inside
// one card for a list or a form, or figures and a chart for a page of
// numbers (Usage, Billing). Every settings panel and both clients'
// route-level loading draw this, so a page loads the same way wherever it
// is opened.

import { cn } from "@stigmer/design-tokens";
import { LoadingRegion } from "../internal/LoadingRegion.js";
import { cardClasses } from "../internal/surface/Card.js";

/** Props for {@link SettingsSkeleton}. */
export interface SettingsSkeletonProps {
  /** What is being read, for assistive technology ("Loading members"). */
  readonly label?: string;
  /** The page's shape: rows of a list or a form (the default), or figures over a chart. */
  readonly variant?: "rows" | "figures";
  /** How many rows to draw, or how many figures. */
  readonly rows?: number;
  readonly className?: string;
}

/** A settings page's content while it loads. */
export function SettingsSkeleton({ label = "Loading", variant = "rows", rows, className }: SettingsSkeletonProps) {
  if (variant === "figures") {
    return (
      <LoadingRegion label={label} className={cn("stg:flex stg:flex-col stg:gap-4", className)}>
        <div className="stg:grid stg:grid-cols-1 stg:gap-3 stg:sm:grid-cols-3" aria-hidden="true">
          {Array.from({ length: rows ?? 3 }, (_, index) => (
            <span
              key={index}
              className={cn(cardClasses(), "stg:flex stg:h-20 stg:flex-col stg:justify-center stg:gap-2 stg:py-0")}
            >
              <span className="stg:h-2.5 stg:w-20 stg:animate-pulse stg:rounded stg:bg-muted-subtle" />
              <span className="stg:h-5 stg:w-24 stg:animate-pulse stg:rounded stg:bg-muted" />
            </span>
          ))}
        </div>
        <span className={cn(cardClasses({ flush: true }), "stg:h-40 stg:animate-pulse")} aria-hidden="true" />
      </LoadingRegion>
    );
  }
  return (
    <LoadingRegion label={label} className={cn(cardClasses({ flush: true }), className)}>
      {/* The rows of a List: its dividers, its row padding, a name over a second line. */}
      <ul className="stg:m-0 stg:list-none stg:divide-y stg:divide-border-muted stg:p-0" aria-hidden="true">
        {Array.from({ length: rows ?? 4 }, (_, index) => (
          <li key={index} className="stg:flex stg:min-h-10 stg:items-center stg:gap-3 stg:px-3.5 stg:py-2.5">
            <span className="stg:size-8 stg:shrink-0 stg:animate-pulse stg:rounded-full stg:bg-muted" />
            <span className="stg:flex stg:flex-1 stg:flex-col stg:gap-2">
              <span className="stg:h-3.5 stg:w-40 stg:max-w-full stg:animate-pulse stg:rounded stg:bg-muted" />
              <span className="stg:h-3 stg:w-64 stg:max-w-full stg:animate-pulse stg:rounded stg:bg-muted-subtle" />
            </span>
            <span className="stg:h-5 stg:w-14 stg:shrink-0 stg:animate-pulse stg:rounded-full stg:bg-muted" />
          </li>
        ))}
      </ul>
    </LoadingRegion>
  );
}
