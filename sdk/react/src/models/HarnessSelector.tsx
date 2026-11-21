"use client";

import { useCallback, useRef, type KeyboardEvent } from "react";
import { type HarnessOption } from "@stigmer/react-core";
import { HARNESS_META, HARNESS_OPTIONS as OPTIONS } from "@stigmer/react-core/internal";

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
  /**
   * The harnesses offered here, in display order; every harness the
   * platform runs when omitted. An agent without a computer offers Stigmer
   * alone, since the Claude harness always runs with one.
   */
  readonly options?: readonly HarnessOption[];
}

/**
 * The composer's harness control: a compact segmented control for choosing
 * the session harness, also used for an agent's default harness.
 *
 * Renders one mutually exclusive option per offered harness — "Stigmer"
 * (`stigmer`) and "Claude Agent" (`claude`) — as adjacent pill segments.
 *
 * Built as a `radiogroup` with full arrow-key navigation and ARIA
 * semantics. All visual properties flow through `--stgm-*` tokens.
 *
 * Platform builders who need different rendering use
 * {@link HarnessOption} and `HARNESS_META` directly.
 *
 * @example
 * ```tsx
 * function LauncherToolbar() {
 *   const [harness, setHarness] = useState<HarnessOption>("stigmer");
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
  options = OPTIONS,
}: HarnessSelectorProps) {
  const groupRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return;

      const idx = options.indexOf(value);
      let next: number | undefined;

      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        next = (idx + 1) % options.length;
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        next = (idx - 1 + options.length) % options.length;
      }

      if (next !== undefined) {
        e.preventDefault();
        onValueChange(options[next]);
        const buttons = groupRef.current?.querySelectorAll<HTMLButtonElement>("[role=radio]");
        buttons?.[next]?.focus();
      }
    },
    [value, onValueChange, disabled, options],
  );

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label="Harness"
      onKeyDown={handleKeyDown}
      className={[
        "stg:inline-flex stg:items-center stg:rounded-md stg:border stg:border-border stg:bg-background stg:p-0.5",
        disabled ? "stg:pointer-events-none stg:opacity-50" : undefined,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {options.map((option) => {
        const isActive = value === option;

        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={HARNESS_META[option].label}
            tabIndex={isActive ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              if (!isActive) onValueChange(option);
            }}
            className={[
              "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-[5px] stg:px-2 stg:py-1 stg:text-xs stg:transition-colors",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
              "stg:disabled:pointer-events-none",
              isActive
                ? "stg:bg-accent stg:font-medium stg:text-foreground stg:shadow-sm"
                : "stg:text-muted-foreground stg:hover:text-foreground",
            ].join(" ")}
          >
            {HARNESS_META[option].label}
          </button>
        );
      })}
    </div>
  );
}
