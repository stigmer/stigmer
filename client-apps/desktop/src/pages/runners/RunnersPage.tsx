import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getUserMessage } from "@stigmer/sdk";
import {
  useRunnerList,
  useActiveOrgSlug,
  useRunnerCredential,
  isTransitionalPhase,
} from "@stigmer/react";
import type { Runner } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { RunnerPhase } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/enum_pb";
import {
  onRunnerStarted,
  onRunnerStopped,
  onRunnerError,
  type LocalRunnerInfo,
} from "../../hooks/tauri";
import { useLocalRunners } from "../../hooks/useLocalRunners";
import { useStartRunner } from "../../hooks/useStartRunner";
import { useStopLocalRunner } from "../../hooks/useStopLocalRunner";
import { useLocalRunnerStatus } from "../../hooks/useLocalRunnerStatus";
import { useAutoEnsure } from "../../hooks/useAutoEnsure";
import { ThisMachineCard } from "./ThisMachineCard";
import { OrgFleetSection } from "./OrgFleetSection";
import { RunnerLogViewer } from "./RunnerLogViewer";
import { toGrpcTarget } from "../../lib/grpc-target";

const SESSION_EXPIRED_MESSAGE =
  "Your session has expired. Please sign out and sign back in to start a runner.";
const NO_ORG_MESSAGE =
  "No organization selected. Switch to an organization before starting a runner.";

const TRANSITIONAL_POLL_MS = 5_000;
const RESTART_GRACE_MS = 10_000;

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
  const navigate = useNavigate();
  const { getCredential } = useRunnerCredential();
  const org = useActiveOrgSlug();

  // ---- Server-side runner list ----
  const [hasTransitional, setHasTransitional] = useState(false);
  const {
    runners: serverRunners,
    isLoading: serverLoading,
    error: serverError,
    refetch: refetchServer,
  } = useRunnerList(org, {
    refetchInterval: hasTransitional ? TRANSITIONAL_POLL_MS : false,
  });

  // ---- Local process state ----
  const { localRunners, isLoading: localLoading } = useLocalRunners();
  const { startRunner, isStarting } = useStartRunner();
  const { stopRunner, isStopping } = useStopLocalRunner();

  // ---- Local runner status (control socket) ----
  const { status: localStatus, setUrgent } = useLocalRunnerStatus();

  // ---- Auto-ensure ----
  const onEnsure = useCallback(async (): Promise<string> => {
    if (!org) throw new Error(NO_ORG_MESSAGE);
    const cred = await getCredential(org);
    if (!cred.token) throw new Error(SESSION_EXPIRED_MESSAGE);
    return startRunner({
      token: cred.token,
      endpoint: toGrpcTarget(cred.endpoint),
      org,
    });
  }, [org, getCredential, startRunner]);

  const { state: autoEnsureState, error: autoEnsureError, enable, disable, retry } =
    useAutoEnsure(localStatus, org ? onEnsure : null);

  // Accelerate polling during startup ensure
  useEffect(() => {
    setUrgent(autoEnsureState === "ensuring");
  }, [autoEnsureState, setUrgent]);

  // ---- UI state ----
  const [logRunnerName, setLogRunnerName] = useState<string | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  const [logPanelRatio, setLogPanelRatio] = useState(readPersistedRatio);
  const lastStartedRef = useRef<string | null>(null);
  const restartGraceRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ---- Transitional polling ----
  useEffect(() => {
    const inGrace =
      restartGraceRef.current !== null &&
      Date.now() - restartGraceRef.current < RESTART_GRACE_MS;

    const anyTransitional = serverRunners.some((r) =>
      isTransitionalPhase(r.status?.phase ?? RunnerPhase.UNSPECIFIED),
    );

    if (!anyTransitional && !inGrace) {
      setHasTransitional(false);
      return;
    }

    setHasTransitional(true);

    if (inGrace && !anyTransitional) {
      const remaining =
        RESTART_GRACE_MS - (Date.now() - restartGraceRef.current!);
      const timer = setTimeout(() => {
        restartGraceRef.current = null;
        setHasTransitional(false);
      }, remaining);
      return () => clearTimeout(timer);
    }
  }, [serverRunners]);

  // ---- Tauri lifecycle events ----
  useEffect(() => {
    const unlisteners: Array<Promise<() => void>> = [];

    unlisteners.push(onRunnerStarted(() => refetchServer()));

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
      for (const p of unlisteners) p.then((unlisten) => unlisten());
    };
  }, [refetchServer]);

  // ---- Escape closes log panel ----
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

  // ---- Local info lookup ----
  const localInfoByKey = useMemo(() => {
    const map = new Map<string, LocalRunnerInfo>();
    for (const [name, info] of localRunners) {
      map.set(name, info);
      if (info.runner_id) map.set(info.runner_id, info);
    }
    return map;
  }, [localRunners]);

  // ---- Match this machine's runner to a server-side resource ----
  const thisMachineRunner = useMemo<Runner | null>(() => {
    if (!localStatus.name && !localStatus.runner_id) return null;
    return (
      serverRunners.find(
        (r) =>
          r.metadata?.name === localStatus.name ||
          r.metadata?.id === localStatus.runner_id,
      ) ?? null
    );
  }, [serverRunners, localStatus.name, localStatus.runner_id]);

  const thisMachineKey = localStatus.name ?? localStatus.runner_id ?? null;

  // ---- Stabilize runner for log viewer ----
  const logRunnerRaw = useMemo(
    () =>
      logRunnerName
        ? serverRunners.find((r) => r.metadata?.name === logRunnerName) ?? null
        : null,
    [logRunnerName, serverRunners],
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
    const sameExecs =
      prev.status?.currentExecutions === next.status?.currentExecutions;
    const sameVersion =
      prev.status?.connectionInfo?.runnerVersion ===
      next.status?.connectionInfo?.runnerVersion;
    if (samePhase && sameExecs && sameVersion) return prev;
    logRunnerRef.current = next;
    return next;
  }, [logRunnerRaw]);

  // ---- Auto-ensure handlers ----
  const handleEnable = useCallback(async () => {
    if (!org) {
      setLaunchError(NO_ORG_MESSAGE);
      return;
    }
    try {
      const cred = await getCredential(org);
      if (!cred.token) {
        setLaunchError(SESSION_EXPIRED_MESSAGE);
        return;
      }
    } catch {
      // Credential check is best-effort; ensure will surface its own errors.
    }
    await enable();
  }, [org, getCredential, enable]);

  const handleDismissPrompt = useCallback(() => disable(), [disable]);

  // ---- Fleet action handlers ----
  const handleFleetStop = useCallback(
    async (name: string) => {
      try {
        const cred = await getCredential(org || undefined);
        await stopRunner(name, {
          token: cred.token || undefined,
          endpoint: toGrpcTarget(cred.endpoint),
          org: org || undefined,
        });
      } catch {
        // Error captured in hook.
      }
    },
    [getCredential, org, stopRunner],
  );

  const handleFleetStart = useCallback(
    async (name: string) => {
      setLaunchError(null);
      setIsLaunching(true);

      try {
        const cred = await getCredential(org || undefined);
        if (!cred.token) {
          setLaunchError(SESSION_EXPIRED_MESSAGE);
          return;
        }
        if (!org) {
          setLaunchError(NO_ORG_MESSAGE);
          return;
        }

        await stopRunner(name).catch(() => {});

        const runnerName = await startRunner({
          name,
          token: cred.token,
          endpoint: toGrpcTarget(cred.endpoint),
          org,
        });
        lastStartedRef.current = runnerName;
        restartGraceRef.current = Date.now();
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

  const handleThisMachineRestart = useCallback(async () => {
    const name = localStatus.name;
    if (!name) return;
    setIsLaunching(true);
    try {
      const cred = await getCredential(org || undefined);
      if (!cred.token) {
        setLaunchError(SESSION_EXPIRED_MESSAGE);
        return;
      }
      if (!org) {
        setLaunchError(NO_ORG_MESSAGE);
        return;
      }
      await stopRunner(name).catch(() => {});
      const runnerName = await startRunner({
        name,
        token: cred.token,
        endpoint: toGrpcTarget(cred.endpoint),
        org,
      });
      lastStartedRef.current = runnerName;
      restartGraceRef.current = Date.now();
      setHasTransitional(true);
      refetchServer();
    } catch (err) {
      setLaunchError(describeStartFlowError(err));
    } finally {
      setIsLaunching(false);
    }
  }, [localStatus.name, getCredential, org, startRunner, stopRunner, refetchServer]);

  const handleShowLogs = useCallback((name: string) => {
    setLogRunnerName((prev) => (prev === name ? null : name));
  }, []);

  const handleShowThisMachineLogs = useCallback(() => {
    const name = localStatus.name;
    if (name) setLogRunnerName((prev) => (prev === name ? null : name));
  }, [localStatus.name]);

  const handleCloseLogPanel = useCallback(() => {
    setLogRunnerName(null);
  }, []);

  // ---- Drag-to-resize ----
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
      {/* Top section: header + this machine card + fleet list */}
      <div
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
        style={
          logPanelOpen
            ? { flex: `0 0 ${(1 - logPanelRatio) * 100}%` }
            : undefined
        }
      >
        {/* Header */}
        <div className="flex flex-none items-center justify-between px-6 pb-4 pt-6">
          <div>
            <h1 className="text-lg font-semibold text-foreground">Runners</h1>
            <p className="text-xs text-muted-foreground">
              Manage this computer&apos;s runner and view your organization&apos;s fleet.
            </p>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 pb-4">
          {/* This Machine */}
          <section>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              This Machine
            </h2>
            <ThisMachineCard
              autoEnsureState={autoEnsureState}
              localStatus={localStatus}
              serverRunner={thisMachineRunner}
              error={autoEnsureError ?? launchError}
              onEnable={handleEnable}
              onDisable={disable}
              onRetry={retry}
              onDismissPrompt={handleDismissPrompt}
              onShowLogs={handleShowThisMachineLogs}
              onRestart={handleThisMachineRestart}
              isRestarting={isLaunching || isStarting}
            />
          </section>

          {/* Server error */}
          {!isLoading && serverError && (
            <p className="text-xs text-destructive" role="alert">
              {getUserMessage(serverError)}
            </p>
          )}

          {/* Organization fleet */}
          {!isLoading && !serverError && (
            <OrgFleetSection
              runners={serverRunners}
              localInfoByKey={localInfoByKey}
              thisMachineRunnerKey={thisMachineKey}
              isStopping={isStopping}
              isLaunching={isLaunching || isStarting}
              onStop={handleFleetStop}
              onStart={handleFleetStart}
              onShowLogs={handleShowLogs}
              onViewDetail={(runnerId) => navigate(`/runners/${runnerId}`)}
              selectedLogRunner={logRunnerName}
            />
          )}

          {/* Loading skeleton for fleet */}
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
        </div>
      </div>

      {/* Resize handle */}
      {logPanelOpen && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize log panel"
          tabIndex={0}
          onPointerDown={handleResizeStart}
          className="group relative flex h-2 flex-none cursor-row-resize items-center justify-center border-y border-border bg-background hover:bg-accent-hover"
        >
          <div className="h-0.5 w-8 rounded-full bg-border transition-colors group-hover:bg-muted-foreground" />
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function describeStartFlowError(err: unknown): string {
  const message = String(err).trim();
  if (!message || message === "undefined" || message === "[object Object]") {
    return "Failed to start runner. Check the runner logs for details.";
  }
  return message;
}
