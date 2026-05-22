"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

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

const OPTIONS: readonly {
  readonly value: ApiResourceVisibility;
  readonly label: string;
  readonly description: string;
}[] = [
  {
    value: ApiResourceVisibility.visibility_private,
    label: "Private",
    description: "Only you can access",
  },
  {
    value: ApiResourceVisibility.visibility_org,
    label: "Organization",
    description: "All org members can view executions",
  },
  {
    value: ApiResourceVisibility.visibility_public,
    label: "Public",
    description: "All authenticated users can view",
  },
];

/**
 * Three-state visibility selector for instances (AgentInstance,
 * WorkflowInstance).
 *
 * Unlike the binary {@link VisibilityToggle} used for blueprints,
 * instances support the full visibility spectrum: Private, Organization,
 * and Public. Escalating visibility (private -> org, or any -> public)
 * shows an inline confirmation prompt since expanding access is
 * consequential.
 *
 * For workflow instances, ORG visibility has cascading effects:
 * all org members automatically see all executions via FGA
 * inheritance (zero per-execution tuples needed).
 *
 * WAI-ARIA Radio Group with roving tabindex. All visual properties
 * flow through `--stgm-*` design tokens.
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
  const [confirming, setConfirming] = useState<ApiResourceVisibility | null>(
    null,
  );
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const effectivelyDisabled = disabled || isPending;

  const isEscalation = useCallback(
    (target: ApiResourceVisibility) => {
      const order = [
        ApiResourceVisibility.visibility_private,
        ApiResourceVisibility.visibility_org,
        ApiResourceVisibility.visibility_public,
      ];
      return order.indexOf(target) > order.indexOf(visibility);
    },
    [visibility],
  );

  const handleSelect = useCallback(
    (value: ApiResourceVisibility) => {
      if (value === visibility) return;

      if (isEscalation(value)) {
        setConfirming(value);
        return;
      }

      onVisibilityChange(value);
    },
    [visibility, onVisibilityChange, isEscalation],
  );

  const confirmChange = useCallback(() => {
    if (confirming === null) return;
    setConfirming(null);
    onVisibilityChange(confirming);
  }, [confirming, onVisibilityChange]);

  const cancelConfirm = useCallback(() => {
    setConfirming(null);
  }, []);

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

  const confirmingOption = confirming
    ? OPTIONS.find((o) => o.value === confirming)
    : null;

  return (
    <div className={cn("inline-flex flex-col gap-1.5", className)}>
      <div
        role="radiogroup"
        aria-label="Instance visibility"
        aria-disabled={effectivelyDisabled || undefined}
        className={cn(
          "inline-flex rounded-md bg-muted p-0.5",
          effectivelyDisabled && "pointer-events-none opacity-50",
        )}
      >
        {OPTIONS.map((option, index) => {
          const isSelected = visibility === option.value;

          return (
            <button
              key={option.value}
              ref={(el) => {
                optionRefs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isSelected}
              aria-label={`${option.label}: ${option.description}`}
              tabIndex={isSelected ? 0 : -1}
              disabled={effectivelyDisabled}
              onClick={() => handleSelect(option.value)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded-sm px-2.5 py-1 text-xs font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected
                  ? getSelectedStyle(option.value)
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {isPending && isSelected ? (
                <span
                  className="inline-block size-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                  aria-hidden="true"
                />
              ) : (
                getIcon(option.value)
              )}
              {option.label}
            </button>
          );
        })}
      </div>

      {/* Description of current state */}
      {!confirming && (
        <p className="text-[0.65rem] text-muted-foreground">
          {OPTIONS.find((o) => o.value === visibility)?.description}
        </p>
      )}

      {/* Confirmation prompt for escalation */}
      {confirming !== null && confirmingOption && (
        <div
          className={cn(
            "flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs",
            confirming === ApiResourceVisibility.visibility_public
              ? "border-amber-200 bg-amber-50 dark:border-amber-800/50 dark:bg-amber-950/30"
              : "border-blue-200 bg-blue-50 dark:border-blue-800/50 dark:bg-blue-950/30",
          )}
          role="alert"
        >
          <span
            className={cn(
              confirming === ApiResourceVisibility.visibility_public
                ? "text-amber-800 dark:text-amber-200"
                : "text-blue-800 dark:text-blue-200",
            )}
          >
            {confirming === ApiResourceVisibility.visibility_public
              ? "Make visible to all authenticated users?"
              : "Make visible to all org members?"}
          </span>
          <button
            type="button"
            onClick={confirmChange}
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium text-white",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              confirming === ApiResourceVisibility.visibility_public
                ? "bg-amber-600 hover:bg-amber-700 dark:bg-amber-600 dark:hover:bg-amber-500"
                : "bg-blue-600 hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500",
            )}
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={cancelConfirm}
            className={cn(
              "rounded px-2 py-0.5 text-xs font-medium",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              confirming === ApiResourceVisibility.visibility_public
                ? "text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-100"
                : "text-blue-700 hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100",
            )}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSelectedStyle(value: ApiResourceVisibility): string {
  switch (value) {
    case ApiResourceVisibility.visibility_private:
      return "bg-amber-50 text-amber-800 shadow-sm dark:bg-amber-900/30 dark:text-amber-300";
    case ApiResourceVisibility.visibility_org:
      return "bg-blue-100 text-blue-800 shadow-sm dark:bg-blue-900/40 dark:text-blue-300";
    case ApiResourceVisibility.visibility_public:
      return "bg-emerald-100 text-emerald-800 shadow-sm dark:bg-emerald-900/40 dark:text-emerald-300";
    default:
      return "bg-background text-foreground shadow-sm";
  }
}

function getIcon(value: ApiResourceVisibility) {
  switch (value) {
    case ApiResourceVisibility.visibility_private:
      return <LockIcon className="size-3" />;
    case ApiResourceVisibility.visibility_org:
      return <UsersIcon className="size-3" />;
    case ApiResourceVisibility.visibility_public:
      return <GlobeIcon className="size-3" />;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function LockIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="7" width="9" height="7" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

function UsersIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="5" r="2.5" />
      <path d="M2 13c0-2.21 1.79-4 4-4s4 1.79 4 4" />
      <circle cx="11.5" cy="5.5" r="2" />
      <path d="M14 13c0-1.66-1.12-3-2.5-3-.5 0-1 .14-1.4.4" />
    </svg>
  );
}

function GlobeIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12" />
      <path d="M8 2c1.66 1.46 2.6 3.63 2.6 6s-.94 4.54-2.6 6c-1.66-1.46-2.6-3.63-2.6-6s.94-4.54 2.6-6Z" />
    </svg>
  );
}
