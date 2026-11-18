"use client";

// The centred panel a console page draws in place of its content when there
// is nothing to show: a round icon, a heading, a line under it and the
// page's acts. A missing page, a page that broke and a run that could not
// be opened share it, so each reads the same way in the web console and the
// desktop app. Internal: the page-state views and the run view draw here.

import type { ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";

/** Props for {@link StatePanel}. */
export interface StatePanelProps {
  /** The icon in the round badge, 24px (`stg:size-6`); it takes the badge's tone. */
  readonly icon: ReactNode;
  /** `failed` draws the badge in the failure's tint; `quiet` in the muted one. */
  readonly tone: "failed" | "quiet";
  /** The panel's heading. */
  readonly title: string;
  /** The heading's level: a page's own panel is its `h1`, a panel inside a section an `h2`. */
  readonly headingLevel: 1 | 2;
  /** The line under the heading. */
  readonly description: ReactNode;
  /** The acts, side by side under the line. */
  readonly acts?: ReactNode;
  /** What follows the acts (the help line, a reference). */
  readonly after?: ReactNode;
  /** `page` fills most of the window's height; `section` sits inside a page's own frame. */
  readonly placement: "page" | "section";
}

const TONE: Record<StatePanelProps["tone"], { readonly badge: string; readonly icon: string }> = {
  failed: { badge: "stg:bg-destructive-subtle", icon: "stg:text-destructive" },
  quiet: { badge: "stg:bg-muted", icon: "stg:text-muted-foreground" },
};

/**
 * The centred state a page draws in place of its content.
 *
 * @internal Not part of the public API.
 */
export function StatePanel({ icon, tone, title, headingLevel, description, acts, after, placement }: StatePanelProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div
      className={cn(
        "stg:flex stg:flex-col stg:items-center stg:justify-center",
        placement === "page" ? "stg:min-h-[60vh] stg:px-4" : "stg:py-16",
      )}
    >
      <div className="stg:w-full stg:max-w-sm stg:space-y-6 stg:text-center">
        <div
          className={cn(
            "stg:mx-auto stg:flex stg:size-12 stg:items-center stg:justify-center stg:rounded-full",
            TONE[tone].badge,
          )}
        >
          <span className={cn("stg:flex", TONE[tone].icon)} aria-hidden="true">
            {icon}
          </span>
        </div>
        <div className="stg:space-y-2">
          <Heading className="stg:m-0 stg:text-lg stg:font-semibold">{title}</Heading>
          <p className="stg:m-0 stg:text-sm stg:text-muted-foreground">{description}</p>
        </div>
        {acts !== undefined && <div className="stg:flex stg:items-center stg:justify-center stg:gap-3">{acts}</div>}
        {after}
      </div>
    </div>
  );
}
