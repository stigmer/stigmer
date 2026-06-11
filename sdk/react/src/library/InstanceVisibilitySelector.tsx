"use client";

import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { VisibilitySelector } from "./VisibilitySelector";
import { INSTANCE_VISIBILITY_LEVELS } from "./visibilityLevels";

/** Props for {@link InstanceVisibilitySelector}. */
export interface InstanceVisibilitySelectorProps {
  /** Current visibility of the instance. */
  readonly visibility: ApiResourceVisibility;
  /**
   * Called when the user confirms a visibility change.
   * Escalating visibility (to org or public) shows an inline confirmation.
   */
  readonly onVisibilityChange: (v: ApiResourceVisibility) => void;
  /** Shows a spinner/disabled state while the RPC is in flight. */
  readonly isPending?: boolean;
  /** Disables all interaction (e.g., when the user lacks can_edit). */
  readonly disabled?: boolean;
  /** Additional CSS classes applied to the root element. */
  readonly className?: string;
}

/**
 * Visibility selector for instances (AgentInstance, WorkflowInstance):
 * {@link VisibilitySelector} preconfigured with the instance level set
 * (Private / Organization / Public — platform is excluded by design to
 * preserve tenant isolation).
 *
 * For workflow instances, ORG visibility has cascading effects: all org
 * members automatically see all executions via FGA inheritance (zero
 * per-execution tuples needed).
 *
 * @example
 * ```tsx
 * const { updateVisibility, isPending } = useUpdateVisibility(
 *   "workflowInstance",
 *   instance.metadata.id,
 * );
 *
 * <InstanceVisibilitySelector
 *   visibility={instance.metadata.visibility}
 *   onVisibilityChange={updateVisibility}
 *   isPending={isPending}
 * />
 * ```
 */
export function InstanceVisibilitySelector({
  visibility,
  onVisibilityChange,
  isPending = false,
  disabled = false,
  className,
}: InstanceVisibilitySelectorProps) {
  return (
    <VisibilitySelector
      visibility={visibility}
      options={INSTANCE_VISIBILITY_LEVELS}
      onVisibilityChange={onVisibilityChange}
      isPending={isPending}
      disabled={disabled}
      ariaLabel="Instance visibility"
      className={className}
    />
  );
}
