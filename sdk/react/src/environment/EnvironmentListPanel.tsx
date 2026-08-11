"use client";

import { useCallback, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import type { Environment } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ResourceVisibilityControl } from "../library/ResourceVisibilityControl.js";
import { EditResourceYamlDialog } from "../manifest/EditResourceYamlDialog.js";
import { useEnvironmentList } from "./useEnvironmentList.js";
import { EnvironmentVariableEditor } from "./EnvironmentVariableEditor.js";
import { isShareRestrictedEnvironment } from "./shareRestriction.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link EnvironmentListPanel}. */
export interface EnvironmentListPanelProps {
  /** Organization slug to list environments for. */
  readonly org: string;
  /** Optional label filter — only environments matching ALL labels are shown. */
  readonly labels?: Record<string, string>;
  /**
   * Exclude environments whose labels match one or more label sets.
   *
   * A single record uses AND semantics — the environment must match
   * **all** key-value pairs to be excluded. Pass an array of records
   * for OR-of-AND semantics: the environment is excluded when **any**
   * record fully matches.
   *
   * @example
   * ```tsx
   * // Exclude personal envs only (single record — backward-compatible)
   * excludeLabels={{ "stigmer.ai/personal": "true" }}
   *
   * // Exclude personal AND managed envs (array of records)
   * excludeLabels={[
   *   { "stigmer.ai/personal": "true" },
   *   { "stigmer.ai/managed": "true" },
   * ]}
   * ```
   */
  readonly excludeLabels?: Record<string, string> | Record<string, string>[];
  /** Fired when a user selects (expands) an environment. */
  readonly onEnvironmentSelect?: (env: Environment) => void;
  /** When `true`, variable editors render in read-only mode. */
  readonly readOnly?: boolean;
  /** Re-expose refetch so parents can trigger a list refresh. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  /** Additional CSS class names for the root container. */
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
 * Part of the **Environment Flow** — manages persistent credentials
 * stored in Environment resources.
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
  const [yamlEnvironment, setYamlEnvironment] = useState<Environment | null>(null);

  if (onRefetchRef) {
    onRefetchRef(refetch);
  }

  const filtered = useMemo(() => {
    if (!excludeLabels) return environments;
    const labelSets = Array.isArray(excludeLabels)
      ? excludeLabels
      : [excludeLabels];
    if (labelSets.length === 0) return environments;

    return environments.filter((env) => {
      const envLabels = env.metadata?.labels ?? {};
      const shouldExclude = labelSets.some((labelSet) =>
        Object.entries(labelSet).every(([k, v]) => envLabels[k] === v),
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
        className={cn("stg:space-y-2", className)}
        aria-busy="true"
        aria-label="Loading environments"
      >
        {Array.from({ length: 2 }, (_, i) => (
          <div
            key={i}
            className="stg:bg-muted-subtle stg:h-14 stg:animate-pulse stg:rounded-lg"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className={cn("stg:text-destructive stg:text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  if (filtered.length === 0) {
    return (
      <p className={cn("stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs", className)}>
        No environments found.
      </p>
    );
  }

  return (
    <div
      className={cn("stg:space-y-2", className)}
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
            onVisibilityChanged={refetch}
            onEditYaml={() => setYamlEnvironment(env)}
          />
        );
      })}
      <EditResourceYamlDialog
        open={yamlEnvironment !== null}
        onOpenChange={(open) => {
          if (!open) setYamlEnvironment(null);
        }}
        resource={yamlEnvironment}
        onApplied={refetch}
      />
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
  onVisibilityChanged,
  onEditYaml,
}: {
  environment: Environment;
  isExpanded: boolean;
  onToggle: () => void;
  readOnly: boolean;
  onVisibilityChanged: () => void;
  onEditYaml: () => void;
}) {
  const name =
    environment.metadata?.name || environment.metadata?.slug || "Unnamed";
  const description = environment.spec?.description;
  const variableCount = Object.keys(environment.spec?.data ?? {}).length;
  const environmentId = environment.metadata?.id ?? "";

  // Personal and OAuth-managed environments are never org-shareable
  // (the backend rejects the transition) — offering the control would
  // be an error trap, so it is structurally absent for them.
  const showVisibilityControl =
    !readOnly && environmentId !== "" && !isShareRestrictedEnvironment(environment);

  return (
    <div
      role="listitem"
      className={cn(
        "stg:rounded-lg stg:border stg:transition-colors",
        isExpanded
          ? "stg:border-border stg:bg-card"
          : "stg:border-border-muted stg:hover:border-border",
      )}
    >
      {/* Header — always visible. The expand toggle and the visibility
          control are sibling interactive elements (nesting the selector
          inside the toggle button would be invalid markup). */}
      <div className="stg:flex stg:w-full stg:items-center stg:gap-3 stg:px-3 stg:py-2.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isExpanded}
          className="stg:flex stg:min-w-0 stg:flex-1 stg:items-center stg:gap-3 stg:text-left"
        >
          <ChevronIcon expanded={isExpanded} />

          <div className="stg:min-w-0 stg:flex-1">
            <span className="stg:block stg:truncate stg:text-sm stg:font-medium stg:text-foreground">
              {name}
            </span>
            {description && (
              <span className="stg:block stg:truncate stg:text-xs stg:text-muted-foreground">
                {description}
              </span>
            )}
          </div>
        </button>

        {!readOnly && (
          <button
            type="button"
            onClick={onEditYaml}
            aria-label={`Edit ${name} as YAML`}
            className="stg:shrink-0 stg:rounded stg:px-1.5 stg:py-0.5 stg:text-xs stg:text-muted-foreground stg:transition-colors stg:hover:bg-accent stg:hover:text-accent-foreground stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
          >
            Edit YAML
          </button>
        )}

        {showVisibilityControl && (
          <ResourceVisibilityControl
            kind="environment"
            resourceId={environmentId}
            visibility={
              environment.metadata?.visibility ??
              ApiResourceVisibility.visibility_private
            }
            onChanged={onVisibilityChanged}
            className="stg:shrink-0"
          />
        )}

        <span className="stg:shrink-0 stg:text-xs stg:text-muted-foreground">
          {variableCount} {variableCount === 1 ? "variable" : "variables"}
        </span>
      </div>

      {/* Expanded content — variable editor */}
      {isExpanded && environmentId && (
        <div className="stg:border-border-muted stg:border-t stg:px-3 stg:pb-3 stg:pt-2">
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
        "stg:shrink-0 stg:text-muted-foreground stg:transition-transform stg:duration-150",
        expanded && "stg:rotate-90",
      )}
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}
