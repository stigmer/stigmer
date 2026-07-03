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
  "customer-support": "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  "code-review": "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  "data-analysis": "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  devops: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  content: "bg-pink-500/10 text-pink-700 dark:text-pink-400",
  integration: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  general: "bg-muted text-muted-foreground",
};

// ---------------------------------------------------------------------------
// Initial avatar colors (deterministic from template id)
// ---------------------------------------------------------------------------

const AVATAR_COLORS = [
  "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  "bg-pink-500/15 text-pink-700 dark:text-pink-400",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400",
  "bg-rose-500/15 text-rose-700 dark:text-rose-400",
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
        "group flex cursor-pointer flex-col gap-3 rounded-lg border border-border bg-card p-4",
        "transition-colors hover:border-primary hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {/* Initial avatar */}
        <span
          className={cn(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-md text-sm font-semibold",
            avatarColor,
          )}
          aria-hidden="true"
        >
          {initial}
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{template.name}</p>
          <span
            className={cn(
              "mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium",
              CATEGORY_COLORS[template.category] ?? CATEGORY_COLORS.general,
            )}
          >
            {categoryLabel}
          </span>
        </div>
      </div>

      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {template.description}
      </p>
    </div>
  );
}
