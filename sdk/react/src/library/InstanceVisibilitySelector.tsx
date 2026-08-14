"use client";

import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import {
  VisibilitySelector,
  type VisibilitySelectorMode,
} from "./VisibilitySelector.js";
import { useCanSetPublicVisibility } from "./useCanSetPublicVisibility.js";
import { instanceVisibilityLevels } from "./visibilityLevels.js";

/** Props for {@link InstanceVisibilitySelector}. */
export interface InstanceVisibilitySelectorProps {
  /** Current visibility of the instance. */
  readonly visibility: ApiResourceVisibility;
  /**
   * Called when the user selects (and, for escalations in `"manage"` mode,
   * confirms) a visibility change. Escalating to Organization shows a light
   * inline confirm; escalating to Public opens a blocking confirm dialog.
   */
  readonly onVisibilityChange: (v: ApiResourceVisibility) => void;
  /**
   * Presentation + confirmation mode, forwarded to {@link VisibilitySelector}.
   * Use `"create"` when picking an initial value inside a create dialog
   * (inline list, applies immediately); defaults to `"manage"` (popover with
   * escalation confirmation) for live instances.
   */
  readonly mode?: VisibilitySelectorMode;
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
 * For live instances, prefer {@link ResourceVisibilityControl} (which adds
 * the read-only {@link VisibilityBadge} fallback for non-editors). This thin
 * preset is used directly when picking an initial value inside a create
 * dialog, where `mode="create"` renders an inline list instead of a popover
 * (a portaled popover would stack beneath a native `<dialog>`'s top layer).
 *
 * @example
 * ```tsx
 * const [visibility, setVisibility] = useState(
 *   ApiResourceVisibility.visibility_private,
 * );
 *
 * <InstanceVisibilitySelector
 *   mode="create"
 *   visibility={visibility}
 *   onVisibilityChange={setVisibility}
 * />
 * ```
 */
export function InstanceVisibilitySelector({
  visibility,
  onVisibilityChange,
  mode,
  isPending = false,
  disabled = false,
  className,
}: InstanceVisibilitySelectorProps) {
  // Public is operator-granted in the cloud edition; the hook resolves the
  // caller's grant here so every consumer (create dialogs, list rows) gets
  // the locked Public row without wiring anything.
  const canSetPublic = useCanSetPublicVisibility();
  return (
    <VisibilitySelector
      visibility={visibility}
      options={instanceVisibilityLevels({
        canSetPublicVisibility: canSetPublic.allowed,
      })}
      onVisibilityChange={onVisibilityChange}
      mode={mode}
      isPending={isPending}
      disabled={disabled}
      ariaLabel="Instance visibility"
      className={className}
    />
  );
}
