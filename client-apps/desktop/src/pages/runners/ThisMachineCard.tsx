import { useEffect, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import {
  phaseDotColor,
  phaseLabel,
  isActivePhase,
  formatRelativeTime,
} from "@stigmer/react";
import type { Runner } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { RunnerPhase } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/enum_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import {
  Power,
  PowerOff,
  ScrollText,
  RotateCw,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import type { LocalRunnerStatus } from "../../hooks/tauri";
import type { AutoEnsureState } from "../../hooks/useAutoEnsure";
import { FirstRunPrompt } from "./FirstRunPrompt";

interface ThisMachineCardProps {
  readonly autoEnsureState: AutoEnsureState;
  readonly localStatus: LocalRunnerStatus;
  readonly serverRunner: Runner | null;
  readonly error: string | null;
  readonly onEnable: () => void;
  readonly onDisable: () => void;
  readonly onRetry: () => void;
  readonly onDismissPrompt: () => void;
  readonly onShowLogs: () => void;
  readonly onRestart: () => void;
  readonly isRestarting: boolean;
}

/**
 * Status card for this computer's local runner. Renders different
 * visuals based on the auto-ensure lifecycle state.
 */
export function ThisMachineCard({
  autoEnsureState,
  localStatus,
  serverRunner,
  error,
  onEnable,
  onDisable,
  onRetry,
  onDismissPrompt,
  onShowLogs,
  onRestart,
  isRestarting,
}: ThisMachineCardProps) {
  if (autoEnsureState === "loading") {
    return <LoadingCard />;
  }

  if (autoEnsureState === "prompt") {
    return (
      <FirstRunPrompt
        onEnable={onEnable}
        onDismiss={onDismissPrompt}
        isEnabling={false}
      />
    );
  }

  if (autoEnsureState === "disabled") {
    return <DisabledCard onEnable={onEnable} />;
  }

  if (autoEnsureState === "ensuring") {
    return <EnsuringCard />;
  }

  if (autoEnsureState === "error") {
    return <ErrorCard error={error} onRetry={onRetry} onDisable={onDisable} />;
  }

  // autoEnsureState === "active"
  return (
    <ActiveCard
      localStatus={localStatus}
      serverRunner={serverRunner}
      onDisable={onDisable}
      onShowLogs={onShowLogs}
      onRestart={onRestart}
      isRestarting={isRestarting}
    />
  );
}

// ---------------------------------------------------------------------------
// State-specific cards
// ---------------------------------------------------------------------------

function LoadingCard() {
  return (
    <div
      className="h-20 animate-pulse rounded-lg border border-border bg-muted-subtle"
      aria-busy="true"
      aria-label="Loading runner status"
    />
  );
}

function DisabledCard({ onEnable }: { readonly onEnable: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
      <PowerOff size={16} className="shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-muted-foreground">
          Runner disabled on this machine
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Enable to make this computer available for agent runs.
        </p>
      </div>
      <button
        type="button"
        onClick={onEnable}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
          "bg-primary text-primary-foreground hover:bg-primary-hover",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        )}
      >
        <Power size={12} />
        Enable
      </button>
    </div>
  );
}

function EnsuringCard() {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const subtitle =
    elapsed >= 30
      ? `Setting up runtime environment\u2026 ${elapsed}s elapsed`
      : elapsed >= 10
        ? "This may take a minute on first run\u2026"
        : "Connecting this computer to your organization.";

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-primary-subtle px-4 py-3">
      <Loader2
        size={16}
        className="shrink-0 animate-spin text-primary"
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">
          Starting runner&hellip;
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {subtitle}
        </p>
      </div>
    </div>
  );
}

function ErrorCard({
  error,
  onRetry,
  onDisable,
}: {
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly onDisable: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-destructive-subtle px-4 py-3">
      <div className="flex items-start gap-3">
        <AlertTriangle
          size={16}
          className="mt-0.5 shrink-0 text-destructive"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            Runner failed to start
          </p>
          {error && (
            <p className="mt-1 text-xs text-destructive">{error}</p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onRetry}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
                "bg-primary text-primary-foreground hover:bg-primary-hover",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              )}
            >
              <RotateCw size={12} />
              Retry
            </button>
            <button
              type="button"
              onClick={onDisable}
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Disable
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const HEALTH_WARNING_GRACE_MS = 30_000;

function ActiveCard({
  localStatus,
  serverRunner,
  onDisable,
  onShowLogs,
  onRestart,
  isRestarting,
}: {
  readonly localStatus: LocalRunnerStatus;
  readonly serverRunner: Runner | null;
  readonly onDisable: () => void;
  readonly onShowLogs: () => void;
  readonly onRestart: () => void;
  readonly isRestarting: boolean;
}) {
  const [pastGrace, setPastGrace] = useState(false);
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    graceTimerRef.current = setTimeout(() => setPastGrace(true), HEALTH_WARNING_GRACE_MS);
    return () => {
      if (graceTimerRef.current) clearTimeout(graceTimerRef.current);
    };
  }, []);

  const name =
    localStatus.name ??
    serverRunner?.metadata?.name ??
    "Local Runner";

  const serverPhase =
    serverRunner?.status?.phase ?? RunnerPhase.UNSPECIFIED;
  const phase = localStatus.running
    ? serverPhase === RunnerPhase.UNSPECIFIED
      ? RunnerPhase.STARTING
      : serverPhase
    : RunnerPhase.STOPPED;

  const executions = serverRunner?.status?.currentExecutions ?? 0;
  const lastHeartbeat = serverRunner?.status?.lastHeartbeatAt;
  const info = serverRunner?.status?.connectionInfo;

  const meta: string[] = [];
  if (localStatus.uptime) meta.push(localStatus.uptime);
  if (info?.os && info?.arch) meta.push(`${info.os}/${info.arch}`);
  if (localStatus.version) meta.push(`v${localStatus.version}`);
  if (isActivePhase(phase))
    meta.push(`${executions} exec${executions !== 1 ? "s" : ""}`);
  if (lastHeartbeat) meta.push(formatRelativeTime(timestampDate(lastHeartbeat)));

  const socketHealthy = localStatus.source === "socket" && localStatus.running;
  const serverHealthy = isActivePhase(phase);
  const showHealthWarning = pastGrace && !socketHealthy && serverHealthy;

  return (
    <div className="rounded-lg border border-border bg-success-subtle px-4 py-3">
      <div className="flex items-start gap-3">
        {/* Status indicator */}
        <div className="mt-1 flex shrink-0 flex-col items-center">
          <span
            className={cn(
              "inline-block h-2.5 w-2.5 rounded-full",
              phaseDotColor(phase),
            )}
            aria-hidden="true"
          />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">
              {name}
            </span>
            <span className="text-xs text-success">{phaseLabel(phase)}</span>
          </div>

          {meta.length > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {meta.join(" \u00b7 ")}
            </p>
          )}

          {showHealthWarning && (
            <p className="mt-1 flex items-center gap-1 text-xs text-warning">
              <AlertTriangle size={10} />
              Local health check failed — socket unreachable
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          <ActionButton
            icon={<ScrollText size={14} />}
            label="View logs"
            onClick={onShowLogs}
          />
          <ActionButton
            icon={
              isRestarting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RotateCw size={14} />
              )
            }
            label={isRestarting ? "Restarting\u2026" : "Restart"}
            onClick={onRestart}
            disabled={isRestarting}
          />
          <ActionButton
            icon={<PowerOff size={14} />}
            label="Disable"
            onClick={onDisable}
            variant="muted"
          />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

const handleClick = (fn: () => void) => (e: React.MouseEvent) => {
  e.stopPropagation();
  fn();
};

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  variant = "default",
}: {
  readonly icon: React.ReactNode;
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  readonly variant?: "default" | "muted";
}) {
  return (
    <button
      type="button"
      onClick={handleClick(onClick)}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "rounded p-1.5 transition-colors disabled:opacity-50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        variant === "muted"
          ? "text-muted-foreground hover:bg-muted hover:text-foreground"
          : "text-muted-foreground hover:bg-muted-subtle hover:text-foreground",
      )}
    >
      {icon}
    </button>
  );
}

