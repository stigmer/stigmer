"use client";

import { useMemo } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { RunnerPhase } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/enum_pb";
import type { Runner } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { useRunnerList } from "./useRunnerList";
import {
  isActivePhase,
  phaseLabel,
  phaseDotColor,
  PHASE_SORT_ORDER,
} from "./phase";

const SYSTEM_MANAGED_LABEL = "stigmer.ai/system-managed";

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
   * and labeled `stigmer.ai/system-managed: "true"`. Including them
   * gives admins full visibility into all compute resources.
   *
   * @default true
   */
  readonly includeSystemManaged?: boolean;
  /** Expose refetch so parent components can trigger a list refresh. */
  readonly onRefetchRef?: (refetch: () => void) => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Read-only admin panel that displays all runners in an organization.
 *
 * Each runner is rendered as a card row showing name, phase indicator,
 * machine information, and operational metadata. Rows are sorted by
 * phase (active runners first) then alphabetically by name.
 *
 * Designed for the Settings > Runners page but embeddable in any
 * context that needs runner fleet visibility. Fetches data via
 * {@link useRunnerList} — no Console-specific dependencies.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <RunnerListPanel org="acme" />
 *
 * <RunnerListPanel
 *   org="acme"
 *   includeSystemManaged={false}
 *   onRefetchRef={(refetch) => { refetchRef.current = refetch; }}
 * />
 * ```
 */
export function RunnerListPanel({
  org,
  includeSystemManaged = true,
  onRefetchRef,
  className,
}: RunnerListPanelProps) {
  const { runners, isLoading, error, refetch } = useRunnerList(org, {
    includeSystemManaged,
  });

  if (onRefetchRef) {
    onRefetchRef(refetch);
  }

  const sorted = useMemo(
    () => [...runners].sort(phaseThenName),
    [runners],
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
            className="bg-muted/40 h-14 animate-pulse rounded-lg"
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
        <p className="text-muted-foreground/70 max-w-xs text-[0.65rem]">
          Start a runner with{" "}
          <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.6rem]">
            stigmer up
          </code>{" "}
          or{" "}
          <code className="bg-muted rounded px-1 py-0.5 font-mono text-[0.6rem]">
            stigmer up runner
          </code>{" "}
          to register one.
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
      {sorted.map((runner) => (
        <RunnerRow
          key={runner.metadata!.id}
          runner={runner}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RunnerRow (internal)
// ---------------------------------------------------------------------------

function RunnerRow({ runner }: { runner: Runner }) {
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
        "flex items-center gap-3 rounded-lg border border-border/60 px-3 py-2.5",
        "hover:border-border transition-colors",
        !active && "opacity-60",
      )}
    >
      <RunnerIcon size={14} />

      {/* Name + phase badge */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
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

      {/* Metadata columns — responsive */}
      <div className="hidden items-center gap-4 text-xs text-muted-foreground sm:flex">
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
          <span title={`Last heartbeat: ${timestampDate(lastHeartbeat).toISOString()}`}>
            {formatRelativeTime(timestampDate(lastHeartbeat))}
          </span>
        )}
      </div>
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
