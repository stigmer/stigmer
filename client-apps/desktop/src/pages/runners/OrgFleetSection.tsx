import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import {
  phaseLabel,
  phaseDotColor,
  isActivePhase,
  PHASE_SORT_ORDER,
  RunnerIcon,
  PhaseBadge,
  formatRelativeTime,
  EmptyState,
} from "@stigmer/react";
import type { Runner } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { RunnerPhase } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/enum_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { Play, Square, ScrollText, Loader2, X, ArrowUpDown } from "lucide-react";
import {
  invokeCheckRunnerLogExists,
  type LocalRunnerInfo,
} from "../../hooks/tauri";

const SYSTEM_MANAGED_LABEL = "stigmer.ai/system-managed";
const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_THRESHOLD = 5;

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
// Sort
// ---------------------------------------------------------------------------

type FleetSortKey = "phase" | "name" | "heartbeat" | "executions";

const SORT_LABELS: Record<FleetSortKey, string> = {
  phase: "Phase",
  name: "Name",
  heartbeat: "Last heartbeat",
  executions: "Executions",
};

function buildComparator(
  sortKey: FleetSortKey,
  direction: "asc" | "desc",
): (a: Runner, b: Runner) => number {
  const dir = direction === "desc" ? -1 : 1;

  return (a, b) => {
    let order: number;

    switch (sortKey) {
      case "name":
        order = (a.metadata?.name ?? "").localeCompare(
          b.metadata?.name ?? "",
        );
        break;

      case "heartbeat": {
        const ha = a.status?.lastHeartbeatAt;
        const hb = b.status?.lastHeartbeatAt;
        const ta = ha ? timestampDate(ha).getTime() : 0;
        const tb = hb ? timestampDate(hb).getTime() : 0;
        order = ta - tb;
        break;
      }

      case "executions":
        order =
          (a.status?.currentExecutions ?? 0) -
          (b.status?.currentExecutions ?? 0);
        break;

      case "phase":
      default: {
        const pa = a.status?.phase ?? RunnerPhase.UNSPECIFIED;
        const pb = b.status?.phase ?? RunnerPhase.UNSPECIFIED;
        order = PHASE_SORT_ORDER[pa] - PHASE_SORT_ORDER[pb];
        if (order !== 0) return order * dir;
        return (a.metadata?.name ?? "").localeCompare(
          b.metadata?.name ?? "",
        );
      }
    }

    if (order !== 0) return order * dir;
    return (a.metadata?.name ?? "").localeCompare(b.metadata?.name ?? "");
  };
}

// ---------------------------------------------------------------------------
// Phase filter chip definitions
// ---------------------------------------------------------------------------

const FILTERABLE_PHASES = [
  RunnerPhase.READY,
  RunnerPhase.BUSY,
  RunnerPhase.STARTING,
  RunnerPhase.STOPPED,
  RunnerPhase.FAILED,
] as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface OrgFleetSectionProps {
  readonly runners: readonly Runner[];
  readonly localInfoByKey: ReadonlyMap<string, LocalRunnerInfo>;
  readonly thisMachineRunnerKey: string | null;
  readonly isStopping: boolean;
  readonly isLaunching: boolean;
  readonly onStop: (name: string) => void;
  readonly onStart: (name: string) => void;
  readonly onShowLogs: (name: string) => void;
  readonly onViewDetail?: (runnerId: string) => void;
  readonly selectedLogRunner: string | null;
}

/**
 * Organization runner fleet list with phase filtering, name search,
 * configurable sorting, and proper empty states. Excludes the runner
 * shown in ThisMachineCard.
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
  onViewDetail,
  selectedLogRunner,
}: OrgFleetSectionProps) {
  // ---- Filter / sort state ----
  const [activePhases, setActivePhases] = useState<ReadonlySet<RunnerPhase>>(
    new Set(),
  );
  const [searchInput, setSearchInput] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [sortKey, setSortKey] = useState<FleetSortKey>("phase");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  // ---- Debounce search ----
  useEffect(() => {
    const timer = setTimeout(
      () => setDebouncedQuery(searchInput.trim()),
      SEARCH_DEBOUNCE_MS,
    );
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ---- Close sort dropdown on outside click / Escape ----
  useEffect(() => {
    if (!sortDropdownOpen) return;

    function handlePointerDown(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortDropdownOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSortDropdownOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sortDropdownOpen]);

  // ---- Exclude this machine ----
  const fleetRunners = useMemo(() => {
    if (!thisMachineRunnerKey) return runners;
    return runners.filter((r) => {
      const name = r.metadata?.name ?? "";
      const id = r.metadata?.id ?? "";
      return name !== thisMachineRunnerKey && id !== thisMachineRunnerKey;
    });
  }, [runners, thisMachineRunnerKey]);

  // ---- Phase counts (computed on the unfiltered fleet) ----
  const phaseCounts = useMemo(() => {
    const counts = new Map<RunnerPhase, number>();
    for (const r of fleetRunners) {
      const phase = r.status?.phase ?? RunnerPhase.UNSPECIFIED;
      counts.set(phase, (counts.get(phase) ?? 0) + 1);
    }
    return counts;
  }, [fleetRunners]);

  // ---- Apply filters and sort ----
  const hasActiveFilters = activePhases.size > 0 || debouncedQuery.length > 0;

  const displayRunners = useMemo(() => {
    let result = [...fleetRunners];

    if (activePhases.size > 0) {
      result = result.filter((r) =>
        activePhases.has(r.status?.phase ?? RunnerPhase.UNSPECIFIED),
      );
    }

    if (debouncedQuery.length > 0) {
      const q = debouncedQuery.toLowerCase();
      result = result.filter((r) => {
        const name = (r.metadata?.name ?? "").toLowerCase();
        const hostname = (
          r.status?.connectionInfo?.hostname ?? ""
        ).toLowerCase();
        return name.includes(q) || hostname.includes(q);
      });
    }

    result.sort(buildComparator(sortKey, sortDirection));
    return result;
  }, [fleetRunners, activePhases, debouncedQuery, sortKey, sortDirection]);

  // ---- Stopped log file detection ----
  const [stoppedLogNames, setStoppedLogNames] = useState<ReadonlySet<string>>(
    new Set(),
  );

  useEffect(() => {
    let cancelled = false;
    const stoppedNames = fleetRunners
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
  }, [fleetRunners, localInfoByKey]);

  // ---- Phase chip toggle handler ----
  const handleTogglePhase = useCallback((phase: RunnerPhase) => {
    setActivePhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) {
        next.delete(phase);
      } else {
        next.add(phase);
      }
      return next;
    });
  }, []);

  // ---- Sort handler ----
  const handleSortSelect = useCallback(
    (key: FleetSortKey) => {
      if (key === sortKey) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
      } else {
        setSortKey(key);
        setSortDirection("asc");
      }
      setSortDropdownOpen(false);
    },
    [sortKey],
  );

  // ---- Clear all filters ----
  const clearFilters = useCallback(() => {
    setActivePhases(new Set());
    setSearchInput("");
    setDebouncedQuery("");
  }, []);

  // ---- Fleet summary ----
  const summaryText = useMemo(() => {
    const total = fleetRunners.length;
    if (total === 0) return null;

    const readyCount =
      (phaseCounts.get(RunnerPhase.READY) ?? 0) +
      (phaseCounts.get(RunnerPhase.BUSY) ?? 0);

    return `${readyCount} of ${total} active`;
  }, [fleetRunners.length, phaseCounts]);

  const showSearch = fleetRunners.length > SEARCH_THRESHOLD;

  return (
    <section>
      {/* Section header with summary */}
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Organization Runners
        </h2>
        {summaryText && (
          <span className="text-xs text-muted-foreground">{summaryText}</span>
        )}
      </div>

      {/* Filter bar: phase chips + search + sort */}
      {fleetRunners.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {/* Phase chips */}
          <div className="flex flex-wrap items-center gap-1">
            {FILTERABLE_PHASES.map((phase) => {
              const count = phaseCounts.get(phase) ?? 0;
              if (count === 0) return null;
              const isActive = activePhases.has(phase);
              return (
                <button
                  key={phase}
                  type="button"
                  onClick={() => handleTogglePhase(phase)}
                  aria-pressed={isActive}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.65rem] font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground hover:bg-accent-hover hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-1.5 w-1.5 rounded-full",
                      isActive ? "bg-primary-foreground" : phaseDotColor(phase),
                    )}
                    aria-hidden="true"
                  />
                  {phaseLabel(phase)}
                  <span
                    className={cn(
                      "text-[0.6rem]",
                      isActive
                        ? "text-primary-foreground/80"
                        : "text-muted-foreground",
                    )}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Search */}
          {showSearch && (
            <div className="relative">
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Filter by name\u2026"
                aria-label="Filter runners by name or hostname"
                className={cn(
                  "h-7 w-40 rounded-md border border-border bg-background px-2.5 text-xs text-foreground",
                  "placeholder:text-muted-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              />
              {searchInput.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput("");
                    setDebouncedQuery("");
                  }}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )}

          {/* Sort dropdown */}
          <div ref={sortRef} className="relative">
            <button
              type="button"
              onClick={() => setSortDropdownOpen((prev) => !prev)}
              aria-haspopup="listbox"
              aria-expanded={sortDropdownOpen}
              aria-label={`Sort by ${SORT_LABELS[sortKey]}, ${sortDirection === "asc" ? "ascending" : "descending"}`}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md border border-border bg-background px-2 text-xs text-muted-foreground",
                "hover:text-foreground transition-colors",
              )}
            >
              <ArrowUpDown size={12} />
              <span>{SORT_LABELS[sortKey]}</span>
            </button>

            {sortDropdownOpen && (
              <div
                role="listbox"
                aria-label="Sort options"
                className="absolute right-0 top-full z-10 mt-1 min-w-[10rem] rounded-md border border-border bg-popover py-1 shadow-md"
              >
                {(Object.keys(SORT_LABELS) as FleetSortKey[]).map((key) => {
                  const isCurrent = key === sortKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="option"
                      aria-selected={isCurrent}
                      onClick={() => handleSortSelect(key)}
                      className={cn(
                        "flex w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors",
                        isCurrent
                          ? "text-foreground font-medium"
                          : "text-muted-foreground hover:bg-accent-hover hover:text-foreground",
                      )}
                    >
                      {SORT_LABELS[key]}
                      {isCurrent && (
                        <span className="text-[0.6rem] text-muted-foreground">
                          {sortDirection === "asc" ? "\u2191" : "\u2193"}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty states */}
      {fleetRunners.length === 0 && (
        <EmptyState
          variant="first-use"
          resourceLabel="runners"
          icon={<RunnerIcon size={24} />}
          title="No other runners in your organization"
          description="Team members can connect their machines with stigmer up."
        />
      )}

      {fleetRunners.length > 0 && displayRunners.length === 0 && (
        <EmptyState
          variant="zero-results"
          resourceLabel="runners"
          title="No runners match your filters"
          description="Try adjusting your search or removing some filters."
          action={{ label: "Clear filters", onClick: clearFilters }}
        />
      )}

      {/* Runner list */}
      {displayRunners.length > 0 && (
        <div className="space-y-2" role="list" aria-label="Organization runners">
          {displayRunners.map((runner) => {
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
                onViewDetail={
                  onViewDetail ? () => onViewDetail(runnerId) : undefined
                }
              />
            );
          })}
        </div>
      )}
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
  onViewDetail,
}: {
  runner: Runner;
  topology: RunnerTopology;
  isSelected: boolean;
  isStopping: boolean;
  isLaunching: boolean;
  onStop: () => void;
  onStart: () => void;
  onShowLogs: () => void;
  onViewDetail?: () => void;
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
      onClick={onViewDetail}
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors",
        isSelected
          ? "border-primary bg-primary-subtle"
          : "border-border-muted hover:border-border",
        !active && !isSelected && "opacity-60",
        onViewDetail && "cursor-pointer",
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
              <span className="text-[0.65rem] text-primary">Starting\u2026</span>
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
        <div
          className="flex shrink-0 items-center gap-1 pt-0.5"
          onClick={(e) => e.stopPropagation()}
        >
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
