"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { TaskDetailError } from "./derive-task-detail";

export interface ErrorTabProps {
  readonly error: TaskDetailError;
  readonly className?: string;
}

export const ErrorTab = memo(function ErrorTab({ error, className }: ErrorTabProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2" role="alert">
        <p className="text-xs font-medium text-destructive">Error</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-xs text-destructive/80">{error.message}</p>
      </div>

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
              {error.durationMs < 1000 ? `${error.durationMs}ms` : `${(error.durationMs / 1000).toFixed(1)}s`}
            </dd>
          </>
        )}

        <dt className="text-muted-foreground">Retryable</dt>
        <dd className="text-foreground">{error.willRetry ? "Yes" : "No"}</dd>
      </dl>
    </div>
  );
});
