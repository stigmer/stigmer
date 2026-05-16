"use client";

import { memo } from "react";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { WorkflowEventType } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { cn } from "@stigmer/theme";

interface TimelineEventProps {
  readonly event: WorkflowExecutionEvent;
  readonly onNavigateToAgentExecution?: (id: string) => void;
}

/**
 * Renders a single event in the workflow execution timeline.
 *
 * Dispatches on `event_type` to a type-specific renderer. Each event
 * is immutable after receipt, so this component is wrapped in
 * `React.memo` for efficient re-render skipping.
 *
 * @internal Not exported from the public SDK barrel — used only by
 * `WorkflowExecutionTimeline`.
 */
export const WorkflowExecutionTimelineEvent = memo(function WorkflowExecutionTimelineEvent({
  event,
  onNavigateToAgentExecution,
}: TimelineEventProps) {
  const timestamp = formatTimestamp(event.occurredAt);
  const p = event.payload;

  switch (p.case) {
    // ── Execution lifecycle ──────────────────────────────────────────

    case "executionStarted":
      return (
        <EventRow
          icon={<PlayIcon />}
          iconColor="text-foreground"
          timestamp={timestamp}
        >
          <span className="font-medium text-foreground">Execution started</span>
          <span className="text-muted-foreground">
            {" · "}{p.value.totalTasks} tasks
          </span>
        </EventRow>
      );

    case "executionCompleted":
      return (
        <EventRow
          icon={<CheckCircleIcon />}
          iconColor="text-success"
          timestamp={timestamp}
        >
          <span className="font-medium text-success">Execution completed</span>
          <MetaChips
            duration={Number(p.value.durationMs)}
            cost={p.value.totalCostMicros}
            tokens={p.value.totalTokens}
          />
        </EventRow>
      );

    case "executionFailed":
      return (
        <EventRow
          icon={<XCircleIcon />}
          iconColor="text-destructive"
          timestamp={timestamp}
        >
          <span className="font-medium text-destructive">Execution failed</span>
          {p.value.failedTaskName && (
            <span className="text-muted-foreground">{" · "}task: {p.value.failedTaskName}</span>
          )}
          {p.value.error && (
            <p className="mt-1 text-xs text-destructive/80">{p.value.error}</p>
          )}
        </EventRow>
      );

    case "executionPaused":
      return (
        <EventRow icon={<PauseCircleIcon />} iconColor="text-muted-foreground" timestamp={timestamp}>
          <span className="font-medium text-muted-foreground">Execution paused</span>
          {p.value.reason && <span className="text-muted-foreground">{" · "}{p.value.reason}</span>}
        </EventRow>
      );

    case "executionResumed":
      return (
        <EventRow icon={<PlayIcon />} iconColor="text-foreground" timestamp={timestamp}>
          <span className="font-medium text-foreground">Execution resumed</span>
          {p.value.resumedBy && <span className="text-muted-foreground">{" · "}by {p.value.resumedBy}</span>}
        </EventRow>
      );

    case "executionCancelled":
      return (
        <EventRow icon={<XCircleIcon />} iconColor="text-muted-foreground" timestamp={timestamp}>
          <span className="font-medium text-muted-foreground">Execution cancelled</span>
          {p.value.reason && <span className="text-muted-foreground">{" · "}{p.value.reason}</span>}
        </EventRow>
      );

    case "executionTerminated":
      return (
        <EventRow icon={<StopCircleIcon />} iconColor="text-destructive" timestamp={timestamp}>
          <span className="font-medium text-destructive">Execution terminated</span>
          {p.value.reason && <span className="text-muted-foreground">{" · "}{p.value.reason}</span>}
        </EventRow>
      );

    // ── Task lifecycle ───────────────────────────────────────────────

    case "taskStarted":
      return (
        <EventRow icon={<ArrowRightIcon />} iconColor="text-foreground" timestamp={timestamp}>
          <span className="font-medium text-foreground">{event.taskName}</span>
          <KindBadge kind={p.value.taskKind} />
          {p.value.attemptNumber > 1 && (
            <span className="text-xs text-muted-foreground">(attempt {p.value.attemptNumber})</span>
          )}
        </EventRow>
      );

    case "taskCompleted":
      return (
        <EventRow icon={<CheckIcon />} iconColor="text-success" timestamp={timestamp}>
          <span className="font-medium text-foreground">{event.taskName}</span>
          <span className="text-xs text-success">completed</span>
          <MetaChips
            duration={Number(p.value.durationMs)}
            cost={p.value.costMicros}
            tokens={p.value.tokensUsed}
          />
        </EventRow>
      );

    case "taskFailed":
      return (
        <EventRow icon={<XIcon />} iconColor="text-destructive" timestamp={timestamp}>
          <span className="font-medium text-foreground">{event.taskName}</span>
          <span className="text-xs text-destructive">failed</span>
          {p.value.willRetry && (
            <span className="text-xs text-muted-foreground">(will retry)</span>
          )}
          {p.value.error && (
            <p className="mt-1 text-xs text-destructive/80">{p.value.error}</p>
          )}
        </EventRow>
      );

    case "taskSkipped":
      return (
        <EventRow icon={<SkipIcon />} iconColor="text-muted-foreground" timestamp={timestamp}>
          <span className="font-medium text-muted-foreground">{event.taskName}</span>
          <span className="text-xs text-muted-foreground">skipped</span>
          {p.value.reason && (
            <span className="text-xs text-muted-foreground">{" · "}{p.value.reason}</span>
          )}
        </EventRow>
      );

    case "taskRetrying":
      return (
        <EventRow icon={<RetryIcon />} iconColor="text-muted-foreground" timestamp={timestamp}>
          <span className="font-medium text-foreground">{event.taskName}</span>
          <span className="text-xs text-muted-foreground">
            retrying (attempt {p.value.nextAttempt})
          </span>
          {p.value.delayMs > BigInt(0) && (
            <span className="text-xs text-muted-foreground">
              after {formatDurationMs(Number(p.value.delayMs))}
            </span>
          )}
        </EventRow>
      );

    // ── Agent call ───────────────────────────────────────────────────

    case "agentCallStarted":
      return (
        <EventRow icon={<AgentIcon />} iconColor="text-foreground" timestamp={timestamp}>
          <span className="font-medium text-foreground">{event.taskName}</span>
          <span className="text-xs text-muted-foreground">agent: {p.value.agentSlug}</span>
          {onNavigateToAgentExecution && p.value.childExecutionId && (
            <button
              type="button"
              onClick={() => onNavigateToAgentExecution(p.value.childExecutionId)}
              className="text-xs text-primary hover:underline"
            >
              View execution
            </button>
          )}
        </EventRow>
      );

    case "agentCallProgress":
      return (
        <EventRow icon={<AgentIcon />} iconColor="text-muted-foreground" timestamp={timestamp}>
          <span className="text-foreground">{event.taskName}</span>
          <span className="text-xs text-muted-foreground">
            {p.value.messagesCount} msgs · {p.value.toolCallsCount} tools
            {p.value.currentToolName ? ` · ${p.value.currentToolName}` : ""}
          </span>
        </EventRow>
      );

    case "agentCallCompleted":
      return (
        <EventRow
          icon={p.value.error ? <XIcon /> : <CheckIcon />}
          iconColor={p.value.error ? "text-destructive" : "text-success"}
          timestamp={timestamp}
        >
          <span className="font-medium text-foreground">{event.taskName}</span>
          <span className={cn("text-xs", p.value.error ? "text-destructive" : "text-success")}>
            agent {p.value.error ? "failed" : "completed"}
          </span>
          <MetaChips
            duration={Number(p.value.durationMs)}
            cost={p.value.costMicros}
            tokens={p.value.tokensConsumed}
          />
          {p.value.error && (
            <p className="mt-1 text-xs text-destructive/80">{p.value.error}</p>
          )}
        </EventRow>
      );

    // ── Approval ─────────────────────────────────────────────────────

    case "approvalRequested":
      return (
        <EventRow icon={<ShieldIcon />} iconColor="text-warning" timestamp={timestamp}>
          <span className="font-medium text-warning">Approval requested</span>
          <p className="mt-1 text-xs text-foreground">{p.value.prompt}</p>
          {p.value.approvers.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Approvers: {p.value.approvers.join(", ")}
            </p>
          )}
          {p.value.timeoutSeconds > 0 && (
            <p className="text-xs text-muted-foreground">
              Timeout: {formatDurationMs(p.value.timeoutSeconds * 1000)}
            </p>
          )}
        </EventRow>
      );

    case "approvalResolved":
      return (
        <EventRow icon={<ShieldIcon />} iconColor="text-success" timestamp={timestamp}>
          <span className="font-medium text-foreground">Approval resolved</span>
          <span className="text-xs text-muted-foreground">
            by {p.value.resolvedBy}
          </span>
          {p.value.comment && (
            <p className="mt-1 text-xs text-muted-foreground italic">&quot;{p.value.comment}&quot;</p>
          )}
        </EventRow>
      );

    // ── Budget ───────────────────────────────────────────────────────

    case "budgetCheckpoint":
      return (
        <EventRow icon={<CoinIcon />} iconColor={p.value.thresholdBreached ? "text-warning" : "text-muted-foreground"} timestamp={timestamp}>
          <span className="text-foreground">Budget checkpoint</span>
          <span className="text-xs text-muted-foreground">
            {formatMicroUsd(p.value.costConsumedMicros)} consumed
            {p.value.costRemainingMicros >= BigInt(0) && (
              <> · {formatMicroUsd(p.value.costRemainingMicros)} remaining</>
            )}
          </span>
          {p.value.thresholdBreached && (
            <span className="text-xs font-medium text-warning">threshold breached</span>
          )}
        </EventRow>
      );

    // ── Signals / events ─────────────────────────────────────────────

    case "signalReceived":
      return (
        <EventRow icon={<SignalIcon />} iconColor="text-muted-foreground" timestamp={timestamp}>
          <span className="text-foreground">Signal received</span>
          <span className="text-xs text-muted-foreground">{p.value.signalName}</span>
        </EventRow>
      );

    case "eventEmitted":
      return (
        <EventRow icon={<EmitIcon />} iconColor="text-muted-foreground" timestamp={timestamp}>
          <span className="text-foreground">Event emitted</span>
          <span className="text-xs text-muted-foreground">{p.value.eventType}</span>
        </EventRow>
      );

    // ── Artifacts ────────────────────────────────────────────────────

    case "artifactCreated":
      return (
        <EventRow icon={<FileIcon />} iconColor="text-muted-foreground" timestamp={timestamp}>
          <span className="text-foreground">Artifact created</span>
          <span className="text-xs text-muted-foreground">
            {p.value.displayName} · {p.value.contentType} · {formatBytes(p.value.sizeBytes)}
          </span>
        </EventRow>
      );

    default:
      return null;
  }
});

// ---------------------------------------------------------------------------
// Shared layout
// ---------------------------------------------------------------------------

function EventRow({
  icon,
  iconColor,
  timestamp,
  children,
}: {
  readonly icon: React.ReactNode;
  readonly iconColor: string;
  readonly timestamp: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-2 hover:bg-muted/30" role="listitem">
      <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center", iconColor)} aria-hidden="true">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
        {children}
      </div>
      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{timestamp}</span>
    </div>
  );
}

function KindBadge({ kind }: { readonly kind: WorkflowTaskKind }) {
  const label = TASK_KIND_SHORT.get(kind) ?? kindToString(kind);
  return (
    <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {label}
    </span>
  );
}

function MetaChips({
  duration,
  cost,
  tokens,
}: {
  readonly duration?: number;
  readonly cost?: bigint;
  readonly tokens?: bigint;
}) {
  const parts: string[] = [];
  if (duration && duration > 0) parts.push(formatDurationMs(duration));
  if (cost && cost > BigInt(0)) parts.push(formatMicroUsd(cost));
  if (tokens && tokens > BigInt(0)) parts.push(`${tokens.toLocaleString()} tok`);
  if (parts.length === 0) return null;
  return <span className="text-xs text-muted-foreground">{parts.join(" · ")}</span>;
}

// ---------------------------------------------------------------------------
// Icons (minimal inline SVGs — no external deps per DD-004)
// ---------------------------------------------------------------------------

function PlayIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M3 2l7 4-7 4V2z" /></svg>;
}
function CheckCircleIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="6" cy="6" r="4.5" /><path d="M4 6l1.5 1.5L8 5" /></svg>;
}
function XCircleIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="6" cy="6" r="4.5" /><path d="M4.5 4.5l3 3M7.5 4.5l-3 3" /></svg>;
}
function PauseCircleIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="4.5" /><path d="M5 4.5v3M7 4.5v3" /></svg>;
}
function StopCircleIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="4.5" /><rect x="4" y="4" width="4" height="4" rx="0.5" fill="currentColor" /></svg>;
}
function ArrowRightIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 6h8M7 3l3 3-3 3" /></svg>;
}
function CheckIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2.5 6L5 8.5L9.5 3.5" /></svg>;
}
function XIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 3l6 6M9 3l-6 6" /></svg>;
}
function SkipIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 3l4 3-4 3V3zM7 3l4 3-4 3V3z" /></svg>;
}
function RetryIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 6a4 4 0 117 2.5" /><path d="M2 2v4h4" /></svg>;
}
function AgentIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><circle cx="6" cy="4" r="2" /><path d="M2 10a4 4 0 018 0" /></svg>;
}
function ShieldIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 1L2 3v3c0 2.5 1.5 4 4 5 2.5-1 4-2.5 4-5V3L6 1z" /></svg>;
}
function CoinIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="4.5" /><path d="M6 3v6M4.5 4.5h2a1 1 0 010 2H5a1 1 0 000 2h2" /></svg>;
}
function SignalIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 8v2M4 6l2 2 2-2M2 4l4 4 4-4" /></svg>;
}
function EmitIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M6 2v6M3 5l3 3 3-3M3 10h6" /></svg>;
}
function FileIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M7 1H3a1 1 0 00-1 1v8a1 1 0 001 1h6a1 1 0 001-1V4L7 1z" /><path d="M7 1v3h3" /></svg>;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const TASK_KIND_SHORT: ReadonlyMap<WorkflowTaskKind, string> = new Map([
  [WorkflowTaskKind.agent_call, "agent_call"],
  [WorkflowTaskKind.llm_call, "llm_call"],
  [WorkflowTaskKind.http_call, "http_call"],
  [WorkflowTaskKind.grpc_call, "grpc_call"],
  [WorkflowTaskKind.transform, "transform"],
  [WorkflowTaskKind.human_input, "human_input"],
  [WorkflowTaskKind.validate, "validate"],
  [WorkflowTaskKind.emit_event, "emit_event"],
  [WorkflowTaskKind.notification, "notification"],
  [WorkflowTaskKind.eval, "eval"],
  [WorkflowTaskKind.switch_case, "switch"],
  [WorkflowTaskKind.for_each, "for_each"],
  [WorkflowTaskKind.fork, "fork"],
  [WorkflowTaskKind.listen, "listen"],
  [WorkflowTaskKind.wait, "wait"],
]);

function kindToString(kind: WorkflowTaskKind): string {
  const entry = Object.entries(WorkflowTaskKind).find(
    ([, v]) => v === kind && typeof v === "number",
  );
  return entry?.[0] ?? "unknown";
}

function formatTimestamp(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}

function formatDurationMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function formatMicroUsd(micros: bigint): string {
  const val = Number(micros) / 1_000_000;
  if (val < 0.01) return `$${val.toFixed(4)}`;
  return `$${val.toFixed(2)}`;
}

function formatBytes(bytes: bigint): string {
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
