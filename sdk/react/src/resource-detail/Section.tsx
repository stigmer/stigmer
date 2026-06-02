"use client";

import { cn } from "@stigmer/theme";
import type { ReactNode } from "react";

export interface SectionProps {
  readonly title: string;
  readonly count?: number;
  /** Arbitrary action elements rendered in the header row (e.g. expand, share). */
  readonly headerActions?: ReactNode;
  readonly onEdit?: () => void;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * Shared section layout for resource detail views.
 *
 * Renders a labeled section with an optional count badge and edit affordance
 * in the header row. The content is wrapped in a bordered card.
 *
 * Used uniformly by AgentDetailView, McpServerDetailView, and SkillDetailView.
 */
export function Section({
  title,
  count,
  headerActions,
  onEdit,
  children,
  className,
}: SectionProps) {
  return (
    <section className={className}>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
        {count != null && count > 0 && (
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
            {count}
          </span>
        )}
        {(headerActions || onEdit) && (
          <div className="ml-auto flex items-center gap-1">
            {headerActions}
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                aria-label={`Edit ${title.toLowerCase()}`}
                className={cn(
                  "inline-flex size-6 items-center justify-center rounded-md text-muted-foreground",
                  "hover:bg-accent-hover hover:text-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  "transition-colors",
                )}
              >
                <PencilIcon className="size-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border border-border">
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
