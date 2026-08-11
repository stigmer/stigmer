"use client";

import { useCallback } from "react";
import { cn } from "@stigmer/theme";
import type { ResourceTemplate, TemplateCategory } from "./templates/types.js";
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
// Category badge colors
// ---------------------------------------------------------------------------

const CATEGORY_COLORS: Record<TemplateCategory, string> = {
  "customer-support": "stg:bg-blue-500/10 stg:text-blue-700 stg:dark:text-blue-400",
  "code-review": "stg:bg-violet-500/10 stg:text-violet-700 stg:dark:text-violet-400",
  "data-analysis": "stg:bg-amber-500/10 stg:text-amber-700 stg:dark:text-amber-400",
  devops: "stg:bg-emerald-500/10 stg:text-emerald-700 stg:dark:text-emerald-400",
  content: "stg:bg-pink-500/10 stg:text-pink-700 stg:dark:text-pink-400",
  integration: "stg:bg-cyan-500/10 stg:text-cyan-700 stg:dark:text-cyan-400",
  general: "stg:bg-muted stg:text-muted-foreground",
};

// ---------------------------------------------------------------------------
// Initial avatar colors (deterministic from template id)
// ---------------------------------------------------------------------------

const AVATAR_COLORS = [
  "stg:bg-blue-500/15 stg:text-blue-700 stg:dark:text-blue-400",
  "stg:bg-violet-500/15 stg:text-violet-700 stg:dark:text-violet-400",
  "stg:bg-emerald-500/15 stg:text-emerald-700 stg:dark:text-emerald-400",
  "stg:bg-amber-500/15 stg:text-amber-700 stg:dark:text-amber-400",
  "stg:bg-pink-500/15 stg:text-pink-700 stg:dark:text-pink-400",
  "stg:bg-cyan-500/15 stg:text-cyan-700 stg:dark:text-cyan-400",
  "stg:bg-rose-500/15 stg:text-rose-700 stg:dark:text-rose-400",
] as const;

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * A clickable card that displays a resource template's metadata.
 *
 * Renders the template's name, description, and category badge.
 * Displays a colored initial avatar derived from the template name.
 *
 * Fully keyboard-accessible: focusable, activates on Enter/Space.
 * Uses `--stgm-*` tokens for all structural styling; category badge
 * colors use Tailwind's semantic palette with opacity for dark mode.
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

  const colorIndex = hashCode(template.id) % AVATAR_COLORS.length;
  const avatarColor = AVATAR_COLORS[colorIndex]!;
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
          className={cn(
            "stg:inline-flex stg:size-9 stg:shrink-0 stg:items-center stg:justify-center stg:rounded-md stg:text-sm stg:font-semibold",
            avatarColor,
          )}
          aria-hidden="true"
        >
          {initial}
        </span>

        <div className="stg:min-w-0 stg:flex-1">
          <p className="stg:text-sm stg:font-medium stg:text-foreground">{template.name}</p>
          <span
            className={cn(
              "stg:mt-1 stg:inline-block stg:rounded-full stg:px-2 stg:py-0.5 stg:text-[10px] stg:font-medium",
              CATEGORY_COLORS[template.category] ?? CATEGORY_COLORS.general,
            )}
          >
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
