"use client";

import { cn } from "@stigmer/design-tokens";
import { IconButton } from "../button/IconButton.js";
import { cardClasses, cardHeaderClasses } from "../internal/surface/Card.js";
import { Tag } from "../internal/surface/Tag.js";
import type { ReactNode } from "react";
import { useSectionHeadingLevel } from "./headingLevel.js";

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
 * A card whose header bar holds the section's title (14/20, semibold, one
 * heading level under the detail page's title: `h2` under an `h1`, `h3`
 * under the default `h2` and wherever no detail page sets it), its count and its
 * acts (the edit icon button among them); the content sits under the bar
 * and draws its own inner spacing.
 *
 * Used uniformly by AgentDetailView, PluginDetailView, SkillDetailView and
 * the other detail views.
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
  const level = useSectionHeadingLevel();
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className={cn(cardClasses({ flush: true }), className)} data-scroll-target={scrollTarget}>
      <div className={cardHeaderClasses()}>
        <div className="stg:flex stg:min-w-0 stg:items-center stg:gap-2">
          <Heading className="stg:m-0 stg:text-sm stg:font-semibold stg:text-foreground">{title}</Heading>
          {count != null && count > 0 && <Tag>{countIsLowerBound ? `${count}+` : count}</Tag>}
        </div>
        {(headerActions || onEdit) && (
          <div className="stg:flex stg:items-center stg:gap-1">
            {headerActions}
            {onEdit && (
              <IconButton label={`Edit ${title.toLowerCase()}`} size="xs" icon={<PencilIcon className="stg:size-3.5" />} onClick={onEdit} />
            )}
          </div>
        )}
      </div>
      {children}
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
