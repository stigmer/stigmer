"use client";

import { useCallback, useRef, type KeyboardEvent } from "react";
import { HARNESS_LABELS, type HarnessOption } from "./harness.js";

const OPTIONS: readonly HarnessOption[] = ["native", "cursor"];

/** Props for {@link HarnessSelector}. */
export interface HarnessSelectorProps {
  /** Currently selected harness. */
  readonly value: HarnessOption;
  /** Called when the user picks a different harness. */
  readonly onValueChange: (harness: HarnessOption) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
  /** When true, disables the selector. */
  readonly disabled?: boolean;
}

/**
 * Compact segmented control for choosing the session execution engine.
 *
 * Renders two mutually exclusive options — "Stigmer" (native) and
 * "Cursor" (premium) — as adjacent pill segments. The Cursor segment
 * carries a subtle premium tier indicator.
 *
 * Built as a `radiogroup` with full arrow-key navigation and ARIA
 * semantics. All visual properties flow through `--stgm-*` tokens.
 *
 * Platform builders who need different rendering use
 * {@link HarnessOption} and {@link HARNESS_LABELS} directly.
 *
 * @deprecated Use {@link ModelSelector} in unified mode (without the
 * `harness` prop) instead. The unified model picker embeds an engine
 * tag on each model row, eliminating the need for a separate harness
 * control. This component is kept for backward compatibility.
 *
 * @example
 * ```tsx
 * function LauncherToolbar() {
 *   const [harness, setHarness] = useState<HarnessOption>("native");
 *
 *   return <HarnessSelector value={harness} onValueChange={setHarness} />;
 * }
 * ```
 */
export function HarnessSelector({
  value,
  onValueChange,
  className,
  disabled,
}: HarnessSelectorProps) {
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
        const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]");
        buttons?.[next]?.focus();
      }
    },
    [value, onValueChange, disabled],
  );

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Execution engine"
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
            aria-label={HARNESS_LABELS[option]}
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
            {HARNESS_LABELS[option]}
            {option === "cursor" && (
              <span
                aria-label="premium"
                className="text-[0.6rem] text-muted-foreground"
              >
                $$$
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
