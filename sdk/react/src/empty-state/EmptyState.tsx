"use client";

import { cn } from "@stigmer/theme";
import { Button } from "../button/Button.js";
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
        "stg:flex stg:flex-col stg:items-center stg:gap-3 stg:py-12 stg:text-center",
        className,
      )}
    >
      <div className="stg:text-muted-foreground-faint">
        {icon ?? resolved.defaultIcon}
      </div>
      <div className="stg:flex stg:flex-col stg:gap-1">
        <p className="stg:text-sm stg:font-medium stg:text-muted-foreground">
          {resolved.title}
        </p>
        <p className="stg:max-w-sm stg:text-xs stg:text-muted-foreground-subtle">
          {resolved.description}
        </p>
      </div>
      {children
        ? <div className="stg:mt-1">{children}</div>
        : action && (
          <Button
            // A retry after an error is a recovery affordance, not the
            // view's call to action — outline keeps it appropriately quiet.
            variant={variant === "error" ? "outline" : "primary"}
            icon={action.icon}
            onClick={action.onClick}
            className="stg:mt-1"
          >
            {action.label}
          </Button>
        )}
    </div>
  );
}
