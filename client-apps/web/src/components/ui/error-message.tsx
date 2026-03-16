"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, RotateCcw, ShieldX } from "lucide-react";
import {
  classifyError,
  getUserMessage,
  getRpcMetadata,
  isRetryableError,
  type ErrorCategory,
} from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import { Button } from "@/components/ui/button";

interface ErrorMessageProps {
  /** The error to display. Renders nothing when `null`. */
  error: Error | null;
  /** Override the default title derived from the error category. */
  title?: string;
  /** Callback to retry the failed operation. Shows a "Retry" button when provided and the error is retryable. */
  retry?: () => void;
  className?: string;
}

const CATEGORY_TITLES: Record<ErrorCategory, string> = {
  auth: "Authentication required",
  permission: "Access denied",
  "not-found": "Not found",
  validation: "Invalid request",
  server: "Server error",
  unavailable: "Service unavailable",
  cancelled: "Request cancelled",
  unknown: "Something went wrong",
};

const CATEGORY_ICONS: Record<ErrorCategory, typeof AlertTriangle> = {
  auth: ShieldX,
  permission: ShieldX,
  "not-found": AlertTriangle,
  validation: AlertTriangle,
  server: AlertTriangle,
  unavailable: AlertTriangle,
  cancelled: AlertTriangle,
  unknown: AlertTriangle,
};

/**
 * Inline error display for failed queries.
 *
 * Classifies the error and renders a category-appropriate message with an
 * optional retry action. Expandable technical details (RPC method and path)
 * are shown when available — useful for developers debugging failures.
 *
 * Usage:
 * ```tsx
 * const { data, isLoading, error, refetch } = useAgent(id);
 * if (error) return <ErrorMessage error={error} retry={refetch} />;
 * ```
 */
export function ErrorMessage({
  error,
  title,
  retry,
  className,
}: ErrorMessageProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (!error) return null;

  const category = classifyError(error);
  const message = getUserMessage(error);
  const metadata = getRpcMetadata(error);
  const retryable = isRetryableError(error);
  const Icon = CATEGORY_ICONS[category];

  return (
    <div
      role="alert"
      className={cn(
        "bg-destructive/5 border-destructive/20 text-destructive rounded-lg border p-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">
            {title ?? CATEGORY_TITLES[category]}
          </p>
          <p className="text-destructive/80 text-sm">{message}</p>

          {metadata && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setDetailsOpen((prev) => !prev)}
                className="text-destructive/60 hover:text-destructive/80 inline-flex items-center gap-1 text-xs transition-colors"
              >
                <ChevronDown
                  className={cn(
                    "size-3 transition-transform",
                    detailsOpen && "rotate-180",
                  )}
                />
                Technical details
              </button>
              {detailsOpen && (
                <dl className="text-destructive/60 mt-1.5 space-y-0.5 font-mono text-xs">
                  <div className="flex gap-2">
                    <dt className="shrink-0">Method:</dt>
                    <dd className="truncate">{metadata.method}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="shrink-0">Path:</dt>
                    <dd className="truncate">{metadata.path}</dd>
                  </div>
                </dl>
              )}
            </div>
          )}
        </div>

        {retry && retryable && (
          <Button
            variant="outline"
            size="sm"
            onClick={retry}
            className="shrink-0"
          >
            <RotateCcw className="size-3" data-icon="inline-start" />
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}
