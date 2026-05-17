"use client";

import { useCallback, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import { cn } from "@stigmer/theme";
import { useStigmerPortalContainer } from "../portal-container";

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
          "inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors",
          "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
      >
        <span className="font-medium text-foreground">
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
              "z-50 w-56 rounded-lg border border-border bg-popover p-1 shadow-md",
              "animate-in fade-in-0 zoom-in-95",
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
                    "flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "bg-accent text-foreground"
                      : "text-foreground hover:bg-accent-hover",
                  )}
                >
                  <span className="text-xs font-medium">{meta.label}</span>
                  <span className="text-[0.65rem] leading-snug text-muted-foreground">
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
      className="shrink-0 text-muted-foreground"
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
