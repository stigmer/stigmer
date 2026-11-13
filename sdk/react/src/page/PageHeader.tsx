"use client";

// The console's one page heading: a title, one line on what the page is
// for, and the page's main acts at the right. Every page that opens on a
// heading draws it here (each settings page through `SettingsPage`, the
// dashboard, the marketplace), so every page opens the same way in the web
// console, the desktop app and an embedder's product.

import type { ReactNode } from "react";
import { cn } from "@stigmer/design-tokens";

/** Props for {@link PageHeader}. */
export interface PageHeaderProps {
  /** The page's name. */
  readonly title: ReactNode;
  /** One sentence on what the page is for. */
  readonly description?: ReactNode;
  /** The page's main acts, drawn at the right of the title (below it on a phone). */
  readonly actions?: ReactNode;
  /**
   * The heading's level in the host's outline: `1` where the page's title
   * is the document's heading (the dashboard, the marketplace), `2` under a
   * layout that already gives one (each settings page, under "Settings").
   */
  readonly headingLevel?: 1 | 2;
  /** The heading's id, for a landmark that names itself by it (`aria-labelledby`). */
  readonly headingId?: string;
  readonly className?: string;
}

/**
 * A page's heading: its title, what it is for, and its main acts.
 *
 * @example
 * ```tsx
 * <PageHeader
 *   title="Dashboard"
 *   description="What your organization's agents did this week."
 *   headingLevel={1}
 * />
 * ```
 */
export function PageHeader({ title, description, actions, headingLevel = 1, headingId, className }: PageHeaderProps) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <header className={cn("stg:flex stg:flex-col stg:gap-2", className)}>
      <div className="stg:flex stg:min-h-8 stg:flex-wrap stg:items-center stg:justify-between stg:gap-x-6 stg:gap-y-2">
        <Heading id={headingId} className="stg:m-0 stg:text-xl stg:font-semibold stg:tracking-tight stg:text-foreground">
          {title}
        </Heading>
        {actions != null && actions !== false && <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-2">{actions}</div>}
      </div>
      {description != null && <p className="stg:m-0 stg:max-w-2xl stg:text-sm stg:text-muted-foreground">{description}</p>}
    </header>
  );
}
