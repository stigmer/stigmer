"use client";

import { useState } from "react";
import {
  classifyError,
  getUserMessage,
  getRpcMetadata,
  isRetryableError,
  type ErrorCategory,
} from "@stigmer/sdk";
import { cn } from "@stigmer/theme";

/** Props for {@link ErrorMessage}. */
export interface ErrorMessageProps {
  /** The error to display. Renders nothing when `null`. */
  readonly error: Error | null;
  /** Override the default title derived from the error category. */
  readonly title?: string;
  /**
   * Callback to retry the failed operation.
   * Shows a "Retry" button when provided **and** the error is retryable
   * (server or unavailable category).
   */
  readonly retry?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
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

/**
 * Inline error display that classifies errors and renders a
 * category-appropriate message with optional retry and expandable
 * technical details (RPC method and path).
 *
 * Uses `classifyError()`, `getUserMessage()`, `getRpcMetadata()`, and
 * `isRetryableError()` from `@stigmer/sdk` to provide structured,
 * user-friendly error rendering.
 *
 * All visual properties flow through `--stgm-*` design tokens. No
 * Console-specific dependencies — safe for platform builder embedding.
 *
 * @example
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
  const isShield = category === "auth" || category === "permission";

  return (
    <div
      role="alert"
      className={cn(
        "bg-destructive-subtle border-destructive/20 text-destructive rounded-lg border p-4",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        {isShield ? (
          <ShieldXIcon className="mt-0.5 size-4 shrink-0" />
        ) : (
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
        )}

        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium">
            {title ?? CATEGORY_TITLES[category]}
          </p>
          <p className="text-destructive-muted text-sm">{message}</p>

          {metadata && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setDetailsOpen((prev) => !prev)}
                className="text-destructive-muted hover:text-destructive-muted inline-flex items-center gap-1 text-xs transition-colors"
              >
                <ChevronDownIcon
                  className={cn(
                    "size-3 transition-transform",
                    detailsOpen && "rotate-180",
                  )}
                />
                Technical details
              </button>
              {detailsOpen && (
                <dl className="text-destructive-muted mt-1.5 space-y-0.5 font-mono text-xs">
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
          <button
            type="button"
            onClick={retry}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium",
              "border-destructive/20 text-destructive hover:bg-destructive-subtle",
              "transition-colors",
            )}
          >
            <RotateCcwIcon className="size-3" />
            Retry
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons (inline SVGs — SDK components avoid icon library dependencies)
// ---------------------------------------------------------------------------

function AlertTriangleIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.5 9.5A1 1 0 0 1 13.5 13.5h-11a1 1 0 0 1-.87-1.5l5.5-9.5z" />
      <path d="M8 6v3" />
      <circle cx="8" cy="11" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

function ShieldXIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M8 1.5l5 2v4c0 3.5-2.5 5.5-5 6.5-2.5-1-5-3-5-6.5v-4l5-2z" />
      <path d="M6 6.5l4 4M10 6.5l-4 4" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function RotateCcwIcon({ className }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2 6.5h4v-4" />
      <path d="M3.5 11.5a5.5 5.5 0 1 0 .5-6l-2 1" />
    </svg>
  );
}
