"use client";

import { useCallback, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { useEnvironmentList } from "./useEnvironmentList";
import { EnvironmentVariableEditor } from "./EnvironmentVariableEditor";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface EnvironmentListPanelProps {
  /** Organization slug to list environments for. */
  readonly org: string;
  /** Optional label filter — only environments matching ALL labels are shown. */
  readonly labels?: Record<string, string>;
  /**
   * Exclude environments whose labels contain all key-value pairs in this
   * record. Useful for filtering the personal environment out of the
   * shared list: `excludeLabels={{ "stigmer.ai/personal": "true" }}`.
   */
  readonly excludeLabels?: Record<string, string>;
  /** Fired when a user selects (expands) an environment. */
  readonly onEnvironmentSelect?: (env: Environment) => void;
  /** When `true`, variable editors render in read-only mode. */
  readonly readOnly?: boolean;
  /** Re-expose refetch so parents can trigger a list refresh. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  readonly className?: string;
}

/**
 * Displays a list of {@link Environment} resources for an organization
 * with expandable inline variable editors.
 *
 * Each environment is rendered as a collapsible card showing name,
 * description, and variable count. Clicking expands it to reveal a
 * full {@link EnvironmentVariableEditor}. Only one environment is
 * expanded at a time to keep the view focused.
 *
 * Use `labels` to include only matching environments, or
 * `excludeLabels` to remove specific ones from the list (e.g. exclude
 * the personal environment when it is already rendered separately).
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <EnvironmentListPanel org="acme" />
 *
 * <EnvironmentListPanel
 *   org="acme"
 *   excludeLabels={{ "stigmer.ai/personal": "true" }}
 *   readOnly
 * />
 * ```
 */
export function EnvironmentListPanel({
  org,
  labels,
  excludeLabels,
  onEnvironmentSelect,
  readOnly = false,
  onRefetchRef,
  className,
}: EnvironmentListPanelProps) {
  const { environments, isLoading, error, refetch } = useEnvironmentList(
    org,
    labels,
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (onRefetchRef) {
    onRefetchRef(refetch);
  }

  const filtered = useMemo(() => {
    if (!excludeLabels || Object.keys(excludeLabels).length === 0) {
      return environments;
    }
    return environments.filter((env) => {
      const envLabels = env.metadata?.labels ?? {};
      const shouldExclude = Object.entries(excludeLabels).every(
        ([k, v]) => envLabels[k] === v,
      );
      return !shouldExclude;
    });
  }, [environments, excludeLabels]);

  const handleToggle = useCallback(
    (env: Environment) => {
      const id = env.metadata?.id ?? "";
      if (expandedId === id) {
        setExpandedId(null);
      } else {
        setExpandedId(id);
        onEnvironmentSelect?.(env);
      }
    },
    [expandedId, onEnvironmentSelect],
  );

  if (isLoading) {
    return (
      <div
        className={cn("space-y-2", className)}
        aria-busy="true"
        aria-label="Loading environments"
      >
        {Array.from({ length: 2 }, (_, i) => (
          <div
            key={i}
            className="bg-muted/40 h-14 animate-pulse rounded-lg"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className={cn("text-destructive text-xs", className)} role="alert">
        {error}
      </p>
    );
  }

  if (filtered.length === 0) {
    return (
      <p className={cn("text-muted-foreground py-4 text-center text-xs", className)}>
        No environments found.
      </p>
    );
  }

  return (
    <div
      className={cn("space-y-2", className)}
      role="list"
      aria-label="Environments"
    >
      {filtered.map((env) => {
        const id = env.metadata?.id ?? "";
        const isExpanded = expandedId === id;

        return (
          <EnvironmentCard
            key={id}
            environment={env}
            isExpanded={isExpanded}
            onToggle={() => handleToggle(env)}
            readOnly={readOnly}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EnvironmentCard (internal)
// ---------------------------------------------------------------------------

function EnvironmentCard({
  environment,
  isExpanded,
  onToggle,
  readOnly,
}: {
  environment: Environment;
  isExpanded: boolean;
  onToggle: () => void;
  readOnly: boolean;
}) {
  const name =
    environment.metadata?.name || environment.metadata?.slug || "Unnamed";
  const description = environment.spec?.description;
  const variableCount = Object.keys(environment.spec?.data ?? {}).length;
  const environmentId = environment.metadata?.id ?? "";

  return (
    <div
      role="listitem"
      className={cn(
        "rounded-lg border transition-colors",
        isExpanded
          ? "border-border bg-card"
          : "border-border/60 hover:border-border",
      )}
    >
      {/* Header — always visible */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      >
        <ChevronIcon expanded={isExpanded} />

        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {name}
          </span>
          {description && (
            <span className="block truncate text-xs text-muted-foreground">
              {description}
            </span>
          )}
        </div>

        <span className="shrink-0 text-xs text-muted-foreground">
          {variableCount} {variableCount === 1 ? "variable" : "variables"}
        </span>
      </button>

      {/* Expanded content — variable editor */}
      {isExpanded && environmentId && (
        <div className="border-border/60 border-t px-3 pb-3 pt-2">
          <EnvironmentVariableEditor
            environmentId={environmentId}
            readOnly={readOnly}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn(
        "shrink-0 text-muted-foreground transition-transform duration-150",
        expanded && "rotate-90",
      )}
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}
