"use client";

import { useCallback, useRef } from "react";
import { cn } from "@stigmer/theme";
import type { ResourceListScope } from "../search/index.js";

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
  /**
   * When true, renders icon-only buttons without text labels.
   * Useful inside space-constrained contexts like picker popovers.
   * Each button retains an accessible `aria-label`.
   */
  readonly compact?: boolean;
}

const OPTIONS: readonly {
  readonly value: ResourceListScope;
  readonly label: string;
  readonly ariaLabel: string;
  readonly icon: (props: { className?: string }) => React.JSX.Element;
}[] = [
  {
    value: "org",
    label: "Org",
    ariaLabel: "Organization only",
    icon: OrgIcon,
  },
  {
    value: "all",
    label: "All",
    ariaLabel: "All including public",
    icon: GlobeIcon,
  },
];

/**
 * Segmented control for switching resource list scope between
 * organization-only and all (including public community resources).
 *
 * Renders as a WAI-ARIA Radio Group with roving tabindex and
 * arrow-key navigation. Follows the same visual pattern as
 * {@link VisibilitySelector}.
 *
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
  compact = false,
}: ScopeToggleProps) {
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleSelect = useCallback(
    (next: ResourceListScope) => {
      if (next !== value) onChange(next);
    },
    [value, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      let nextIndex: number | null = null;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        nextIndex = (index + 1) % OPTIONS.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        nextIndex = (index - 1 + OPTIONS.length) % OPTIONS.length;
      }

      if (nextIndex !== null) {
        optionRefs.current[nextIndex]?.focus();
        handleSelect(OPTIONS[nextIndex].value);
      }
    },
    [handleSelect],
  );

  return (
    <div
      role="radiogroup"
      aria-label="Resource scope"
      aria-disabled={disabled || undefined}
      className={cn(
        "stg:inline-flex stg:rounded-md stg:bg-muted stg:p-0.5",
        disabled && "stg:pointer-events-none stg:opacity-50",
        className,
      )}
    >
      {OPTIONS.map((option, index) => {
        const isSelected = value === option.value;
        const Icon = option.icon;

        return (
          <button
            key={option.value}
            ref={(el) => {
              optionRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={option.ariaLabel}
            title={compact ? option.ariaLabel : undefined}
            tabIndex={isSelected ? 0 : -1}
            disabled={disabled}
            onClick={() => handleSelect(option.value)}
            onKeyDown={(e) => handleKeyDown(e, index)}
            className={cn(
              "stg:inline-flex stg:cursor-pointer stg:items-center stg:gap-1 stg:rounded-sm stg:px-2 stg:py-1 stg:text-xs stg:font-medium stg:transition-colors",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              isSelected
                ? "stg:bg-background stg:text-foreground stg:shadow-sm"
                : "stg:text-muted-foreground stg:hover:text-foreground",
            )}
          >
            <Icon className="stg:size-3" />
            {!compact && option.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons — inline SVGs following the SDK pattern (no icon library dependency)
// ---------------------------------------------------------------------------

function OrgIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="2" width="8" height="12" rx="1" />
      <path d="M6.5 5h3M6.5 8h3M6.5 11h3" />
    </svg>
  );
}

function GlobeIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12" />
      <path d="M8 2c1.66 1.46 2.6 3.63 2.6 6s-.94 4.54-2.6 6c-1.66-1.46-2.6-3.63-2.6-6s.94-4.54 2.6-6Z" />
    </svg>
  );
}
