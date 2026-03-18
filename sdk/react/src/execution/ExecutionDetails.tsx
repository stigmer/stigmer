"use client";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { UsageMetrics } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import type {
  McpServerResolutionStatus,
  ResolvedExecutionContext,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/context_pb";
import type { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import { cn } from "@stigmer/theme";
import { ExecutionPhaseBadge } from "./ExecutionPhaseBadge";
import { isTerminalPhase } from "./execution-phases";
import { ContextWindowMeter } from "./ContextWindowMeter";
import { WorkspaceSummary } from "../workspace/WorkspaceSummary";
import {
  useElapsedMs,
  hasModelData,
  hasTokenData,
  formatMs,
  formatTimestamp,
  formatNumber,
  formatCost,
} from "./execution-format";

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
 * For a compact "at a glance" alternative, see {@link ExecutionSummary}.
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
        <Section label="Context Window">
          <ContextWindowMeter contextInfo={contextInfo} />
        </Section>
      )}
      {context && hasResolvedContext(context) && (
        <ResolvedContextSection context={context} />
      )}
      {workspaceEntries && workspaceEntries.length > 0 && (
        <Section label="Workspace">
          <WorkspaceSummary entries={workspaceEntries} />
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Guard helpers
// ---------------------------------------------------------------------------

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
