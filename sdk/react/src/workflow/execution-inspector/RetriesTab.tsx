"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { TaskDetailRetryHistory } from "./derive-task-detail.js";
import { formatDuration, formatTimestamp } from "../format-utils.js";

export interface RetriesTabProps {
  readonly retries: TaskDetailRetryHistory;
  readonly className?: string;
}

export const RetriesTab = memo(function RetriesTab({ retries, className }: RetriesTabProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <p className="text-xs text-muted-foreground">
        {retries.attempts.length} attempt{retries.attempts.length !== 1 ? "s" : ""}
        {retries.currentAttempt > 1 && <> · currently on attempt {retries.currentAttempt}</>}
      </p>

      <div className="flex flex-col gap-1">
        {retries.attempts.map((attempt) => (
          <div
            key={attempt.attemptNumber}
            className={cn(
              "flex flex-col gap-0.5 rounded-md border px-2.5 py-2 text-xs",
              attempt.status === "failed"
                ? "border-destructive/20 bg-destructive/5"
                : "border-border bg-muted/30",
            )}
          >
            <div className="flex items-center gap-2">
              <span className={cn(
                "flex size-3.5 items-center justify-center rounded-full text-[8px]",
                attempt.status === "failed" ? "bg-destructive text-destructive-foreground" : "bg-success text-success-foreground",
              )}>
                {attempt.status === "failed" ? "✕" : "✓"}
              </span>
              <span className="font-medium text-foreground">
                Attempt {attempt.attemptNumber}
              </span>
              {attempt.durationMs > 0 && (
                <span className="tabular-nums text-muted-foreground">{formatDuration(attempt.durationMs)}</span>
              )}
              {attempt.startedAt && (
                <span className="ml-auto text-[10px] tabular-nums text-muted-foreground">
                  {formatTimestamp(attempt.startedAt)}
                </span>
              )}
            </div>

            {attempt.error && (
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] text-destructive/80">
                {attempt.error}
              </p>
            )}

            {attempt.delayBeforeMs > 0 && (
              <p className="text-[10px] text-muted-foreground">
                Backoff: {formatDuration(attempt.delayBeforeMs)}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});
