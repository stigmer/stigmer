"use client";

import { useCallback } from "react";
import { cn } from "@stigmer/theme";

/** Props for {@link AutoApproveToggle}. */
export interface AutoApproveToggleProps {
  /** Whether auto-approve is currently on. */
  readonly value: boolean;
  /** Called when the user toggles the control. */
  readonly onValueChange: (value: boolean) => void;
  /** Additional CSS class names for the trigger button. */
  readonly className?: string;
  /** When true, disables the toggle. */
  readonly disabled?: boolean;
}

/**
 * Compact toolbar toggle for auto-approving all tool calls in the next message.
 *
 * When off (default), mutating/destructive tools pause for human approval. When
 * on, the approval gate is bypassed for the execution. Maps to
 * `AgentExecutionSpec.auto_approve_all`. Per-message, like the interaction-mode
 * picker — it is not a persisted session setting.
 *
 * @example
 * ```tsx
 * const [auto, setAuto] = useState(false);
 * <AutoApproveToggle value={auto} onValueChange={setAuto} />
 * ```
 */
export function AutoApproveToggle({
  value,
  onValueChange,
  className,
  disabled,
}: AutoApproveToggleProps) {
  const toggle = useCallback(() => {
    onValueChange(!value);
  }, [onValueChange, value]);

  return (
    <button
      type="button"
      aria-pressed={value}
      disabled={disabled}
      onClick={toggle}
      title={
        value
          ? "Auto-approving all tool calls — click to require approval"
          : "Tool calls require approval — click to auto-approve all"
      }
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        value
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
        className,
      )}
    >
      <ShieldIcon filled={value} />
      <span className="font-medium">Auto-approve</span>
    </button>
  );
}

function ShieldIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill={filled ? "currentColor" : "none"}
      className="shrink-0"
      aria-hidden="true"
    >
      <path
        d="M6 1L10 2.5V5.5C10 8 8.2 9.7 6 10.5C3.8 9.7 2 8 2 5.5V2.5L6 1Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
}
