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
  isTransitionalPhase,
  PHASE_SORT_ORDER,
} from "@stigmer/react";
import type { Runner } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { RunnerPhase } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/enum_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Play, Square, ScrollText, X } from "lucide-react";
import { useLocalRunners } from "../../hooks/useLocalRunners";
import { useStartRunner } from "../../hooks/useStartRunner";
import { useStopLocalRunner } from "../../hooks/useStopLocalRunner";
import {
  onRunnerStarted,
  onRunnerStopped,
  onRunnerError,
  invokeCheckRunnerLogExists,
  type LocalRunnerInfo,
} from "../../hooks/tauri";
import { StartRunnerDialog } from "./StartRunnerDialog";
import { RunnerLogViewer } from "./RunnerLogViewer";
import { toGrpcTarget } from "../../lib/grpc-target";

const SYSTEM_MANAGED_LABEL = "stigmer.ai/system-managed";

// ---------------------------------------------------------------------------
// Runner topology — determines available actions per runner
// ---------------------------------------------------------------------------

type RunnerTopology =
  | "desktop-managed"
  | "local-cli"
  | "local-daemon"
  | "remote"
  | "stopped-local";

function deriveTopology(
  localInfo: LocalRunnerInfo | undefined,
  hasLogFile: boolean,
): RunnerTopology {
  if (localInfo) {
    if (localInfo.managed_by_desktop) return "desktop-managed";
    if (localInfo.managed_by_daemon) return "local-daemon";
    return "local-cli";
  }
  if (hasLogFile) return "stopped-local";
  return "remote";
}

function isLocalTopology(topology: RunnerTopology): boolean {
  return topology !== "remote";
}

function canStop(topology: RunnerTopology, phase: RunnerPhase): boolean {
  if (!isActivePhase(phase)) return false;
  return topology === "desktop-managed" || topology === "local-cli";
}

function canStart(topology: RunnerTopology, phase: RunnerPhase): boolean {
  if (phase !== RunnerPhase.STOPPED) return false;
  return topology !== "remote";
}

function canViewLogs(topology: RunnerTopology): boolean {
  return topology !== "remote";
}
const TRANSITIONAL_POLL_MS = 5_000;

const LOG_PANEL_RATIO_KEY = "stigmer:runner-log-panel-ratio";
const DEFAULT_LOG_RATIO = 0.4;
const MIN_LOG_RATIO = 0.15;
const MAX_LOG_RATIO = 0.75;

function readPersistedRatio(): number {
  try {
    const stored = localStorage.getItem(LOG_PANEL_RATIO_KEY);
    if (stored === null) return DEFAULT_LOG_RATIO;
    const parsed = parseFloat(stored);
    if (Number.isFinite(parsed)) {
      return Math.max(MIN_LOG_RATIO, Math.min(MAX_LOG_RATIO, parsed));
    }
  } catch {
    /* private browsing or SSR */
  }
  return DEFAULT_LOG_RATIO;
}

function persistRatio(ratio: number): void {
  try {
    localStorage.setItem(LOG_PANEL_RATIO_KEY, String(ratio));
  } catch {
    /* private browsing */
  }
}

export default function RunnersPage() {
  const { getCredential } = useRunnerCredential();
  const org = useActiveOrgSlug();

  const [hasTransitional, setHasTransitional] = useState(false);
  const {
    runners: serverRunners,
    isLoading: serverLoading,
    error: serverError,
    refetch: refetchServer,
  } = useRunnerList(org, {
    refetchInterval: hasTransitional ? TRANSITIONAL_POLL_MS : false,
  });

  const { localRunners, isLoading: localLoading } = useLocalRunners();
  const { startRunner, isStarting, error: startError, clearError } =
    useStartRunner();
  const { stopRunner, isStopping } = useStopLocalRunner();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [logRunnerName, setLogRunnerName] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [logPanelRatio, setLogPanelRatio] = useState(readPersistedRatio);
  const lastStartedRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHasTransitional(
      serverRunners.some((r) =>
        isTransitionalPhase(r.status?.phase ?? RunnerPhase.UNSPECIFIED),
      ),
    );
  }, [serverRunners]);

  useEffect(() => {
    const unlisteners: Array<Promise<() => void>> = [];

    unlisteners.push(
      onRunnerStarted(() => {
        refetchServer();
      }),
    );

    unlisteners.push(
      onRunnerStopped((payload) => {
        refetchServer();
        if (
          payload.exit_code != null &&
          payload.exit_code !== 0 &&
          payload.name === lastStartedRef.current
        ) {
          setLaunchError(
            `Runner "${payload.name}" exited unexpectedly (code ${payload.exit_code}). Check the runner logs for details.`,
          );
          lastStartedRef.current = null;
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

  // Escape key closes the log panel.
  useEffect(() => {
    if (!logRunnerName) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setLogRunnerName(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [logRunnerName]);

  // Build a lookup from runner name or ID to LocalRunnerInfo for topology
  // derivation. A runner matches local state if either its server-side name
  // or ID appears in the on-disk state files.
  const localInfoByKey = useMemo(() => {
    const map = new Map<string, LocalRunnerInfo>();
    for (const [name, info] of localRunners) {
      map.set(name, info);
      if (info.runner_id) map.set(info.runner_id, info);
    }
    return map;
  }, [localRunners]);

  const sorted = useMemo(
    () => [...serverRunners].sort(phaseThenName),
    [serverRunners],
  );

  // For stopped runners that are not in localRunners, probe whether a log
  // file exists on disk so the UI can offer "View Logs" for crashed runners.
  const [stoppedLogNames, setStoppedLogNames] = useState<ReadonlySet<string>>(
    new Set(),
  );

  useEffect(() => {
    let cancelled = false;
    const stoppedNames = sorted
      .filter((r) => {
        const phase = r.status?.phase ?? RunnerPhase.UNSPECIFIED;
        if (phase !== RunnerPhase.STOPPED && phase !== RunnerPhase.FAILED) return false;
        const name = r.metadata?.name ?? "";
        const id = r.metadata?.id ?? "";
        return !localInfoByKey.has(name) && !localInfoByKey.has(id);
      })
      .map((r) => r.metadata?.name ?? "")
      .filter(Boolean);

    if (stoppedNames.length === 0) {
      setStoppedLogNames(new Set());
      return;
    }

    Promise.all(
      stoppedNames.map(async (name) => {
        try {
          const exists = await invokeCheckRunnerLogExists(name);
          return exists ? name : null;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setStoppedLogNames(new Set(results.filter(Boolean) as string[]));
    });

    return () => { cancelled = true; };
  }, [sorted, localInfoByKey]);

  // Stabilize the runner object passed to RunnerLogViewer so it only
  // updates when display-relevant fields actually change, preventing
  // unnecessary re-renders of the log panel during list polling.
  const logRunnerRaw = useMemo(
    () =>
      logRunnerName
        ? sorted.find((r) => r.metadata?.name === logRunnerName) ?? null
        : null,
    [logRunnerName, sorted],
  );

  const logRunnerRef = useRef<Runner | null>(null);
  const logRunner = useMemo(() => {
    const prev = logRunnerRef.current;
    const next = logRunnerRaw;
    if (prev === null && next === null) return null;
    if (prev === null || next === null) {
      logRunnerRef.current = next;
      return next;
    }
    const samePhase = prev.status?.phase === next.status?.phase;
    const sameExecs = prev.status?.currentExecutions === next.status?.currentExecutions;
    const sameVersion = prev.status?.connectionInfo?.runnerVersion === next.status?.connectionInfo?.runnerVersion;
    if (samePhase && sameExecs && sameVersion) return prev;
    logRunnerRef.current = next;
    return next;
  }, [logRunnerRaw]);

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
      } catch (err) {
        setLaunchError(describeStartFlowError(err));
      } finally {
        setIsLaunching(false);
      }
    },
    [getCredential, org, startRunner],
  );

  const handleStop = useCallback(
    async (name: string) => {
      try {
        await stopRunner(name);
      } catch {
        // Error is captured in the hook.
      }
    },
    [stopRunner],
  );

  const handleRestart = useCallback(
    async (name: string) => {
      setLaunchError(null);
      setIsLaunching(true);

      try {
        await stopRunner(name).catch(() => {});

        const cred = await getCredential(org || undefined);
        const runnerName = await startRunner({
          name,
          token: cred.token || undefined,
          endpoint: toGrpcTarget(cred.endpoint),
          org: org || undefined,
        });
        lastStartedRef.current = runnerName;
        setHasTransitional(true);
        refetchServer();
      } catch (err) {
        setLaunchError(describeStartFlowError(err));
      } finally {
        setIsLaunching(false);
      }
    },
    [getCredential, org, startRunner, stopRunner, refetchServer],
  );

  const handleShowLogs = useCallback((name: string) => {
    setLogRunnerName((prev) => (prev === name ? null : name));
  }, []);

  const handleCloseLogPanel = useCallback(() => {
    setLogRunnerName(null);
  }, []);

  // --- Drag-to-resize for the bottom log panel ---
  const handleResizeStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);

      const container = containerRef.current;
      if (!container) return;

      const onPointerMove = (move: PointerEvent) => {
        const rect = container.getBoundingClientRect();
        const offsetFromBottom = rect.bottom - move.clientY;
        const ratio = offsetFromBottom / rect.height;
        const clamped = Math.max(MIN_LOG_RATIO, Math.min(MAX_LOG_RATIO, ratio));
        setLogPanelRatio(clamped);
      };

      const onPointerUp = () => {
        handle.releasePointerCapture(e.pointerId);
        handle.removeEventListener("pointermove", onPointerMove);
        handle.removeEventListener("pointerup", onPointerUp);
        setLogPanelRatio((current) => {
          persistRatio(current);
          return current;
        });
      };

      handle.addEventListener("pointermove", onPointerMove);
      handle.addEventListener("pointerup", onPointerUp);
    },
    [],
  );

  const isLoading = serverLoading || localLoading;
  const logPanelOpen = logRunnerName !== null;

  return (
    <div ref={containerRef} className="flex h-full flex-col overflow-hidden">
      {/* Top section: header + runner list */}
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        style={logPanelOpen ? { flex: `0 0 ${(1 - logPanelRatio) * 100}%` } : undefined}
      >
        {/* Header */}
        <div className="flex flex-none items-center justify-between px-6 pb-4 pt-6">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Runners</h1>
            <p className="text-xs text-muted-foreground">
              Agent runners registered in your organization.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              clearError();
              setLaunchError(null);
              setDialogOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover"
          >
            <Play size={12} />
            Start Runner
          </button>
        </div>

        {/* Scrollable runner list */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4">
          {isLoading && (
            <div
              className="space-y-2"
              aria-busy="true"
              aria-label="Loading runners"
            >
              {Array.from({ length: 3 }, (_, i) => (
                <div
                  key={i}
                  className="h-[4.25rem] animate-pulse rounded-lg bg-muted-subtle"
                />
              ))}
            </div>
          )}

          {!isLoading && serverError && (
            <p className="text-xs text-destructive" role="alert">
              {getUserMessage(serverError)}
            </p>
          )}

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

          {!dialogOpen && launchError && (
            <ErrorBanner
              message={launchError}
              onDismiss={() => setLaunchError(null)}
            />
          )}

          {!isLoading && !serverError && sorted.length > 0 && (
            <div className="space-y-2" role="list" aria-label="Runners">
              {sorted.map((runner) => {
                const runnerId = runner.metadata?.id ?? "";
                const runnerName = runner.metadata?.name ?? "";
                const localInfo =
                  localInfoByKey.get(runnerName) ??
                  localInfoByKey.get(runnerId);
                const hasLogFile = stoppedLogNames.has(runnerName);
                const topology = deriveTopology(localInfo, hasLogFile);

                return (
                  <RunnerRow
                    key={runnerId}
                    runner={runner}
                    topology={topology}
                    isSelected={runnerName === logRunnerName}
                    isStopping={isStopping}
                    isLaunching={isLaunching || isStarting}
                    onStop={() => handleStop(runnerName)}
                    onStart={() => handleRestart(runnerName)}
                    onShowLogs={() => handleShowLogs(runnerName)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Resize handle — visible only when log panel is open */}
      {logPanelOpen && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize log panel"
          tabIndex={0}
          onPointerDown={handleResizeStart}
          className="group relative flex h-2 flex-none cursor-row-resize items-center justify-center border-y border-border bg-background hover:bg-accent-hover"
        >
          <div className="h-0.5 w-8 rounded-full bg-muted-foreground/30 transition-colors group-hover:bg-muted-foreground/60" />
        </div>
      )}

      {/* Bottom log panel */}
      {logPanelOpen && (
        <div
          className="flex min-h-0 flex-col overflow-hidden"
          style={{ flex: `0 0 ${logPanelRatio * 100}%` }}
        >
          <RunnerLogViewer
            runnerName={logRunnerName}
            runner={logRunner}
            onClose={handleCloseLogPanel}
          />
        </div>
      )}

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
// RunnerRow — two-line card layout
// ---------------------------------------------------------------------------

function RunnerRow({
  runner,
  topology,
  isSelected,
  isStopping,
  isLaunching,
  onStop,
  onStart,
  onShowLogs,
}: {
  runner: Runner;
  topology: RunnerTopology;
  isSelected: boolean;
  isStopping: boolean;
  isLaunching: boolean;
  onStop: () => void;
  onStart: () => void;
  onShowLogs: () => void;
}) {
  const name = runner.metadata?.name ?? "Unnamed";
  const phase = runner.status?.phase ?? RunnerPhase.UNSPECIFIED;
  const active = isActivePhase(phase);
  const local = isLocalTopology(topology);
  const systemManaged =
    runner.metadata?.labels[SYSTEM_MANAGED_LABEL] === "true";

  const showLogs = canViewLogs(topology);
  const showStop = canStop(topology, phase);
  const showStart = canStart(topology, phase);
  const hasActions = showLogs || showStop || showStart;

  const info = runner.status?.connectionInfo;
  const hostname = info?.hostname;
  const osArch =
    info?.os && info?.arch ? `${info.os}/${info.arch}` : undefined;
  const executions = runner.status?.currentExecutions ?? 0;
  const lastHeartbeat = runner.status?.lastHeartbeatAt;

  const metaSegments: string[] = [];
  if (hostname) metaSegments.push(hostname);
  if (osArch) metaSegments.push(osArch);
  if (active) metaSegments.push(`${executions} exec${executions !== 1 ? "s" : ""}`);
  if (lastHeartbeat) metaSegments.push(formatRelativeTime(timestampDate(lastHeartbeat)));

  return (
    <div
      role="listitem"
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        isSelected
          ? "border-primary bg-primary-subtle"
          : "border-border-muted hover:border-border",
        !active && !isSelected && "opacity-60",
      )}
    >
      <RunnerIcon size={16} className="mt-0.5" />

      <div className="min-w-0 flex-1">
        {/* Line 1: name + badges + phase */}
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {name}
          </span>
          {local && (
            <span className="shrink-0 rounded bg-primary-subtle px-1.5 py-0.5 text-[0.6rem] font-medium text-primary">
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

        {/* Line 2: metadata */}
        {metaSegments.length > 0 && (
          <p className="mt-0.5 truncate text-[0.65rem] text-muted-foreground">
            {metaSegments.join(" \u00b7 ")}
          </p>
        )}
      </div>

      {hasActions && (
        <div className="flex shrink-0 items-center gap-1 pt-0.5">
          {showLogs && (
            <button
              type="button"
              onClick={onShowLogs}
              title="View logs"
              aria-label={`View logs for ${name}`}
              className={cn(
                "rounded p-1.5 transition-colors",
                isSelected
                  ? "bg-primary-subtle text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              <ScrollText size={14} />
            </button>
          )}
          {showStop && (
            <button
              type="button"
              onClick={onStop}
              disabled={isStopping}
              title="Stop runner"
              aria-label={`Stop ${name}`}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive-subtle hover:text-destructive disabled:opacity-50"
            >
              <Square size={14} />
            </button>
          )}
          {showStart && (
            <button
              type="button"
              onClick={onStart}
              disabled={isLaunching}
              title="Start runner"
              aria-label={`Start ${name}`}
              className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-primary-subtle hover:text-primary disabled:opacity-50"
            >
              <Play size={14} />
            </button>
          )}
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

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function ErrorBanner({
  message,
  onDismiss,
}: {
  readonly message: string;
  readonly onDismiss: () => void;
}) {
  const { primary, details } = extractErrorParts(message);

  return (
    <div
      role="alert"
      className="mb-2 rounded-lg border border-destructive bg-destructive-subtle px-3 py-2 text-xs text-destructive"
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">{primary}</span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="shrink-0 rounded p-0.5 transition-colors hover:bg-destructive-subtle"
        >
          <X size={12} />
        </button>
      </div>
      {details && (
        <details className="mt-1.5">
          <summary className="cursor-pointer select-none text-[10px] opacity-70 hover:opacity-100">
            Show details
          </summary>
          <pre className="mt-1 whitespace-pre-wrap break-all text-[10px] opacity-70">
            {details}
          </pre>
        </details>
      )}
    </div>
  );
}

interface ErrorParts {
  readonly primary: string;
  readonly details: string | null;
}

function describeStartFlowError(err: unknown): string {
  const message = String(err).trim();
  if (!message || message === "undefined" || message === "[object Object]") {
    return "Failed to start runner. Check the runner logs for details.";
  }
  return message;
}

function extractErrorParts(message: string): ErrorParts {
  const errorIdx = message.lastIndexOf("Error: ");
  if (errorIdx >= 0) {
    const primary = message.slice(errorIdx + "Error: ".length).trim();
    const details = message.slice(0, errorIdx).trim() || null;
    return { primary, details };
  }
  return { primary: message, details: null };
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
