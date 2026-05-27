"use client";

import { memo, useState, useCallback } from "react";
import { cn } from "@stigmer/theme";
import type { TaskDetailError } from "./derive-task-detail";
import { formatDuration } from "../format-utils";

export interface ErrorTabProps {
  readonly error: TaskDetailError;
  readonly childExecutionId?: string;
  readonly onNavigateToAgentExecution?: (executionId: string) => void;
  readonly className?: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  LLM_AUTHENTICATION_ERROR: "Authentication Error",
  LLM_PERMISSION_DENIED: "Permission Denied",
  LLM_MODEL_NOT_FOUND: "Model Not Found",
  LLM_RATE_LIMIT: "Rate Limit",
  LLM_BAD_REQUEST: "Bad Request",
  LLM_UNPROCESSABLE_REQUEST: "Unprocessable Request",
  LLM_SCHEMA_VALIDATION: "Schema Validation",
  LLM_MISSING_API_KEY: "Missing API Key",
  LLM_API_ERROR: "API Error",
  LLM_UNKNOWN_ERROR: "Unknown Error",
  HTTP_CLIENT_ERROR: "HTTP Client Error",
  WORKFLOW_EXECUTION_FAILED: "Execution Failed",
};

function getCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replace(/_/g, " ");
}

export const ErrorTab = memo(function ErrorTab({
  error,
  childExecutionId,
  onNavigateToAgentExecution,
  className,
}: ErrorTabProps) {
  const [showDetail, setShowDetail] = useState(false);
  const toggleDetail = useCallback(() => setShowDetail(v => !v), []);
  const hasDetail = !!error.detail;

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2" role="alert">
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium text-destructive">Error</p>
          {error.category && (
            <span className="rounded-sm bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
              {getCategoryLabel(error.category)}
            </span>
          )}
        </div>
        <p className="mt-1 whitespace-pre-wrap break-words text-xs text-destructive/80">{error.message}</p>
      </div>

      {hasDetail && (
        <div>
          <button
            type="button"
            onClick={toggleDetail}
            className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {showDetail ? "Hide" : "Show"} technical details
          </button>
          {showDetail && (
            <pre className="mt-1 rounded-md border bg-muted/30 p-2 text-[10px] text-muted-foreground whitespace-pre-wrap break-words">
              {error.detail}
            </pre>
          )}
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">Attempt</dt>
        <dd className="tabular-nums text-foreground">
          {error.attemptNumber}
          {error.maxAttempts > 0 && <span className="text-muted-foreground"> / {error.maxAttempts}</span>}
        </dd>

        {error.durationMs > 0 && (
          <>
            <dt className="text-muted-foreground">Duration</dt>
            <dd className="tabular-nums text-foreground">
              {formatDuration(error.durationMs)}
            </dd>
          </>
        )}

        <dt className="text-muted-foreground">Retryable</dt>
        <dd className="text-foreground">{error.willRetry ? "Yes" : "No"}</dd>
      </dl>

      {onNavigateToAgentExecution && childExecutionId && (
        <button
          type="button"
          onClick={() => onNavigateToAgentExecution(childExecutionId)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5",
            "text-xs font-medium transition-colors",
            "bg-background text-foreground hover:bg-accent",
          )}
        >
          View Agent Execution
        </button>
      )}
    </div>
  );
});
