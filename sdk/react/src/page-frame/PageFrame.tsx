"use client";

// The console's one page column: how wide a page's content runs and how far
// it sits from the window's edges. Every zone of the web console and the
// desktop app (settings, the Library, models, the dashboard, the
// marketplace) frames its pages here, so moving from one zone to another
// never shifts the heading's left edge or changes the margins.

import type { ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";

/**
 * How wide a page's column runs.
 *
 * - `"wide"`: lists, tables and settings (64rem, 1024px).
 * - `"reading"`: a single column of text or one form (48rem, 768px), the
 *   width of a session's conversation.
 */
export type PageFrameWidth = "wide" | "reading";

/** Props for {@link PageFrame}. */
export interface PageFrameProps {
  /** How wide the column runs. @default "wide" */
  readonly width?: PageFrameWidth;
  readonly children?: ReactNode;
  readonly className?: string;
}

const WIDTH_CLASSES: Record<PageFrameWidth, string> = {
  wide: "stg:max-w-5xl",
  reading: "stg:max-w-3xl",
};

/**
 * A page's column: centred, at one of two widths, with the console's page
 * margins (16px at the sides on a phone, 24px from the small breakpoint up).
 *
 * @example
 * ```tsx
 * <PageFrame width="reading">
 *   <h1>Profile</h1>
 *   <p>Your name and how Stigmer reaches you.</p>
 * </PageFrame>
 * ```
 */
export function PageFrame({ width = "wide", children, className }: PageFrameProps) {
  return (
    <div
      className={cn(
        "stg:mx-auto stg:w-full stg:px-4 stg:py-6 stg:sm:px-6 stg:sm:py-8",
        WIDTH_CLASSES[width],
        className,
      )}
    >
      {children}
    </div>
  );
}
