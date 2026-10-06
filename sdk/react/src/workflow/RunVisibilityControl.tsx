"use client";

/**
 * The control for a workflow's run visibility: whether every run of the
 * workflow, past runs included, is visible only to the person who started
 * it or to everyone in the workflow's organization.
 *
 * It is a separate axis from the workflow's own visibility. Letting the
 * organization see and run a workflow never exposes anyone's runs; this
 * setting does, and it reaches runs already finished as well as future
 * ones, so the copy says so. Writes go through
 * {@link useUpdateWorkflowRunVisibility}; the server refuses anyone
 * without `can_manage_audience`, and the workflow page offers the control
 * only to those who hold it. `unspecified` reads as private (the default).
 *
 * Pinned by `__tests__/RunVisibilityControl.test.tsx`.
 */

import { useCallback } from "react";
import { cn } from "@stigmer/theme";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { WorkflowRunVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { getUserMessage } from "@stigmer/sdk";
import { useUpdateWorkflowRunVisibility } from "./useUpdateWorkflowRunVisibility.js";

/** Props for {@link RunVisibilityControl}. */
export interface RunVisibilityControlProps {
  /** Id of the workflow whose run visibility is edited. */
  readonly workflowId: string;
  /** Current `run_visibility` from the workflow spec. */
  readonly runVisibility: WorkflowRunVisibility;
  /** Called with the updated workflow after a successful change, so the host can refresh its copy. */
  readonly onChanged?: (workflow: Workflow) => void;
}

interface RunVisibilityOption {
  readonly value: WorkflowRunVisibility;
  readonly label: string;
  readonly description: string;
}

const RUN_VISIBILITY_OPTIONS: readonly RunVisibilityOption[] = [
  {
    value: WorkflowRunVisibility.private,
    label: "Only the person who runs it",
    description:
      "Each run, past and future, is visible only to whoever started it (and anyone it is shared with).",
  },
  {
    value: WorkflowRunVisibility.organization,
    label: "All organization members",
    description:
      "Everyone in the organization can see every run of this workflow, past runs included, with its input and output.",
  },
];

/**
 * Segmented control for who can see the runs of a workflow. Render it only
 * for someone who may change the workflow's audience (`can_manage_audience`).
 *
 * @example
 * ```tsx
 * <RunVisibilityControl
 *   workflowId={workflow.metadata.id}
 *   executionVisibility={workflow.spec.executionVisibility}
 *   onChanged={refetch}
 * />
 * ```
 */
export function RunVisibilityControl({
  workflowId,
  runVisibility: executionVisibility,
  onChanged,
}: RunVisibilityControlProps) {
  const { updateRunVisibility, isUpdating, error } =
    useUpdateWorkflowRunVisibility();

  const current =
    executionVisibility === WorkflowRunVisibility.unspecified
      ? WorkflowRunVisibility.private
      : executionVisibility;

  const handleSelect = useCallback(
    async (value: WorkflowRunVisibility) => {
      if (value === current || isUpdating) return;
      try {
        const updated = await updateRunVisibility(workflowId, value);
        onChanged?.(updated);
      } catch {
        // The hook's error state renders below.
      }
    },
    [current, isUpdating, updateRunVisibility, workflowId, onChanged],
  );

  return (
    <div className="stg:space-y-2">
      <div
        role="radiogroup"
        aria-label="Run visibility"
        className="stg:flex stg:flex-col stg:gap-1.5"
      >
        {RUN_VISIBILITY_OPTIONS.map((option) => {
          const selected = option.value === current;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={isUpdating}
              onClick={() => handleSelect(option.value)}
              className={cn(
                "stg:flex stg:flex-col stg:items-start stg:gap-0.5 stg:rounded-md stg:border stg:px-3 stg:py-2 stg:text-left",
                "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
                "stg:disabled:opacity-60",
                selected
                  ? "stg:border-primary stg:bg-primary-subtle"
                  : "stg:border-border stg:hover:bg-accent-hover",
              )}
            >
              <span className="stg:text-xs stg:font-medium stg:text-foreground">{option.label}</span>
              <span className="stg:text-[0.65rem] stg:text-muted-foreground">{option.description}</span>
            </button>
          );
        })}
      </div>
      {error && (
        <p className="stg:text-xs stg:text-destructive" role="alert">
          {getUserMessage(error)}
        </p>
      )}
    </div>
  );
}
