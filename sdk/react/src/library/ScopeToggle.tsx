"use client";

import { useId } from "react";
import { cn } from "@stigmer/theme";
import type { ResourceListScope } from "../search";

/** Props for {@link ScopeToggle}. */
export interface ScopeToggleProps {
  /** The currently selected scope. */
  readonly value: ResourceListScope;
  /** Called when the user selects a different scope. */
  readonly onChange: (scope: ResourceListScope) => void;
  /** Disables all interaction. */
  readonly disabled?: boolean;
  /** Additional CSS classes applied to the root element. */
  readonly className?: string;
}

/**
 * Checkbox toggle for including public/community resources alongside
 * the current organization's resources.
 *
 * Unchecked (default) = "org" scope — only the active org's resources.
 * Checked = "all" scope — org resources plus public community resources.
 *
 * Designed for use in Library list toolbars alongside a search input.
 * The component is controlled — the consumer owns the `value` state
 * and handles persistence (e.g., localStorage).
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * const [scope, setScope] = useState<ResourceListScope>("org");
 *
 * <ScopeToggle value={scope} onChange={setScope} />
 * ```
 *
 * @see {@link ResourceListScope} for the type used by data hooks
 * @see {@link useAgentList}, {@link useSkillList}, {@link useMcpServerList}
 */
export function ScopeToggle({
  value,
  onChange,
  disabled = false,
  className,
}: ScopeToggleProps) {
  const id = useId();
  const checked = value === "all";

  return (
    <label
      htmlFor={id}
      className={cn(
        "inline-flex cursor-pointer select-none items-center gap-1.5 text-xs text-muted-foreground",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(checked ? "org" : "all")}
        className={cn(
          "h-3.5 w-3.5 cursor-pointer rounded border-input accent-primary",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        )}
      />
      Include public
    </label>
  );
}
