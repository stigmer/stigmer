import { cn } from "@stigmer/theme";
import { ChipSpinner, XIcon } from "./icons.js";

export interface ChipItem {
  key: string;
  label: string;
  type: "agent" | "workspace" | "mcp" | "skill" | "secret";
  /**
   * Remove handler. When omitted, the chip renders without an X button
   * and with a subtly muted style to signal it is non-removable
   * (e.g., the session's default agent).
   */
  onRemove?: () => void;
  /** Drives visual variant: amber for `needsSetup`, muted+spinner for `loading`/`submitting`. */
  status?: "loading" | "needsSetup" | "submitting" | "ready";
  /** Secondary text before the remove button (e.g., tool count "4/12"). */
  detail?: string;
  /** Makes the label area clickable (e.g., open config popover for pending setup). */
  onClick?: () => void;
}

const CHIP_TYPE_LABELS: Record<ChipItem["type"], string> = {
  agent: "Agent",
  workspace: "WS",
  mcp: "MCP",
  skill: "Skill",
  secret: "1-time",
};

export function ContextChip({
  label,
  type,
  onRemove,
  disabled,
  status,
  detail,
  onClick,
}: {
  label: string;
  type: ChipItem["type"];
  onRemove?: () => void;
  disabled?: boolean;
  status?: ChipItem["status"];
  detail?: string;
  onClick?: () => void;
}) {
  const isTransient = status === "loading" || status === "submitting";
  const isWarning = status === "needsSetup";
  const isReadonly = onRemove == null;

  const labelContent = (
    <>
      {isTransient && <ChipSpinner />}
      {isWarning && (
        <span
          className="stg:inline-block stg:h-1.5 stg:w-1.5 stg:shrink-0 stg:rounded-full stg:bg-warning"
          aria-hidden="true"
        />
      )}
      <span className="stg:text-[0.55rem] stg:font-medium stg:uppercase stg:tracking-wider stg:text-muted-foreground">
        {CHIP_TYPE_LABELS[type]}
      </span>
      <span className="stg:max-w-[120px] stg:truncate" title={label}>
        {label}
      </span>
      {detail != null && (
        <span className="stg:shrink-0 stg:text-[0.6rem] stg:font-medium stg:text-muted-foreground">
          {detail}
        </span>
      )}
    </>
  );

  return (
    <span
      className={cn(
        "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2 stg:py-0.5 stg:text-xs stg:text-foreground",
        isWarning
          ? "stg:border stg:border-warning/30 stg:bg-warning/10"
          : "stg:bg-muted-subtle",
        isTransient && "stg:opacity-70",
        isReadonly && "stg:opacity-80",
      )}
    >
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className="stg:inline-flex stg:items-center stg:gap-1 stg:hover:opacity-80 stg:disabled:pointer-events-none"
          aria-label={`Configure ${label}`}
        >
          {labelContent}
        </button>
      ) : (
        <span className="stg:inline-flex stg:items-center stg:gap-1">
          {labelContent}
        </span>
      )}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          className="stg:ml-0.5 stg:shrink-0 stg:text-muted-foreground stg:hover:text-destructive stg:disabled:pointer-events-none"
          aria-label={`Remove ${label}`}
        >
          <XIcon />
        </button>
      )}
    </span>
  );
}
