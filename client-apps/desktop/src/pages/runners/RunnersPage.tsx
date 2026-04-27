import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import {
  useRunnerList,
  useActiveOrgSlug,
  useRunnerCredential,
  phaseLabel,
  phaseDotColor,
  isActivePhase,
  PHASE_SORT_ORDER,
} from "@stigmer/react";
import type { Runner } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { RunnerPhase } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/enum_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Play, Square, ScrollText } from "lucide-react";
import { useLocalRunners } from "../../hooks/useLocalRunners";
import { useStartRunner } from "../../hooks/useStartRunner";
import { useStopLocalRunner } from "../../hooks/useStopLocalRunner";
import { onRunnerStopped, onRunnerError } from "../../hooks/tauri";
import { StartRunnerDialog } from "./StartRunnerDialog";
import { RunnerLogViewer } from "./RunnerLogViewer";
import { toGrpcTarget } from "../../lib/grpc-target";

const SYSTEM_MANAGED_LABEL = "stigmer.ai/system-managed";

export default function RunnersPage() {
  const { getCredential } = useRunnerCredential();
  const org = useActiveOrgSlug();

  const {
    runners: serverRunners,
    isLoading: serverLoading,
    error: serverError,
    refetch: refetchServer,
  } = useRunnerList(org);

  const { localRunners, isLoading: localLoading } = useLocalRunners();
  const { startRunner, isStarting, error: startError, clearError } =
    useStartRunner();
  const { stopRunner, isStopping } = useStopLocalRunner();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [logRunner, setLogRunner] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const lastStartedRef = useRef<string | null>(null);

  // Surface async runner failures that occur after the sidecar grace period.
  // Most startup errors are caught synchronously (Bug 2 fix), but if the CLI
  // fails after the grace window, we show the error via toast or dialog state.
  useEffect(() => {
    const unlisteners: Array<Promise<() => void>> = [];

    unlisteners.push(
      onRunnerStopped((payload) => {
        if (
          payload.exit_code != null &&
          payload.exit_code !== 0 &&
          payload.name === lastStartedRef.current
        ) {
          setLaunchError(
            `Runner "${payload.name}" exited unexpectedly (code ${payload.exit_code}). Check the runner logs for details.`,
          );
          lastStartedRef.current = null;
          setTimeout(refetchServer, 1000);
        }
      }),
    );

    unlisteners.push(
      onRunnerError((payload) => {
        if (payload.name === lastStartedRef.current) {
          setLaunchError(payload.message);
        }
      }),
    );

    return () => {
      for (const p of unlisteners) {
        p.then((unlisten) => unlisten());
      }
    };
  }, [refetchServer]);

  const localRunnerIds = useMemo(() => {
    const ids = new Set<string>();
    for (const [, info] of localRunners) {
      if (info.runner_id) ids.add(info.runner_id);
    }
    return ids;
  }, [localRunners]);

  const localRunnerNames = useMemo(() => {
    const names = new Set<string>();
    for (const [name] of localRunners) {
      names.add(name);
    }
    return names;
  }, [localRunners]);

  const sorted = useMemo(
    () => [...serverRunners].sort(phaseThenName),
    [serverRunners],
  );

  const handleStart = useCallback(
    async (opts: {
      name?: string;
      endpoint?: string;
      token?: string;
    }) => {
      setLaunchError(null);
      setIsLaunching(true);

      try {
        const cred = await getCredential(org || undefined);

        const runnerName = await startRunner({
          name: opts.name,
          token: opts.token || cred.token || undefined,
          endpoint: opts.endpoint || toGrpcTarget(cred.endpoint),
          org: org || undefined,
        });
        lastStartedRef.current = runnerName;
        setDialogOpen(false);
        setTimeout(refetchServer, 3000);
      } catch (err) {
        setLaunchError(describeStartFlowError(err));
      } finally {
        setIsLaunching(false);
      }
    },
    [getCredential, org, startRunner, refetchServer],
  );

  const handleStop = useCallback(
    async (name: string) => {
      try {
        await stopRunner(name);
        setTimeout(refetchServer, 1000);
      } catch {
        // Error is captured in the hook.
      }
    },
    [stopRunner, refetchServer],
  );

  const isLoading = serverLoading || localLoading;

  return (
    <div className={cn(logRunner && "flex max-h-[70vh]")}>
      <div className={cn("flex-1", logRunner && "overflow-y-auto")}>
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Runners</h1>
            <p className="text-xs text-muted-foreground">
              Agent runners registered in your organization.
            </p>
          </div>
          <button
            onClick={() => {
              clearError();
              setLaunchError(null);
              setDialogOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Play size={12} />
            Start Runner
          </button>
        </div>

        {/* Loading skeleton */}
        {isLoading && (
          <div
            className="space-y-2"
            aria-busy="true"
            aria-label="Loading runners"
          >
            {Array.from({ length: 3 }, (_, i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-lg bg-muted-subtle"
              />
            ))}
          </div>
        )}

        {/* Error state */}
        {!isLoading && serverError && (
          <p className="text-xs text-destructive" role="alert">
            {getUserMessage(serverError)}
          </p>
        )}

        {/* Empty state */}
        {!isLoading && !serverError && sorted.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <RunnerIcon size={28} />
            <p className="text-sm text-muted-foreground">
              No runners registered.
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Click <strong>Start Runner</strong> above to launch a local
              runner, or run{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.65rem]">
                stigmer up
              </code>{" "}
              from a terminal.
            </p>
          </div>
        )}

        {/* Runner list */}
        {!isLoading && !serverError && sorted.length > 0 && (
          <div className="space-y-2" role="list" aria-label="Runners">
            {sorted.map((runner) => {
              const runnerId = runner.metadata?.id ?? "";
              const runnerName = runner.metadata?.name ?? "";
              const isLocal =
                localRunnerIds.has(runnerId) ||
                localRunnerNames.has(runnerName);

              return (
                <RunnerRow
                  key={runnerId}
                  runner={runner}
                  isLocal={isLocal}
                  isStopping={isStopping}
                  onStop={() => handleStop(runnerName)}
                  onShowLogs={() => setLogRunner(runnerName)}
                />
              );
            })}
          </div>
        )}
      </div>

      {/* Log viewer panel */}
      {logRunner && (
        <div className="w-1/2">
          <RunnerLogViewer
            runnerName={logRunner}
            onClose={() => setLogRunner(null)}
          />
        </div>
      )}

      {/* Start runner dialog */}
      <StartRunnerDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onStart={handleStart}
        isStarting={isLaunching || isStarting}
        error={launchError ?? startError}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunnerRow
// ---------------------------------------------------------------------------

function RunnerRow({
  runner,
  isLocal,
  isStopping,
  onStop,
  onShowLogs,
}: {
  runner: Runner;
  isLocal: boolean;
  isStopping: boolean;
  onStop: () => void;
  onShowLogs: () => void;
}) {
  const name = runner.metadata?.name ?? "Unnamed";
  const phase = runner.status?.phase ?? RunnerPhase.UNSPECIFIED;
  const active = isActivePhase(phase);
  const systemManaged =
    runner.metadata?.labels[SYSTEM_MANAGED_LABEL] === "true";

  const info = runner.status?.connectionInfo;
  const hostname = info?.hostname;
  const osArch =
    info?.os && info?.arch ? `${info.os}/${info.arch}` : undefined;
  const version = info?.runnerVersion;
  const executions = runner.status?.currentExecutions ?? 0;
  const lastHeartbeat = runner.status?.lastHeartbeatAt;

  return (
    <div
      role="listitem"
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border-muted px-3 py-2.5",
        "hover:border-border transition-colors",
        !active && "opacity-60",
      )}
    >
      <RunnerIcon size={14} />

      {/* Name + badges */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium text-foreground">
          {name}
        </span>
        {isLocal && (
          <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[0.6rem] font-medium text-primary">
            Local
          </span>
        )}
        {systemManaged && (
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.6rem] font-medium text-muted-foreground">
            System
          </span>
        )}
        <PhaseBadge phase={phase} />
      </div>

      {/* Metadata */}
      <div className="hidden items-center gap-4 text-xs text-muted-foreground lg:flex">
        {hostname && (
          <span className="max-w-[10rem] truncate" title={hostname}>
            {hostname}
          </span>
        )}
        {osArch && (
          <span className="font-mono text-[0.65rem]">{osArch}</span>
        )}
        {version && (
          <span className="font-mono text-[0.65rem]">v{version}</span>
        )}
        {active && (
          <span title="Current executions">
            {executions} exec{executions !== 1 ? "s" : ""}
          </span>
        )}
        {lastHeartbeat && (
          <span
            title={`Last heartbeat: ${timestampDate(lastHeartbeat).toISOString()}`}
          >
            {formatRelativeTime(timestampDate(lastHeartbeat))}
          </span>
        )}
      </div>

      {/* Actions for local runners */}
      {isLocal && active && (
        <div className="flex items-center gap-1">
          <button
            onClick={onShowLogs}
            title="View logs"
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ScrollText size={14} />
          </button>
          <button
            onClick={onStop}
            disabled={isStopping}
            title="Stop runner"
            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          >
            <Square size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared small components
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

function RunnerIcon({ size = 14 }: { size?: number }) {
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
      className="shrink-0 text-muted-foreground"
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

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function describeStartFlowError(err: unknown): string {
  const raw = String(err).toLowerCase();

  if (raw.includes("unauthenticated") || raw.includes("unauthorized")) {
    return "Authentication failed. Please log in again.";
  }
  if (raw.includes("network") || raw.includes("fetch") || raw.includes("connect")) {
    return "Could not reach the Stigmer server. Check your network connection.";
  }
  if (raw.includes("already managed")) {
    return "A runner with that name is already running on this machine.";
  }
  if (raw.includes("sidecar") || raw.includes("spawn")) {
    return "Failed to start the runner process. The CLI sidecar may be missing \u2014 try reinstalling the desktop app.";
  }
  return `Failed to start runner: ${String(err)}`;
}

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
