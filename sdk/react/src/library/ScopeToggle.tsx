"use client";

import { useCallback, useRef } from "react";
import { cn } from "@stigmer/theme";
import type { ResourceListScope } from "../search";

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

const SCOPE_OPTIONS: readonly {
  readonly value: ResourceListScope;
  readonly label: string;
}[] = [
  { value: "org", label: "Org" },
  { value: "all", label: "All" },
];

/**
 * Segmented control for toggling resource scope between "Org"
 * (only the current organization's resources) and "All"
 * (including public and platform resources).
 *
 * Designed for use in Library list headers alongside a search input.
 * The component is controlled — the consumer owns the `value` state
 * and handles persistence (e.g., localStorage).
 *
 * Implements the WAI-ARIA Radio Group pattern with roving tabindex
 * for keyboard navigation: Arrow Left/Right moves focus and selects,
 * Tab enters/exits the group.
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
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      let nextIndex: number | null = null;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        nextIndex = (index + 1) % SCOPE_OPTIONS.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        nextIndex =
          (index - 1 + SCOPE_OPTIONS.length) % SCOPE_OPTIONS.length;
      }

      if (nextIndex !== null) {
        optionRefs.current[nextIndex]?.focus();
        onChange(SCOPE_OPTIONS[nextIndex].value);
      }
    },
    [onChange],
  );

  return (
    <div
      role="radiogroup"
      aria-label="Resource scope"
      aria-disabled={disabled || undefined}
      className={cn(
        "inline-flex rounded-md bg-muted p-0.5",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      {SCOPE_OPTIONS.map((option, index) => {
        const isSelected = value === option.value;

        return (
          <button
            key={option.value}
            ref={(el) => {
              optionRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            tabIndex={isSelected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              "cursor-pointer rounded-sm px-3 py-1 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              isSelected
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
