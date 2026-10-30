"use client";

import { useCallback } from "react";
import { cn } from "@stigmer/design-tokens";
import type { ResourceTemplate } from "./templates/types.js";
import { TEMPLATE_CATEGORY_LABELS } from "./templates/types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link TemplateCard}. */
export interface TemplateCardProps<TData> {
  /** The template to display. */
  readonly template: ResourceTemplate<TData>;
  /** Called when the card is selected (click or Enter). */
  readonly onSelect: (template: ResourceTemplate<TData>) => void;
  /** Additional CSS classes for the card container. */
  readonly className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * A clickable card that displays a resource template's metadata.
 *
 * Renders the template's name, description, and category badge, with the
 * name's initial on the theme's avatar colour (`--stgm-avatar`), as
 * `ResourceAvatar` draws a resource's, so the card looks like every other
 * resource card.
 *
 * Fully keyboard-accessible: focusable, activates on Enter/Space.
 * Every colour reads a `--stgm-*` token, so a preset or a host's brand
 * restyles the card in light and dark mode alike.
 *
 * @typeParam TData - The wizard data shape this template targets.
 */
export function TemplateCard<TData>({
  template,
  onSelect,
  className,
}: TemplateCardProps<TData>) {
  const handleClick = useCallback(() => {
    onSelect(template);
  }, [onSelect, template]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(template);
      }
    },
    [onSelect, template],
  );

  const initial = template.name.charAt(0).toUpperCase();
  const categoryLabel =
    TEMPLATE_CATEGORY_LABELS[template.category] ?? template.category;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      aria-label={`Use ${template.name} template`}
      className={cn(
        "stg:group stg:flex stg:cursor-pointer stg:flex-col stg:gap-3 stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-4",
        "stg:transition-colors stg:hover:border-primary stg:hover:bg-accent",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        className,
      )}
    >
      <div className="stg:flex stg:items-start stg:gap-3">
        {/* Initial avatar */}
        <span
          className="stg:inline-flex stg:size-9 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-md stg:bg-avatar stg:text-sm stg:font-semibold stg:text-muted-foreground"
          aria-hidden="true"
        >
          {initial}
        </span>

        <div className="stg:min-w-0 stg:flex-1">
          <p className="stg:text-sm stg:font-medium stg:text-foreground">{template.name}</p>
          <span className="stg:mt-1 stg:inline-block stg:rounded-full stg:bg-muted stg:px-2 stg:py-0.5 stg:text-2xs stg:font-medium stg:text-muted-foreground">
            {categoryLabel}
          </span>
        </div>
      </div>

      <p className="stg:line-clamp-2 stg:text-xs stg:leading-relaxed stg:text-muted-foreground">
        {template.description}
      </p>
    </div>
  );
}
