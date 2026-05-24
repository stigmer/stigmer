"use client";

import { useCallback, useMemo } from "react";
import { cn } from "@stigmer/theme";
import type { WorkflowTemplate, WorkflowTemplateMeta } from "./types";
import { PATTERN_LABELS } from "./types";
import { deriveTemplateMeta } from "./derive-template-metadata";
import { TEMPLATE_CATEGORY_LABELS } from "../../resource-creation/templates/types";

export interface WorkflowTemplateCardProps {
  readonly template: WorkflowTemplate;
  readonly onSelect: (template: WorkflowTemplate) => void;
  readonly onPreview?: (template: WorkflowTemplate) => void;
  readonly className?: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  "customer-support": "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  "code-review": "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  "data-analysis": "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  devops: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  content: "bg-pink-500/10 text-pink-700 dark:text-pink-400",
  integration: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  general: "bg-muted text-muted-foreground",
};

const PATTERN_COLORS: Record<string, string> = {
  parallel: "bg-violet-500/10 text-violet-700 dark:text-violet-400",
  branching: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  hitl: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  loop: "bg-pink-500/10 text-pink-700 dark:text-pink-400",
  "error-handling": "bg-red-500/10 text-red-700 dark:text-red-400",
  batch: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400",
  "ai-pipeline": "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  "http-integration": "bg-orange-500/10 text-orange-700 dark:text-orange-400",
};

/**
 * Enhanced template card for workflow templates.
 *
 * Shows the template name, description, category badge, pattern badges,
 * task count, and env var count. Click selects the template; an optional
 * preview button opens the graph preview dialog.
 */
export function WorkflowTemplateCard({
  template,
  onSelect,
  onPreview,
  className,
}: WorkflowTemplateCardProps) {
  const meta: WorkflowTemplateMeta = useMemo(
    () => deriveTemplateMeta(template.data.yaml ?? ""),
    [template.data.yaml],
  );

  const handleClick = useCallback(() => {
    onSelect(template);
  }, [onSelect, template]);

  const handlePreview = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onPreview?.(template);
    },
    [onPreview, template],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect(template);
      }
    },
    [onSelect, template],
  );

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
      {/* Header: name + category */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {template.name}
          </p>
          <span
            className={cn(
              "mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium",
              CATEGORY_COLORS[template.category] ?? CATEGORY_COLORS.general,
            )}
          >
            {categoryLabel}
          </span>
        </div>
        {onPreview && (
          <button
            type="button"
            onClick={handlePreview}
            aria-label={`Preview ${template.name}`}
            className={cn(
              "rounded-md p-1 text-muted-foreground opacity-0 transition-opacity",
              "hover:bg-accent hover:text-accent-foreground",
              "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "group-hover:opacity-100",
            )}
          >
            <PreviewIcon />
          </button>
        )}
      </div>

      {/* Description */}
      <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
        {template.description}
      </p>

      {/* Pattern badges */}
      {meta.patterns.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {meta.patterns.slice(0, 3).map((pattern) => (
            <span
              key={pattern}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-medium",
                PATTERN_COLORS[pattern] ?? "bg-muted text-muted-foreground",
              )}
            >
              {PATTERN_LABELS[pattern]}
            </span>
          ))}
        </div>
      )}

      {/* Metadata chips */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span>{meta.taskCount} tasks</span>
        {meta.envVarCount > 0 && <span>{meta.envVarCount} env vars</span>}
        {meta.hasBudget && <span>Budget</span>}
      </div>
    </div>
  );
}

function PreviewIcon() {
  return (
    <svg
      className="size-4"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx={12} cy={12} r={3} />
    </svg>
  );
}
