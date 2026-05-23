"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { TaskDetailIO } from "./derive-task-detail";
import { CollapsibleCode, formatJson } from "../../execution/tool-rendering-primitives";

export interface InputOutputTabProps {
  readonly data: TaskDetailIO | null;
  readonly label: "Input" | "Output";
  readonly className?: string;
}

/**
 * Renders task input or output data. Shows the full snapshot data when
 * available, falling back to the truncated event summary. Displays a
 * graceful empty state when the runner hasn't populated this field yet.
 */
export const InputOutputTab = memo(function InputOutputTab({
  data,
  label,
  className,
}: InputOutputTabProps) {
  if (!data) {
    return (
      <div className={cn("flex flex-col items-center justify-center px-4 py-8 text-center", className)}>
        <EmptyDataIcon />
        <p className="mt-2 text-xs text-muted-foreground">
          {label} data not available for this execution
        </p>
        {label === "Input" && (
          <p className="mt-1 text-[10px] text-muted-foreground">
            The workflow runner may not have recorded task inputs for this run.
          </p>
        )}
      </div>
    );
  }

  const content = formatJson(data.data);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {data.source === "event-summary" && (
        <p className="text-[10px] text-muted-foreground">
          Showing truncated summary from the event log. Full data will be available when the runner is updated.
        </p>
      )}
      {data.artifactIds.length > 0 && (
        <p className="text-[10px] text-muted-foreground">
          {data.artifactIds.length} artifact{data.artifactIds.length > 1 ? "s" : ""} associated
        </p>
      )}
      <CollapsibleCode label={label} content={content} />
    </div>
  );
});

function EmptyDataIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-muted-foreground" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 9h6M9 13h4" />
    </svg>
  );
}
