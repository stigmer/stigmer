import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import {
  phaseLabel,
  phaseDotColor,
  isActivePhase,
  isTransitionalPhase,
  PHASE_SORT_ORDER,
} from "@stigmer/react";
import type { Runner } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { RunnerPhase } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/enum_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Play, Square, ScrollText, Loader2 } from "lucide-react";
import {
  invokeCheckRunnerLogExists,
  type LocalRunnerInfo,
} from "../../hooks/tauri";

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

function canStart(_topology: RunnerTopology, phase: RunnerPhase): boolean {
  return phase === RunnerPhase.STOPPED;
}

function canViewLogs(topology: RunnerTopology): boolean {
  return topology !== "remote";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface OrgFleetSectionProps {
  readonly runners: readonly Runner[];
  readonly localInfoByKey: ReadonlyMap<string, LocalRunnerInfo>;
  /** Name or ID of this machine's runner to exclude from the list. */
  readonly thisMachineRunnerKey: string | null;
  readonly isStopping: boolean;
  readonly isLaunching: boolean;
  readonly onStop: (name: string) => void;
  readonly onStart: (name: string) => void;
  readonly onShowLogs: (name: string) => void;
  readonly selectedLogRunner: string | null;
}

/**
 * Organization runner fleet list, excluding the runner shown in
 * ThisMachineCard. Preserves the existing topology-aware row layout,
 * stopped-log detection, and action buttons from the original RunnersPage.
 */
export function OrgFleetSection({
  runners,
  localInfoByKey,
  thisMachineRunnerKey,
  isStopping,
  isLaunching,
  onStop,
  onStart,
  onShowLogs,
  selectedLogRunner,
}: OrgFleetSectionProps) {
  const filtered = useMemo(() => {
    const sorted = [...runners].sort(phaseThenName);
    if (!thisMachineRunnerKey) return sorted;
    return sorted.filter((r) => {
      const name = r.metadata?.name ?? "";
      const id = r.metadata?.id ?? "";
      return name !== thisMachineRunnerKey && id !== thisMachineRunnerKey;
    });
  }, [runners, thisMachineRunnerKey]);

  const [stoppedLogNames, setStoppedLogNames] = useState<ReadonlySet<string>>(
    new Set(),
  );

  useEffect(() => {
    let cancelled = false;
    const stoppedNames = filtered
      .filter((r) => {
        const phase = r.status?.phase ?? RunnerPhase.UNSPECIFIED;
        if (phase !== RunnerPhase.STOPPED && phase !== RunnerPhase.FAILED)
          return false;
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

    return () => {
      cancelled = true;
    };
  }, [filtered, localInfoByKey]);

  if (filtered.length === 0) return null;

  return (
    <section>
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Organization Runners
      </h2>
      <div className="space-y-2" role="list" aria-label="Organization runners">
        {filtered.map((runner) => {
          const runnerId = runner.metadata?.id ?? "";
          const runnerName = runner.metadata?.name ?? "";
          const localInfo =
            localInfoByKey.get(runnerName) ?? localInfoByKey.get(runnerId);
          const hasLogFile = stoppedLogNames.has(runnerName);
          const topology = deriveTopology(localInfo, hasLogFile);

          return (
            <RunnerRow
              key={runnerId}
              runner={runner}
              topology={topology}
              isSelected={runnerName === selectedLogRunner}
              isStopping={isStopping}
              isLaunching={isLaunching}
              onStop={() => onStop(runnerName)}
              onStart={() => onStart(runnerName)}
              onShowLogs={() => onShowLogs(runnerName)}
            />
          );
        })}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// RunnerRow
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
  if (active)
    metaSegments.push(`${executions} exec${executions !== 1 ? "s" : ""}`);
  if (lastHeartbeat)
    metaSegments.push(formatRelativeTime(timestampDate(lastHeartbeat)));

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
          {isLaunching && showStart ? (
            <span className="inline-flex shrink-0 items-center gap-1">
              <Loader2
                size={10}
                className="animate-spin text-primary"
                aria-hidden="true"
              />
              <span className="text-[0.65rem] text-primary">Starting…</span>
            </span>
          ) : (
            <PhaseBadge phase={phase} />
          )}
        </div>

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
              title={isLaunching ? "Starting runner\u2026" : "Start runner"}
              aria-label={
                isLaunching ? `Starting ${name}\u2026` : `Start ${name}`
              }
              className={cn(
                "rounded p-1.5 transition-colors disabled:opacity-50",
                isLaunching
                  ? "text-primary"
                  : "text-muted-foreground hover:bg-primary-subtle hover:text-primary",
              )}
            >
              {isLaunching ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
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
  const starting = phase === RunnerPhase.STARTING;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {starting ? (
        <Loader2
          size={10}
          className="animate-spin text-primary"
          aria-hidden="true"
        />
      ) : (
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full ${phaseDotColor(phase)}`}
          aria-hidden="true"
        />
      )}
      <span
        className={cn(
          "text-[0.65rem]",
          starting ? "text-primary" : "text-muted-foreground",
        )}
      >
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
