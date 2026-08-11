"use client";

import { useCallback, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { cn } from "@stigmer/theme";
import { useStigmerPortalContainer } from "../portal-container.js";

/**
 * Interaction mode options for agent executions.
 *
 * Maps to `InteractionMode` proto enum values (excluding UNSPECIFIED):
 * - `"agent"` → `INTERACTION_MODE_AGENT` (full tool access)
 * - `"plan"` → `INTERACTION_MODE_PLAN` (read-only analysis)
 */
export type InteractionModeOption = "agent" | "plan";

const OPTIONS: readonly InteractionModeOption[] = ["agent", "plan"];

const MODE_META: Record<
  InteractionModeOption,
  { label: string; description: string }
> = {
  agent: {
    label: "Agent",
    description: "Full tool access — read, write, and execute",
  },
  plan: {
    label: "Plan",
    description: "Read-only analysis — search and reason only",
  },
};

/** Props for {@link InteractionModePicker}. */
export interface InteractionModePickerProps {
  /** Currently selected interaction mode. */
  readonly value: InteractionModeOption;
  /** Called when the user picks a different mode. */
  readonly onValueChange: (mode: InteractionModeOption) => void;
  /** Additional CSS class names for the trigger button. */
  readonly className?: string;
  /** When true, disables the picker. */
  readonly disabled?: boolean;
}

/**
 * Compact dropdown for choosing the execution interaction mode.
 *
 * Renders a trigger button showing the current mode label with a
 * chevron, and a popover with the available options. Each option
 * shows a label and a short description.
 *
 * Designed to scale to additional modes (e.g. Ask) without layout
 * changes. Uses `@base-ui/react` Popover for positioning and portal
 * rendering, matching the pattern used by {@link ModelSelector}.
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
  const portalContainer = useStigmerPortalContainer();
  const [open, setOpen] = useState(false);

  const select = useCallback(
    (mode: InteractionModeOption) => {
      onValueChange(mode);
      setOpen(false);
    },
    [onValueChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const idx = OPTIONS.indexOf(value);
      let next: number | undefined;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          next = idx < OPTIONS.length - 1 ? idx + 1 : 0;
          break;
        case "ArrowUp":
          e.preventDefault();
          next = idx > 0 ? idx - 1 : OPTIONS.length - 1;
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          return;
      }

      if (next !== undefined) {
        select(OPTIONS[next]);
      }
    },
    [value, select],
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        disabled={disabled}
        className={cn(
          "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2 stg:py-1.5 stg:text-xs stg:transition-colors",
          "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
          "stg:disabled:pointer-events-none stg:disabled:opacity-50",
          className,
        )}
      >
        <span className="stg:font-medium stg:text-foreground">
          {MODE_META[value].label}
        </span>
        <ChevronIcon />
      </Popover.Trigger>

      <Popover.Portal container={portalContainer}>
        <Popover.Positioner sideOffset={4}>
          <Popover.Popup
            role="listbox"
            aria-label="Interaction mode"
            onKeyDown={handleKeyDown}
            className={cn(
              "stg:z-50 stg:w-56 stg:rounded-lg stg:border stg:border-border stg:bg-popover stg:p-1 stg:shadow-md",
              "stg:animate-in stg:fade-in-0 stg:zoom-in-95",
            )}
          >
            {OPTIONS.map((option) => {
              const meta = MODE_META[option];
              const isActive = value === option;

              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onClick={() => select(option)}
                  className={cn(
                    "stg:flex stg:w-full stg:flex-col stg:gap-0.5 stg:rounded-md stg:px-2.5 stg:py-2 stg:text-left stg:transition-colors",
                    "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                    isActive
                      ? "stg:bg-accent stg:text-foreground"
                      : "stg:text-foreground stg:hover:bg-accent-hover",
                  )}
                >
                  <span className="stg:text-xs stg:font-medium">{meta.label}</span>
                  <span className="stg:text-[0.65rem] stg:leading-snug stg:text-muted-foreground">
                    {meta.description}
                  </span>
                </button>
              );
            })}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ChevronIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      className="stg:shrink-0 stg:text-muted-foreground"
      aria-hidden="true"
    >
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
