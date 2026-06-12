"use client";

import { useCallback } from "react";
import { cn } from "@stigmer/theme";
import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/spec_pb";
import { getUserMessage } from "@stigmer/sdk";
import { useUpdateWorkflowInstanceExecutionVisibility } from "./useUpdateWorkflowInstanceExecutionVisibility";

/** Props for {@link RunVisibilityControl}. */
export interface RunVisibilityControlProps {
  /** Id of the workflow instance whose run visibility is edited. */
  readonly instanceId: string;
  /** Current `execution_visibility` from the instance spec. */
  readonly executionVisibility: WorkflowExecutionVisibility;
  /** Called after a successful change so the host can refresh the instance. */
  readonly onChanged?: () => void;
}

interface RunVisibilityOption {
  readonly value: WorkflowExecutionVisibility;
  readonly label: string;
  readonly description: string;
}

const RUN_VISIBILITY_OPTIONS: readonly RunVisibilityOption[] = [
  {
    value: WorkflowExecutionVisibility.private,
    label: "Only the person who runs it",
    description: "Each run is visible only to whoever started it (and explicit shares).",
  },
  {
    value: WorkflowExecutionVisibility.organization,
    label: "All organization members",
    description: "Everyone in the organization can observe every run of this instance.",
  },
];

/**
 * Segmented control for an instance's run (execution) visibility — a separate
 * axis from the instance's own visibility: an owner can keep the instance
 * private while letting the whole org observe its runs.
 *
 * Writes the `execution_visibility` spec field via the dedicated RPC, which
 * reconciles the dormant `workflow_instance#execution_viewer` FGA relation in
 * Cloud mode. `unspecified` is treated as private (the default).
 *
 * Only meaningful while the instance itself is private; an ORG/PUBLIC instance
 * already exposes its runs to org members by inheritance, so callers should
 * render this only in the private case.
 */
export function RunVisibilityControl({
  instanceId,
  executionVisibility,
  onChanged,
}: RunVisibilityControlProps) {
  const { updateExecutionVisibility, isUpdating, error } =
    useUpdateWorkflowInstanceExecutionVisibility();

  const current =
    executionVisibility === WorkflowExecutionVisibility.unspecified
      ? WorkflowExecutionVisibility.private
      : executionVisibility;

  const handleSelect = useCallback(
    async (value: WorkflowExecutionVisibility) => {
      if (value === current || isUpdating) return;
      try {
        await updateExecutionVisibility(instanceId, value);
        onChanged?.();
      } catch {
        // error surfaced below
      }
    },
    [current, isUpdating, updateExecutionVisibility, instanceId, onChanged],
  );

  return (
    <div className="space-y-2">
      <div
        role="radiogroup"
        aria-label="Run visibility"
        className="flex flex-col gap-1.5"
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
                "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2 text-left",
                "focus:outline-none focus:ring-2 focus:ring-ring",
                "disabled:opacity-60",
                selected
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-accent-hover",
              )}
            >
              <span className="text-xs font-medium text-foreground">{option.label}</span>
              <span className="text-[0.65rem] text-muted-foreground">{option.description}</span>
            </button>
          );
        })}
      </div>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {getUserMessage(error)}
        </p>
      )}
    </div>
  );
}
