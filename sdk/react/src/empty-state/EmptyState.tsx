"use client";

import { cn } from "@stigmer/theme";
import { useEmptyState } from "./useEmptyState.js";
import type { EmptyStateProps } from "./types.js";

/**
 * A semantic, accessible empty state component supporting four distinct
 * variants: first-use, zero-results, permission, and error.
 *
 * Each variant provides appropriate default icons, copy, and ARIA roles.
 * All defaults can be overridden via props. The `icon` prop accepts any
 * ReactNode for full visual customization.
 *
 * @example
 * ```tsx
 * <EmptyState
 *   variant="first-use"
 *   resourceLabel="agents"
 *   action={{ label: "Create agent", onClick: handleCreate }}
 * />
 * ```
 *
 * @example
 * ```tsx
 * <EmptyState
 *   variant="error"
 *   errorMessage="Network request failed"
 *   action={{ label: "Retry", onClick: handleRetry }}
 * />
 * ```
 */
export function EmptyState({
  variant,
  resourceLabel,
  icon,
  title,
  description,
  errorMessage,
  action,
  children,
  className,
}: EmptyStateProps) {
  const resolved = useEmptyState({
    variant,
    resourceLabel,
    title,
    description,
    errorMessage,
  });

  return (
    <div
      role={resolved.role}
      className={cn(
        "flex flex-col items-center gap-3 py-12 text-center",
        className,
      )}
    >
      <div className="text-muted-foreground-faint">
        {icon ?? resolved.defaultIcon}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium text-muted-foreground">
          {resolved.title}
        </p>
        <p className="max-w-sm text-xs text-muted-foreground-subtle">
          {resolved.description}
        </p>
      </div>
      {children
        ? <div className="mt-1">{children}</div>
        : action && (
          <button
            type="button"
            onClick={action.onClick}
            className={cn(
              "mt-1 inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium",
              variant === "error"
                ? "border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground"
                : "bg-primary text-primary-foreground hover:bg-primary-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
          >
            {action.label}
          </button>
        )}
    </div>
  );
}
