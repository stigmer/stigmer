import { useMemo, createElement } from "react";
import { Package, SearchX, Lock, AlertCircle } from "lucide-react";
import type { UseEmptyStateOptions, UseEmptyStateReturn } from "./types.js";

const ICON_CLASSES = "stg:h-10 stg:w-10";

function resolveDefaults(
  variant: UseEmptyStateOptions["variant"],
  resourceLabel: string,
): { title: string; description: string } {
  switch (variant) {
    case "first-use":
      return {
        title: `No ${resourceLabel} yet`,
        description: `Create ${resourceLabel === "agents" ? "an agent" : `a ${resourceLabel.replace(/s$/, "")}`} to get started.`,
      };
    case "zero-results":
      return {
        title: "No results found",
        description: "Try adjusting your search or filters.",
      };
    case "permission":
      return {
        title: `No access to ${resourceLabel}`,
        description:
          "You don't have permission to view these resources. Contact your organization admin.",
      };
    case "error":
      return {
        title: "Something went wrong",
        description: "We couldn't load this content. Please try again.",
      };
  }
}

function resolveIcon(variant: UseEmptyStateOptions["variant"]) {
  switch (variant) {
    case "first-use":
      return createElement(Package, { className: ICON_CLASSES });
    case "zero-results":
      return createElement(SearchX, { className: ICON_CLASSES });
    case "permission":
      return createElement(Lock, { className: ICON_CLASSES });
    case "error":
      return createElement(AlertCircle, { className: ICON_CLASSES });
  }
}

function resolveRole(
  variant: UseEmptyStateOptions["variant"],
): "status" | "alert" {
  return variant === "error" ? "alert" : "status";
}

/**
 * Behavior hook that resolves empty state copy, icon, and accessibility
 * attributes based on the semantic variant and optional overrides.
 *
 * Use this hook when you want full rendering control but need the
 * variant-aware logic (default copy, icons, ARIA roles).
 *
 * @example
 * ```tsx
 * const { title, description, defaultIcon, role } = useEmptyState({
 *   variant: "first-use",
 *   resourceLabel: "agents",
 * });
 * ```
 */
export function useEmptyState(options: UseEmptyStateOptions): UseEmptyStateReturn {
  const { variant, resourceLabel = "resources", title, description, errorMessage } = options;

  return useMemo(() => {
    const defaults = resolveDefaults(variant, resourceLabel);
    return {
      title: title ?? defaults.title,
      description:
        variant === "error" && errorMessage
          ? errorMessage
          : (description ?? defaults.description),
      defaultIcon: resolveIcon(variant),
      role: resolveRole(variant),
    };
  }, [variant, resourceLabel, title, description, errorMessage]);
}
