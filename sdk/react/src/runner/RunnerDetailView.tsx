"use client";

import { useEffect, useRef } from "react";
import { cn } from "@stigmer/theme";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { RunnerPhase } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/enum_pb";
import { useRunner, type UseRunnerOptions } from "./useRunner";
import { phaseLabel, phaseDotColor, isTransitionalPhase } from "./phase";
import { ErrorMessage } from "../error/ErrorMessage";
import { ResourceDetailShell } from "../resource-detail/ResourceDetailShell";
import type { DetailAction, ResourceHeaderMeta } from "../resource-detail/types";
import type { StatusPhase } from "../resource-workbench/types";

/** Props for {@link RunnerDetailView}. */
export interface RunnerDetailViewProps {
  /** Runner ID. */
  readonly id: string;
  /**
   * Called once when the runner resource has been fetched successfully.
   * Provides the resource display name for use cases like breadcrumbs
   * or document titles.
   */
  readonly onResourceLoad?: (meta: { name: string; id: string }) => void;
  /**
   * Primary action rendered as a visible button in the header area.
   */
  readonly primaryAction?: DetailAction;
  /**
   * Secondary actions rendered in the kebab overflow menu.
   */
  readonly actions?: readonly DetailAction[];
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

const TRANSITIONAL_POLL_MS = 5_000;

/**
 * Operational detail view for a Runner.
 *
 * Fetches the runner via {@link useRunner} internally and renders its
 * status, connection information, and machine details inside a
 * {@link ResourceDetailShell}. Polls automatically when the runner is
 * in a transitional phase (Starting, Pending).
 *
 * Handles loading, error, and not-found states automatically.
 * Zero Console dependencies — safe for platform builder embedding.
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <RunnerDetailView id={runnerId} />
 * ```
 */
export function RunnerDetailView({
  id,
  onResourceLoad,
  primaryAction,
  actions,
  className,
}: RunnerDetailViewProps) {
  const phase = useRef<RunnerPhase>(RunnerPhase.UNSPECIFIED);

  const opts: UseRunnerOptions = {
    refetchInterval: isTransitionalPhase(phase.current)
      ? TRANSITIONAL_POLL_MS
      : false,
  };

  const { runner, isLoading, error, refetch } = useRunner(id, opts);

  if (runner?.status?.phase != null) {
    phase.current = runner.status.phase;
  }

  const onResourceLoadRef = useRef(onResourceLoad);
  onResourceLoadRef.current = onResourceLoad;

  useEffect(() => {
    if (runner?.metadata?.name) {
      onResourceLoadRef.current?.({
        name: runner.metadata.name,
        id: runner.metadata.id,
      });
    }
  }, [runner]);

  if (isLoading) return <LoadingSkeleton className={className} />;
  if (error)
    return <ErrorMessage error={error} retry={refetch} className={className} />;
  if (!runner) return <NotFoundState className={className} />;

  const meta = runner.metadata;
  const status = runner.status;
  const info = status?.connectionInfo;
  const runnerPhase = status?.phase ?? RunnerPhase.UNSPECIFIED;

  const headerMeta: ResourceHeaderMeta = {
    name: meta?.name || meta?.id || "Unnamed Runner",
    id: meta?.id || id,
    org: meta?.org,
    icon: <RunnerIcon className="size-6 text-muted-foreground" />,
    status: phaseToStatusPhase(runnerPhase),
    statusLabel: phaseLabel(runnerPhase),
  };

  return (
    <ResourceDetailShell
      header={headerMeta}
      primaryAction={primaryAction}
      actions={actions}
      className={className}
    >
      <div className="flex flex-col gap-6 pt-2">
        <StatusSection
          phase={runnerPhase}
          lastHeartbeat={
            status?.lastHeartbeatAt
              ? timestampDate(status.lastHeartbeatAt)
              : null
          }
          currentExecutions={status?.currentExecutions ?? 0}
          taskQueue={status?.taskQueue}
        />

        {info && (
          <ConnectionInfoSection
            hostname={info.hostname}
            os={info.os}
            arch={info.arch}
            runnerVersion={info.runnerVersion}
          />
        )}
      </div>
    </ResourceDetailShell>
  );
}

// ---------------------------------------------------------------------------
// Phase → StatusPhase mapping
// ---------------------------------------------------------------------------

function phaseToStatusPhase(phase: RunnerPhase): StatusPhase {
  switch (phase) {
    case RunnerPhase.READY:
      return "ready";
    case RunnerPhase.BUSY:
      return "running";
    case RunnerPhase.STARTING:
    case RunnerPhase.PENDING:
      return "pending";
    case RunnerPhase.FAILED:
      return "failed";
    case RunnerPhase.STOPPED:
      return "disabled";
    default:
      return "draft";
  }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function StatusSection({
  phase,
  lastHeartbeat,
  currentExecutions,
  taskQueue,
}: {
  readonly phase: RunnerPhase;
  readonly lastHeartbeat: Date | null;
  readonly currentExecutions: number;
  readonly taskQueue?: string;
}) {
  return (
    <Section title="Status">
      <div className="grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
        <StatusItem label="Phase">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "size-2 shrink-0 rounded-full",
                phaseDotColor(phase),
              )}
              aria-hidden="true"
            />
            <span className="text-sm font-medium text-foreground">
              {phaseLabel(phase)}
            </span>
          </div>
        </StatusItem>
        <StatusItem label="Executions">
          <span className="text-sm font-medium text-foreground">
            {currentExecutions}
          </span>
        </StatusItem>
        <StatusItem label="Last heartbeat">
          <span className="text-sm text-foreground">
            {lastHeartbeat ? formatRelativeTime(lastHeartbeat) : "—"}
          </span>
        </StatusItem>
        {taskQueue && (
          <StatusItem label="Task queue">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
              {taskQueue}
            </code>
          </StatusItem>
        )}
      </div>
    </Section>
  );
}

function StatusItem({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}

function ConnectionInfoSection({
  hostname,
  os,
  arch,
  runnerVersion,
}: {
  readonly hostname?: string;
  readonly os?: string;
  readonly arch?: string;
  readonly runnerVersion?: string;
}) {
  const osArch = os && arch ? `${os}/${arch}` : os || arch || undefined;
  const hasAnyInfo = hostname || osArch || runnerVersion;
  if (!hasAnyInfo) return null;

  return (
    <Section title="Machine">
      <div className="flex flex-col divide-y divide-border">
        {hostname && (
          <InfoRow label="Hostname" value={hostname} />
        )}
        {osArch && (
          <InfoRow label="Platform" value={osArch} mono />
        )}
        {runnerVersion && (
          <InfoRow label="Runner version" value={runnerVersion} mono />
        )}
      </div>
    </Section>
  );
}

function InfoRow({
  label,
  value,
  mono,
}: {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between px-4 py-2.5">
      <span className="text-xs font-medium text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "text-sm text-foreground",
          mono && "font-mono text-xs",
        )}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared layout primitives
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="overflow-hidden rounded-lg border border-border">
        {children}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Non-happy states
// ---------------------------------------------------------------------------

function LoadingSkeleton({ className }: { readonly className?: string }) {
  return (
    <div
      className={cn("flex flex-col gap-6", className)}
      aria-busy="true"
      aria-label="Loading runner details"
    >
      <div className="flex items-start gap-3">
        <div className="mt-1 size-6 shrink-0 animate-pulse rounded bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          <div className="h-3 w-32 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 w-16 animate-pulse rounded bg-muted" />
        <div
          className="animate-pulse rounded-lg border border-border bg-muted-faint"
          style={{ height: "96px" }}
        />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-20 animate-pulse rounded bg-muted" />
        <div
          className="animate-pulse rounded-lg border border-border bg-muted-faint"
          style={{ height: "96px" }}
        />
      </div>
    </div>
  );
}

function NotFoundState({ className }: { readonly className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center gap-2 py-12 text-center",
        className,
      )}
    >
      <RunnerIcon className="size-10 text-muted-foreground-faint" />
      <p className="text-sm font-medium text-muted-foreground">
        Runner not found
      </p>
      <p className="text-xs text-muted-foreground-subtle">
        This runner doesn&apos;t exist or has been removed.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function formatRelativeTime(date: Date): string {
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 10) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Icon
// ---------------------------------------------------------------------------

function RunnerIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2" y="4" width="12" height="9" rx="1.5" />
      <path d="M5 1v3M11 1v3M5 8.5h6" />
    </svg>
  );
}
