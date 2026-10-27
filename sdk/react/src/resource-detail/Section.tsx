"use client";

import { cn } from "@stigmer/design-tokens";
import type { ReactNode } from "react";

export interface SectionProps {
  readonly title: string;
  readonly count?: number;
  /**
   * `true` when `count` is what is loaded of a longer list (a token
   * follows): the badge reads "50+" rather than a total the list does not
   * carry.
   */
  readonly countIsLowerBound?: boolean;
  /** Arbitrary action elements rendered in the header row (e.g. expand, share). */
  readonly headerActions?: ReactNode;
  readonly onEdit?: () => void;
  /**
   * Stable id emitted as `data-scroll-target` on the section element, so
   * guided tours and demos can scroll the section into view by name (the
   * same convention as `data-cursor-target`). Purely an annotation — no
   * behavior attaches to it here.
   */
  readonly scrollTarget?: string;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * Shared section layout for resource detail views.
 *
 * Renders a labeled section with an optional count badge and edit affordance
 * in the header row. The content is wrapped in a bordered card.
 *
 * Used uniformly by AgentDetailView, PluginDetailView, and SkillDetailView.
 */
export function Section({
  title,
  count,
  countIsLowerBound = false,
  headerActions,
  onEdit,
  scrollTarget,
  children,
  className,
}: SectionProps) {
  return (
    <section className={className} data-scroll-target={scrollTarget}>
      <div className="stg:mb-2 stg:flex stg:items-center stg:gap-2">
        <h3 className="stg:text-xs stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground">
          {title}
        </h3>
        {count != null && count > 0 && (
          <span className="stg:inline-flex stg:h-5 stg:min-w-5 stg:items-center stg:justify-center stg:rounded-full stg:bg-muted stg:px-1 stg:text-2xs stg:font-semibold stg:text-muted-foreground">
            {countIsLowerBound ? `${count}+` : count}
          </span>
        )}
        {(headerActions || onEdit) && (
          <div className="stg:ml-auto stg:flex stg:items-center stg:gap-1">
            {headerActions}
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                aria-label={`Edit ${title.toLowerCase()}`}
                className={cn(
                  "stg:inline-flex stg:size-6 stg:items-center stg:justify-center stg:rounded-md stg:text-muted-foreground",
                  "stg:hover:bg-accent-hover stg:hover:text-foreground",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                  "stg:transition-colors",
                )}
              >
                <PencilIcon className="stg:size-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="stg:overflow-hidden stg:rounded-lg stg:border stg:border-border">
        {children}
      </div>
    </section>
  );
}

function PencilIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M11.5 1.5a2.121 2.121 0 0 1 3 3L5 14l-4 1 1-4Z" />
    </svg>
  );
}
