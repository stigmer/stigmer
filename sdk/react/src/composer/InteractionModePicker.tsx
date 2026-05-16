"use client";

import { useCallback, useRef, type KeyboardEvent } from "react";

/**
 * Interaction mode options for agent executions.
 *
 * Maps to `InteractionMode` proto enum values (excluding UNSPECIFIED):
 * - `"agent"` → `INTERACTION_MODE_AGENT` (full tool access)
 * - `"plan"` → `INTERACTION_MODE_PLAN` (read-only analysis)
 */
export type InteractionModeOption = "agent" | "plan";

const OPTIONS: readonly InteractionModeOption[] = ["agent", "plan"];

const MODE_LABELS: Record<InteractionModeOption, string> = {
  agent: "Agent",
  plan: "Plan",
};

/** Props for {@link InteractionModePicker}. */
export interface InteractionModePickerProps {
  /** Currently selected interaction mode. */
  readonly value: InteractionModeOption;
  /** Called when the user picks a different mode. */
  readonly onValueChange: (mode: InteractionModeOption) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /** When true, disables the picker. */
  readonly disabled?: boolean;
}

/**
 * Compact segmented control for choosing the execution interaction mode.
 *
 * Renders two mutually exclusive options — "Agent" (full tool access) and
 * "Plan" (read-only analysis) — as adjacent pill segments.
 *
 * Built as a `radiogroup` with full arrow-key navigation and ARIA
 * semantics. All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * function ComposerToolbar() {
 *   const [mode, setMode] = useState<InteractionModeOption>("agent");
 *   return <InteractionModePicker value={mode} onValueChange={setMode} />;
 * }
 * ```
 */
export function InteractionModePicker({
  value,
  onValueChange,
  className,
  disabled,
}: InteractionModePickerProps) {
  const groupRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;

      const idx = OPTIONS.indexOf(value);
      let next: number | undefined;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        next = (idx + 1) % OPTIONS.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        next = (idx - 1 + OPTIONS.length) % OPTIONS.length;
      }

      if (next !== undefined) {
        e.preventDefault();
        onValueChange(OPTIONS[next]);
        const buttons =
          groupRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]");
        buttons?.[next]?.focus();
      }
    },
    [value, onValueChange, disabled],
  );

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Interaction mode"
      onKeyDown={handleKeyDown}
      className={[
        "inline-flex items-center rounded-md border border-border bg-background p-0.5",
        disabled ? "pointer-events-none opacity-50" : undefined,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {OPTIONS.map((option) => {
        const isActive = value === option;

        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={MODE_LABELS[option]}
            tabIndex={isActive ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              if (!isActive) onValueChange(option);
            }}
            className={[
              "inline-flex items-center gap-1 rounded-[5px] px-2 py-1 text-xs transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "disabled:pointer-events-none",
              isActive
                ? "bg-accent font-medium text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            ].join(" ")}
          >
            {MODE_LABELS[option]}
          </button>
        );
      })}
    </div>
  );
}
