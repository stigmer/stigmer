"use client";

import { useCallback, useMemo } from "react";
import { cn } from "@stigmer/theme";
import type { WorkflowTemplate, WorkflowTemplateMeta } from "./types.js";
import { PATTERN_LABELS } from "./types.js";
import { deriveTemplateMeta } from "./derive-template-metadata.js";
import { TEMPLATE_CATEGORY_LABELS } from "../../resource-creation/templates/types.js";

export interface WorkflowTemplateCardProps {
  readonly template: WorkflowTemplate;
  readonly onSelect: (template: WorkflowTemplate) => void;
  readonly onPreview?: (template: WorkflowTemplate) => void;
  readonly className?: string;
}

const CATEGORY_COLORS: Record<string, string> = {
  "customer-support": "stg:bg-blue-500/10 stg:text-blue-700 stg:dark:text-blue-400",
  "code-review": "stg:bg-violet-500/10 stg:text-violet-700 stg:dark:text-violet-400",
  "data-analysis": "stg:bg-amber-500/10 stg:text-amber-700 stg:dark:text-amber-400",
  devops: "stg:bg-emerald-500/10 stg:text-emerald-700 stg:dark:text-emerald-400",
  content: "stg:bg-pink-500/10 stg:text-pink-700 stg:dark:text-pink-400",
  integration: "stg:bg-cyan-500/10 stg:text-cyan-700 stg:dark:text-cyan-400",
  general: "stg:bg-muted stg:text-muted-foreground",
};

const PATTERN_COLORS: Record<string, string> = {
  parallel: "stg:bg-violet-500/10 stg:text-violet-700 stg:dark:text-violet-400",
  branching: "stg:bg-amber-500/10 stg:text-amber-700 stg:dark:text-amber-400",
  hitl: "stg:bg-emerald-500/10 stg:text-emerald-700 stg:dark:text-emerald-400",
  loop: "stg:bg-pink-500/10 stg:text-pink-700 stg:dark:text-pink-400",
  "error-handling": "stg:bg-red-500/10 stg:text-red-700 stg:dark:text-red-400",
  batch: "stg:bg-cyan-500/10 stg:text-cyan-700 stg:dark:text-cyan-400",
  "ai-pipeline": "stg:bg-blue-500/10 stg:text-blue-700 stg:dark:text-blue-400",
  "http-integration": "stg:bg-orange-500/10 stg:text-orange-700 stg:dark:text-orange-400",
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
        "stg:group stg:flex stg:cursor-pointer stg:flex-col stg:gap-3 stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-4",
        "stg:transition-colors stg:hover:border-primary stg:hover:bg-accent",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
        className,
      )}
    >
      {/* Header: name + category */}
      <div className="stg:flex stg:items-start stg:justify-between stg:gap-2">
        <div className="stg:min-w-0 stg:flex-1">
          <p className="stg:text-sm stg:font-medium stg:text-foreground">
            {template.name}
          </p>
          <span
            className={cn(
              "stg:mt-1 stg:inline-block stg:rounded-full stg:px-2 stg:py-0.5 stg:text-[10px] stg:font-medium",
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
              "stg:rounded-md stg:p-1 stg:text-muted-foreground stg:opacity-0 stg:transition-opacity",
              "stg:hover:bg-accent stg:hover:text-accent-foreground",
              "stg:focus-visible:opacity-100 stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              "stg:group-hover:opacity-100",
            )}
          >
            <PreviewIcon />
          </button>
        )}
      </div>

      {/* Description */}
      <p className="stg:line-clamp-2 stg:text-xs stg:leading-relaxed stg:text-muted-foreground">
        {template.description}
      </p>

      {/* Pattern badges */}
      {meta.patterns.length > 0 && (
        <div className="stg:flex stg:flex-wrap stg:gap-1">
          {meta.patterns.slice(0, 3).map((pattern) => (
            <span
              key={pattern}
              className={cn(
                "stg:rounded stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium",
                PATTERN_COLORS[pattern] ?? "stg:bg-muted stg:text-muted-foreground",
              )}
            >
              {PATTERN_LABELS[pattern]}
            </span>
          ))}
        </div>
      )}

      {/* Metadata chips */}
      <div className="stg:flex stg:items-center stg:gap-3 stg:text-[10px] stg:text-muted-foreground">
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
      className="stg:size-4"
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
