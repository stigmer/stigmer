import { useMemo, createElement } from "react";
import { Package, SearchX, Lock, AlertCircle } from "lucide-react";
import type { UseEmptyStateOptions, UseEmptyStateReturn } from "./types.js";

const ICON_CLASSES = "stg:size-5";

function resolveDefaults(
  variant: UseEmptyStateOptions["variant"],
  resourceLabel: string,
  query: string | undefined,
): { title: string; description: string } {
  switch (variant) {
    case "first-use":
      return {
        title: `No ${resourceLabel} yet`,
        description: `Create ${resourceLabel === "agents" ? "an agent" : `a ${resourceLabel.replace(/s$/, "")}`} to get started.`,
      };
    case "zero-results":
      return {
        title: query ? `Nothing matches \u201c${query}\u201d` : "Nothing matches your search",
        description: `Check the spelling, or clear the search to see every ${resourceLabel === "resources" ? "item" : resourceLabel.replace(/s$/, "")}.`,
      };
    case "permission":
      return {
        title: `Only an admin can open ${resourceLabel}`,
        description: "Ask an admin of this organization for access.",
      };
    case "error":
      return {
        title: "Couldn't load this.",
        description: "Try again in a moment.",
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
  const { variant, resourceLabel = "resources", title, description, errorMessage, query } = options;

  return useMemo(() => {
    const defaults = resolveDefaults(variant, resourceLabel, query);
    return {
      title: title ?? defaults.title,
      description:
        variant === "error" && errorMessage
          ? errorMessage
          : (description ?? defaults.description),
      defaultIcon: resolveIcon(variant),
      role: resolveRole(variant),
    };
  }, [variant, resourceLabel, title, description, errorMessage, query]);
}
