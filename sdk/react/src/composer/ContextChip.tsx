import { cn } from "@stigmer/theme";
import { ChipSpinner, XIcon } from "./icons";

export interface ChipItem {
  key: string;
  label: string;
  type: "agent" | "workspace" | "mcp" | "skill" | "secret";
  onRemove: () => void;
  /** MCP-only: drives visual variant (amber, muted+spinner, default). */
  status?: "loading" | "needsSetup" | "submitting" | "ready";
  /** MCP-only: secondary text before the remove button (e.g., "4/12"). */
  detail?: string;
  /** MCP-only: makes the label area clickable (e.g., open config popover). */
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
  onRemove: () => void;
  disabled?: boolean;
  status?: ChipItem["status"];
  detail?: string;
  onClick?: () => void;
}) {
  const isTransient = status === "loading" || status === "submitting";
  const isWarning = status === "needsSetup";

  const labelContent = (
    <>
      {isTransient && <ChipSpinner />}
      {isWarning && (
        <span
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
          aria-hidden="true"
        />
      )}
      <span className="text-[0.55rem] font-medium uppercase tracking-wider text-muted-foreground">
        {CHIP_TYPE_LABELS[type]}
      </span>
      <span className="max-w-[120px] truncate" title={label}>
        {label}
      </span>
      {detail != null && (
        <span className="shrink-0 text-[0.6rem] font-medium text-muted-foreground">
          {detail}
        </span>
      )}
    </>
  );

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs text-foreground",
        isWarning
          ? "border border-warning/30 bg-warning/10"
          : "bg-muted/50",
        isTransient && "opacity-70",
      )}
    >
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          className="inline-flex items-center gap-1 hover:opacity-80 disabled:pointer-events-none"
          aria-label={`Configure ${label}`}
        >
          {labelContent}
        </button>
      ) : (
        <span className="inline-flex items-center gap-1">
          {labelContent}
        </span>
      )}
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        className="ml-0.5 shrink-0 text-muted-foreground hover:text-destructive disabled:pointer-events-none"
        aria-label={`Remove ${label}`}
      >
        <XIcon />
      </button>
    </span>
  );
}
