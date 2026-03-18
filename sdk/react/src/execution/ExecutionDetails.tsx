"use client";

import { useEffect, useMemo, useState } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { UsageMetrics } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import type {
  ContextInfo,
  McpServerResolutionStatus,
  ResolvedExecutionContext,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/context_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { cn } from "@stigmer/theme";
import { ExecutionPhaseBadge } from "./ExecutionPhaseBadge";
import { isTerminalPhase } from "./execution-phases";

export interface ExecutionDetailsProps {
  /** The execution to display details for. Renders nothing when null. */
  readonly execution: AgentExecution | null;
  /** Session-level workspace entries (optional, renders workspace section when provided). */
  readonly workspaceEntries?: readonly WorkspaceEntry[];
  readonly className?: string;
}

/**
 * Renders execution metadata as a vertical stack of labeled sections:
 * status, model, tokens, cost, context window, resolved context, and
 * workspace.
 *
 * Designed for use in side panels, dashboards, or any layout where a
 * platform builder wants to display execution observability data
 * alongside a conversation thread.
 *
 * All visual properties flow through `--stgm-*` tokens.
 *
 * @example
 * ```tsx
 * const stream = useExecutionStream(executionId);
 *
 * <ExecutionDetails
 *   execution={stream.execution}
 *   workspaceEntries={session?.spec?.workspaceEntries}
 * />
 * ```
 */
export function ExecutionDetails({
  execution,
  workspaceEntries,
  className,
}: ExecutionDetailsProps) {
  if (!execution) return null;

  const status = execution.status;
  const phase = status?.phase;
  const usage = status?.usage;
  const context = status?.resolvedContext;
  const contextInfo = status?.contextInfo;

  return (
    <div
      className={cn("flex flex-col gap-0.5 text-sm", className)}
      role="region"
      aria-label="Execution details"
    >
      {phase !== undefined && (
        <StatusSection
          phase={phase}
          startedAt={status?.startedAt}
          completedAt={status?.completedAt}
          totalDurationMs={usage?.totalDurationMs}
        />
      )}
      {usage && hasModelData(usage) && <ModelSection usage={usage} />}
      {usage && hasTokenData(usage) && <TokensSection usage={usage} />}
      {usage && usage.estimatedCostUsd > 0 && (
        <CostSection usage={usage} />
      )}
      {contextInfo && contextInfo.contextWindowLimit > 0 && (
        <ContextWindowSection contextInfo={contextInfo} />
      )}
      {context && hasResolvedContext(context) && (
        <ResolvedContextSection context={context} />
      )}
      {workspaceEntries && workspaceEntries.length > 0 && (
        <WorkspaceSection entries={workspaceEntries} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guard helpers — determine whether a section has data worth showing
// ---------------------------------------------------------------------------

function hasModelData(usage: UsageMetrics): boolean {
  return usage.primaryModel !== "" || usage.primaryProvider !== "";
}

function hasTokenData(usage: UsageMetrics): boolean {
  return usage.totalTokens > 0 || usage.promptTokens > 0;
}

function hasResolvedContext(ctx: ResolvedExecutionContext): boolean {
  return (
    Object.keys(ctx.mcpServers).length > 0 ||
    ctx.skillNames.length > 0 ||
    ctx.environmentKeys.length > 0
  );
}

// ---------------------------------------------------------------------------
// Section: Status
// ---------------------------------------------------------------------------

import type { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

function StatusSection({
  phase,
  startedAt,
  completedAt,
  totalDurationMs,
}: {
  phase: ExecutionPhase;
  startedAt?: string;
  completedAt?: string;
  totalDurationMs?: number;
}) {
  const terminal = isTerminalPhase(phase);
  const elapsedMs = useElapsedMs(startedAt, !terminal);

  const durationLabel = (() => {
    if (terminal && totalDurationMs && totalDurationMs > 0) {
      return formatMs(totalDurationMs);
    }
    if (terminal && startedAt && completedAt) {
      const ms =
        new Date(completedAt).getTime() - new Date(startedAt).getTime();
      return ms > 0 ? formatMs(ms) : null;
    }
    if (elapsedMs !== null) return formatMs(elapsedMs);
    return null;
  })();

  return (
    <Section label="Status">
      <ExecutionPhaseBadge phase={phase} />
      <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        {startedAt && (
          <span>Started {formatTimestamp(startedAt)}</span>
        )}
        {durationLabel && (
          <>
            <Dot />
            <span>{durationLabel}</span>
          </>
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Section: Model
// ---------------------------------------------------------------------------

function ModelSection({ usage }: { usage: UsageMetrics }) {
  return (
    <Section label="Model">
      {usage.primaryProvider && (
        <span className="text-xs text-muted-foreground">
          {usage.primaryProvider}
        </span>
      )}
      {usage.primaryModel && (
        <span className="break-all font-mono text-xs">{usage.primaryModel}</span>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Section: Tokens
// ---------------------------------------------------------------------------

function TokensSection({ usage }: { usage: UsageMetrics }) {
  return (
    <Section label="Tokens">
      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs">
        <MetricRow label="Input" value={formatNumber(usage.promptTokens)} />
        <MetricRow
          label="Output"
          value={formatNumber(usage.completionTokens)}
        />
        <MetricRow label="Total" value={formatNumber(usage.totalTokens)} />
        {usage.cacheCreationTokens > 0 && (
          <MetricRow
            label="Cache write"
            value={formatNumber(usage.cacheCreationTokens)}
          />
        )}
        {usage.cacheReadTokens > 0 && (
          <MetricRow
            label="Cache read"
            value={formatNumber(usage.cacheReadTokens)}
          />
        )}
        {usage.llmCallCount > 0 && (
          <MetricRow
            label="LLM calls"
            value={String(usage.llmCallCount)}
          />
        )}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Section: Cost
// ---------------------------------------------------------------------------

function CostSection({ usage }: { usage: UsageMetrics }) {
  return (
    <Section label="Cost">
      <span className="font-mono text-xs">
        {formatCost(usage.estimatedCostUsd)}
      </span>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Section: Context Window
// ---------------------------------------------------------------------------

function ContextWindowSection({ contextInfo }: { contextInfo: ContextInfo }) {
  const pct = Math.min(100, Math.max(0, contextInfo.utilizationPercent));
  const barColor =
    pct >= 90
      ? "bg-destructive"
      : pct >= 70
        ? "bg-warning"
        : "bg-success";

  return (
    <Section label="Context Window">
      <div
        role="meter"
        aria-label="Context window utilization"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="flex flex-col gap-1"
      >
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn("h-full rounded-full transition-[width] duration-300", barColor)}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {formatCompactNumber(contextInfo.currentTokenCount)} /{" "}
            {formatCompactNumber(contextInfo.contextWindowLimit)}
          </span>
          <span>{Math.round(pct)}%</span>
        </div>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Section: Resolved Context
// ---------------------------------------------------------------------------

function ResolvedContextSection({
  context,
}: {
  context: ResolvedExecutionContext;
}) {
  const serverEntries = Object.entries(context.mcpServers);

  return (
    <Section label="Resolved Context">
      {serverEntries.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            MCP Servers
          </span>
          <ul className="space-y-0.5">
            {serverEntries.map(([slug, status]) => (
              <McpServerRow key={slug} slug={slug} status={status} />
            ))}
          </ul>
        </div>
      )}

      {context.skillNames.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            Skills
          </span>
          <div className="flex flex-wrap gap-1">
            {context.skillNames.map((name) => (
              <span
                key={name}
                className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs"
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {context.environmentKeys.length > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <KeyIcon />
          <span>
            {context.environmentKeys.length} env{" "}
            {context.environmentKeys.length === 1 ? "key" : "keys"}
          </span>
        </div>
      )}
    </Section>
  );
}

function McpServerRow({
  slug,
  status,
}: {
  slug: string;
  status: McpServerResolutionStatus;
}) {
  return (
    <li className="flex items-center justify-between gap-2 text-xs">
      <span className="flex items-center gap-1.5 truncate">
        {status.resolved ? (
          <ServerDotIcon className="text-success" />
        ) : (
          <ServerDotIcon className="text-destructive" />
        )}
        <span className="truncate font-mono">{slug}</span>
      </span>
      {status.resolved && status.enabledToolCount > 0 && (
        <span className="shrink-0 text-muted-foreground">
          {status.enabledToolCount}{" "}
          {status.enabledToolCount === 1 ? "tool" : "tools"}
        </span>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Section: Workspace
// ---------------------------------------------------------------------------

function WorkspaceSection({
  entries,
}: {
  entries: readonly WorkspaceEntry[];
}) {
  return (
    <Section label="Workspace">
      <ul className="space-y-1.5">
        {entries.map((entry) => (
          <li key={entry.name} className="text-xs">
            <div className="flex items-center gap-1.5 font-medium">
              <FolderIcon />
              <span className="truncate">{entry.name}</span>
            </div>
            <WorkspaceSourceLabel source={entry.source} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

import type { WorkspaceSource } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";

function WorkspaceSourceLabel({
  source,
}: {
  source?: WorkspaceSource;
}) {
  if (!source || source.source.case === undefined) return null;

  if (source.source.case === "gitRepo") {
    const url = source.source.value.url;
    const short = url
      .replace(/^https?:\/\//, "")
      .replace(/\.git$/, "");
    return (
      <span
        className="ml-5 block truncate text-muted-foreground"
        title={url}
      >
        {short}
      </span>
    );
  }

  if (source.source.case === "localPath") {
    const path = source.source.value.path;
    return (
      <span
        className="ml-5 block truncate font-mono text-muted-foreground"
        title={path}
      >
        {path}
      </span>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="flex flex-col gap-1.5 border-b border-border py-3 last:border-b-0"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </h3>
      {children}
    </section>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-mono tabular-nums">{value}</span>
    </>
  );
}

function Dot() {
  return (
    <span className="text-muted-foreground" aria-hidden="true">
      ·
    </span>
  );
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Ticks every second while active, returning elapsed milliseconds since
 * `startedAt`. Returns null when inactive or startedAt is empty/invalid.
 */
function useElapsedMs(
  startedAt: string | undefined,
  active: boolean,
): number | null {
  const startMs = useMemo(() => {
    if (!startedAt) return null;
    const t = new Date(startedAt).getTime();
    return Number.isNaN(t) ? null : t;
  }, [startedAt]);

  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    if (startMs === null || !active) {
      setElapsed(null);
      return;
    }
    setElapsed(Math.max(0, Date.now() - startMs));
    const id = setInterval(() => {
      setElapsed(Math.max(0, Date.now() - startMs));
    }, 1000);
    return () => clearInterval(id);
  }, [startMs, active]);

  return elapsed;
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0
    ? `${hours}h ${remainingMinutes}m`
    : `${hours}h`;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatCompactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

// ---------------------------------------------------------------------------
// Inline SVG icons — no lucide-react dependency in SDK
// ---------------------------------------------------------------------------

function ServerDotIcon({ className }: { className?: string }) {
  return (
    <svg
      width="8"
      height="8"
      viewBox="0 0 8 8"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <circle cx="4" cy="4" r="3" />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="7.5" cy="4.5" r="2.5" />
      <path d="M5.5 6.5L2 10M3.5 8.5L2 10M2 10L3 11" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.5 3V9.5a1 1 0 001 1h7a1 1 0 001-1V4.5a1 1 0 00-1-1H6L4.5 2H2.5a1 1 0 00-1 1z" />
    </svg>
  );
}
