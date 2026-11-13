"use client";

import { cn } from "@stigmer/design-tokens";
import { Button } from "../button/Button.js";
import { useEmptyState } from "./useEmptyState.js";
import type { EmptyStateProps } from "./types.js";

/**
 * A semantic, accessible empty state component supporting four distinct
 * variants: first-use, zero-results, permission, and error.
 *
 * It says what's next and carries the act: on its own faint card, an icon
 * in a muted square, the title in the foreground, one line on what to do,
 * and the screen's one button. `size="inline"` draws one line inside a
 * card or a list that has nothing in it.
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
 *   action={{ label: "Try again", onClick: handleRetry }}
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
  query,
  size = "panel",
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
    query,
  });

  const act = children ?? (action && (
    <Button variant="primary" size={size === "inline" ? "xs" : "sm"} icon={action.icon} onClick={action.onClick}>
      {action.label}
    </Button>
  ));

  if (size === "inline") {
    return (
      <div
        role={resolved.role}
        className={cn("stg:flex stg:flex-wrap stg:items-center stg:gap-x-2 stg:gap-y-1 stg:px-3.5 stg:py-2.5 stg:text-sm stg:text-muted-foreground", className)}
      >
        <p className="stg:m-0">
          <span className="stg:text-foreground">{resolved.title}</span>
          {resolved.description !== "" && <> {resolved.description}</>}
        </p>
        {act && <div className="stg:ml-auto stg:flex stg:items-center stg:gap-2">{act}</div>}
      </div>
    );
  }

  return (
    <div
      role={resolved.role}
      className={cn(
        "stg:flex stg:flex-col stg:items-center stg:rounded-xl stg:border stg:border-border stg:bg-muted-faint stg:px-6 stg:py-10 stg:text-center",
        className,
      )}
    >
      <div className="stg:mb-3 stg:grid stg:size-10 stg:place-items-center stg:rounded-xl stg:bg-muted stg:text-foreground stg:[&_svg]:size-5" aria-hidden="true">
        {icon ?? resolved.defaultIcon}
      </div>
      <p className="stg:m-0 stg:text-sm stg:font-semibold stg:text-foreground">{resolved.title}</p>
      {resolved.description !== "" && (
        <p className="stg:m-0 stg:mt-1 stg:max-w-md stg:text-sm stg:text-muted-foreground">{resolved.description}</p>
      )}
      {act && <div className="stg:mt-4 stg:flex stg:flex-wrap stg:justify-center stg:gap-2">{act}</div>}
    </div>
  );
}
