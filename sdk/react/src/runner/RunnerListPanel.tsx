"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { RunnerPhase } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/enum_pb";
import type { Runner } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { useRunnerList } from "./useRunnerList";
import { useStopRunner } from "./useStopRunner";
import { useDeleteRunner } from "./useDeleteRunner";
import {
  isActivePhase,
  phaseLabel,
  phaseDotColor,
  PHASE_SORT_ORDER,
} from "./phase";

const SYSTEM_MANAGED_LABEL = "stigmer.ai/system-managed";

type ConfirmingState = {
  readonly runnerId: string;
  readonly action: "stop" | "delete";
} | null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link RunnerListPanel}. */
export interface RunnerListPanelProps {
  /** Organization slug to scope the runner list. */
  readonly org: string;
  /**
   * Include system-managed (ephemeral cloud) runners in the list.
   *
   * System-managed runners are auto-provisioned for cloud executions
   * and labeled `stigmer.ai/system-managed: "true"`. They are excluded
   * by default so user-facing views only show user-created runners.
   * Pass `true` in admin views that need full fleet visibility.
   *
   * @default false
   */
  readonly includeSystemManaged?: boolean;
  /** Expose refetch so parent components can trigger a list refresh. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  /**
   * Notification callback fired after a runner is successfully stopped.
   * Receives the updated runner resource with its new phase.
   */
  readonly onStopped?: (runner: Runner) => void;
  /**
   * Notification callback fired after a runner is successfully deleted.
   * Receives the deleted runner resource for confirmation display.
   */
  readonly onDeleted?: (runner: Runner) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Panel that displays runners in an organization with lifecycle
 * management actions.
 *
 * Each runner is rendered as a card row showing name, phase indicator,
 * machine information, and operational metadata. Non-system-managed
 * runners include an action menu for stop and delete operations with
 * inline confirmation — no modals or portals.
 *
 * Rows are sorted by phase (active runners first) then alphabetically
 * by name. System-managed runners (when included) display a "System"
 * badge and have no action affordances.
 *
 * By default only user-created runners are shown. Pass
 * `includeSystemManaged={true}` for admin views that need full fleet
 * visibility.
 *
 * Designed for the Settings > Runners page but embeddable in any
 * context that needs runner fleet management. Fetches data via
 * {@link useRunnerList} and performs mutations via {@link useStopRunner}
 * and {@link useDeleteRunner} — no Console-specific dependencies.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <RunnerListPanel org="acme" />
 *
 * <RunnerListPanel
 *   org="acme"
 *   includeSystemManaged
 *   onStopped={(runner) => toast(`${runner.metadata?.name} stopped`)}
 *   onDeleted={(runner) => toast(`${runner.metadata?.name} deleted`)}
 *   onRefetchRef={(refetch) => { refetchRef.current = refetch; }}
 * />
 * ```
 */
export function RunnerListPanel({
  org,
  includeSystemManaged = false,
  onRefetchRef,
  onStopped,
  onDeleted,
  className,
}: RunnerListPanelProps) {
  const { runners, isLoading, error, refetch } = useRunnerList(org, {
    includeSystemManaged,
  });
  const [confirming, setConfirming] = useState<ConfirmingState>(null);

  if (onRefetchRef) {
    onRefetchRef(refetch);
  }

  const sorted = useMemo(
    () => [...runners].sort(phaseThenName),
    [runners],
  );

  const handleRequestConfirm = useCallback(
    (runnerId: string, action: "stop" | "delete") => {
      setConfirming({ runnerId, action });
    },
    [],
  );

  const handleCancelConfirm = useCallback(() => {
    setConfirming(null);
  }, []);

  const handleActionComplete = useCallback(
    (runner: Runner, action: "stop" | "delete") => {
      setConfirming(null);
      refetch();
      if (action === "stop") onStopped?.(runner);
      else onDeleted?.(runner);
    },
    [refetch, onStopped, onDeleted],
  );

  if (isLoading) {
    return (
      <div
        className={cn("space-y-2", className)}
        aria-busy="true"
        aria-label="Loading runners"
      >
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="bg-muted-subtle h-[4.25rem] animate-pulse rounded-lg"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className={cn("text-destructive text-xs", className)} role="alert">
        {getUserMessage(error)}
      </p>
    );
  }

  if (sorted.length === 0) {
    return (
      <div
        className={cn(
          "flex flex-col items-center gap-2 py-8 text-center",
          className,
        )}
      >
        <RunnerIcon size={24} />
        <p className="text-muted-foreground text-xs">
          No runners registered.
        </p>
        <p className="text-muted-foreground-subtle max-w-xs text-[0.65rem]">
          Start a runner with{" "}
          <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.6rem]">
            stigmer up
          </code>{" "}
          or launch one from your browser with the button above.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn("space-y-2", className)}
      role="list"
      aria-label="Runners"
    >
      {sorted.map((runner) => {
        const id = runner.metadata!.id;
        return (
          <RunnerRow
            key={id}
            runner={runner}
            confirmingAction={
              confirming?.runnerId === id ? confirming.action : null
            }
            onRequestConfirm={(action) => handleRequestConfirm(id, action)}
            onCancelConfirm={handleCancelConfirm}
            onActionComplete={handleActionComplete}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunnerRow (internal)
// ---------------------------------------------------------------------------

function RunnerRow({
  runner,
  confirmingAction,
  onRequestConfirm,
  onCancelConfirm,
  onActionComplete,
}: {
  runner: Runner;
  confirmingAction: "stop" | "delete" | null;
  onRequestConfirm: (action: "stop" | "delete") => void;
  onCancelConfirm: () => void;
  onActionComplete: (runner: Runner, action: "stop" | "delete") => void;
}) {
  const {
    stop,
    isStopping,
    error: stopError,
    clearError: clearStopError,
  } = useStopRunner();
  const {
    deleteRunner,
    isDeleting,
    error: deleteError,
    clearError: clearDeleteError,
  } = useDeleteRunner();

  const name = runner.metadata?.name ?? "Unnamed";
  const id = runner.metadata?.id ?? "";
  const phase = runner.status?.phase ?? RunnerPhase.UNSPECIFIED;
  const active = isActivePhase(phase);
  const systemManaged =
    runner.metadata?.labels[SYSTEM_MANAGED_LABEL] === "true";
  const hasActions = !systemManaged;
  const canStop = active;

  const info = runner.status?.connectionInfo;
  const hostname = info?.hostname;
  const osArch =
    info?.os && info?.arch ? `${info.os}/${info.arch}` : undefined;
  const version = info?.runnerVersion;
  const executions = runner.status?.currentExecutions ?? 0;
  const lastHeartbeat = runner.status?.lastHeartbeatAt;

  useEffect(() => {
    if (confirmingAction) {
      clearStopError();
      clearDeleteError();
    }
  }, [confirmingAction, clearStopError, clearDeleteError]);

  const handleStop = useCallback(async () => {
    try {
      const updated = await stop({
        runnerId: id,
        reason: "stopped via web console",
      });
      onActionComplete(updated, "stop");
    } catch {
      // error state surfaced via useStopRunner hook
    }
  }, [id, stop, onActionComplete]);

  const handleDelete = useCallback(async () => {
    try {
      const deleted = await deleteRunner(id);
      onActionComplete(deleted, "delete");
    } catch {
      // error state surfaced via useDeleteRunner hook
    }
  }, [id, deleteRunner, onActionComplete]);

  if (confirmingAction === "stop") {
    return (
      <ConfirmationRow
        message={
          <>
            Stop <span className="font-medium">{name}</span>?
          </>
        }
        description="Active executions on this runner will be interrupted."
        confirmLabel="Stop runner"
        isMutating={isStopping}
        error={stopError}
        onConfirm={handleStop}
        onCancel={onCancelConfirm}
      />
    );
  }

  if (confirmingAction === "delete") {
    return (
      <ConfirmationRow
        message={
          <>
            Delete <span className="font-medium">{name}</span>?
          </>
        }
        description="This action is permanent. Sessions bound to this runner will fall back to auto-provisioning."
        confirmLabel="Delete permanently"
        isMutating={isDeleting}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={onCancelConfirm}
      />
    );
  }

  const metaSegments: string[] = [];
  if (hostname) metaSegments.push(hostname);
  if (osArch) metaSegments.push(osArch);
  if (active) metaSegments.push(`${executions} exec${executions !== 1 ? "s" : ""}`);
  if (lastHeartbeat) {
    metaSegments.push(formatRelativeTime(timestampDate(lastHeartbeat)));
  }

  return (
    <div
      role="listitem"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border-muted px-3 py-2.5",
        "hover:border-border transition-colors",
        !active && "opacity-60",
      )}
    >
      <RunnerIcon size={16} className="mt-0.5" />

      <div className="min-w-0 flex-1">
        {/* Line 1: name + badges + phase */}
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {name}
          </span>
          {systemManaged && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.6rem] font-medium text-muted-foreground">
              System
            </span>
          )}
          <PhaseBadge phase={phase} />
        </div>

        {/* Line 2: metadata */}
        {metaSegments.length > 0 && (
          <p className="mt-0.5 truncate text-[0.65rem] text-muted-foreground">
            {metaSegments.join(" \u00b7 ")}
          </p>
        )}
      </div>

      {hasActions && (
        <ActionMenu
          canStop={canStop}
          onStop={() => onRequestConfirm("stop")}
          onDelete={() => onRequestConfirm("delete")}
          runnerName={name}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConfirmationRow (internal)
// ---------------------------------------------------------------------------

function ConfirmationRow({
  message,
  description,
  confirmLabel,
  isMutating,
  error,
  onConfirm,
  onCancel,
}: {
  message: React.ReactNode;
  description: string;
  confirmLabel: string;
  isMutating: boolean;
  error: Error | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="listitem"
      className="rounded-lg border border-destructive/30 bg-destructive-subtle px-3 py-2.5"
    >
      <p className="text-xs text-foreground">{message}</p>
      <p className="mt-0.5 text-[0.65rem] text-muted-foreground">
        {description}
      </p>
      {error && (
        <p className="mt-1 text-[0.65rem] text-destructive" role="alert">
          {getUserMessage(error)}
        </p>
      )}
      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={onConfirm}
          disabled={isMutating}
          className={cn(
            "inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium",
            "bg-destructive text-destructive-foreground hover:bg-destructive-hover",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {isMutating && <SpinnerIcon />}
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isMutating}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs",
            "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ActionMenu (internal)
// ---------------------------------------------------------------------------

function ActionMenu({
  canStop,
  onStop,
  onDelete,
  runnerName,
}: {
  canStop: boolean;
  onStop: () => void;
  onDelete: () => void;
  runnerName: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={`Actions for ${runnerName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "shrink-0 rounded p-1",
          "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
          "transition-colors",
        )}
      >
        <MoreVerticalIcon />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={`Actions for ${runnerName}`}
          className={cn(
            "absolute right-0 top-full z-10 mt-1",
            "min-w-[10rem] rounded-md border border-border bg-popover py-1 shadow-md",
          )}
        >
          {canStop && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onStop();
              }}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                "text-foreground hover:bg-accent-hover transition-colors",
              )}
            >
              <StopIcon />
              Stop runner
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
              "text-destructive-muted hover:text-destructive hover:bg-destructive-subtle",
              "transition-colors",
            )}
          >
            <TrashIcon />
            Delete runner
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PhaseBadge (internal)
// ---------------------------------------------------------------------------

function PhaseBadge({ phase }: { phase: RunnerPhase }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${phaseDotColor(phase)}`}
        aria-hidden="true"
      />
      <span className="text-[0.65rem] text-muted-foreground">
        {phaseLabel(phase)}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function phaseThenName(a: Runner, b: Runner): number {
  const pa = a.status?.phase ?? RunnerPhase.UNSPECIFIED;
  const pb = b.status?.phase ?? RunnerPhase.UNSPECIFIED;
  const order = PHASE_SORT_ORDER[pa] - PHASE_SORT_ORDER[pb];
  if (order !== 0) return order;
  return (a.metadata?.name ?? "").localeCompare(b.metadata?.name ?? "");
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();

  if (diffMs < 0) return "just now";

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function RunnerIcon({
  size = 14,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("shrink-0 text-muted-foreground", className)}
    >
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M15 2v2" />
      <path d="M15 20v2" />
      <path d="M2 15h2" />
      <path d="M2 9h2" />
      <path d="M20 15h2" />
      <path d="M20 9h2" />
      <path d="M9 2v2" />
      <path d="M9 20v2" />
    </svg>
  );
}

function MoreVerticalIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="8" cy="3" r="1.5" />
      <circle cx="8" cy="8" r="1.5" />
      <circle cx="8" cy="13" r="1.5" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6" />
      <rect x="5.5" y="5.5" width="5" height="5" rx="0.5" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2.5 4h11M5.5 4V2.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V4" />
      <path d="M12.5 4v9a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V4" />
      <line x1="6.5" y1="7" x2="6.5" y2="11" />
      <line x1="9.5" y1="7" x2="9.5" y2="11" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
