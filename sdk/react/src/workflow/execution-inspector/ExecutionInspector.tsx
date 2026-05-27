"use client";

import { memo, useCallback, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowTask, WorkflowPendingApproval } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";
import { Tabs, type TabItem } from "../../tabs/Tabs";
import { useExecutionTaskDetail } from "./useExecutionTaskDetail";
import { formatDuration, formatMicroUsd, formatTokenCount } from "../format-utils";
import { SummaryTab } from "./SummaryTab";
import { InputOutputTab } from "./InputOutputTab";
import { ErrorTab } from "./ErrorTab";
import { RetriesTab } from "./RetriesTab";
import { AgentCallTab } from "./AgentCallTab";
import { EventLogTab } from "./EventLogTab";
import { WorkflowExecutionApprovalCard } from "../WorkflowExecutionApprovalCard";
import { WorkflowTaskApprovalCard } from "../WorkflowTaskApprovalCard";

/** Props for {@link ExecutionInspector}. */
export interface ExecutionInspectorProps {
  /** Currently selected task name, or null when no task is selected. */
  readonly selectedTaskName: string | null;
  /** All events from the execution event stream. */
  readonly events: readonly WorkflowExecutionEvent[];
  /** Derived task states from the event store. */
  readonly taskStates: ReadonlyMap<string, DerivedTaskState>;
  /** Task snapshots from `execution.status.tasks` for full I/O data. */
  readonly taskSnapshots?: readonly WorkflowTask[];
  /** Callback when the user clicks "View Agent Execution" on an agent_call task. */
  readonly onNavigateToAgentExecution?: (agentExecutionId: string) => void;
  /** Pending agent tool approvals from `execution.status.pending_approvals`. */
  readonly pendingApprovals?: readonly WorkflowPendingApproval[];
  /** Callback to submit an agent tool approval decision. */
  readonly onSubmitApproval?: (toolCallId: string, action: ApprovalAction, comment?: string) => Promise<unknown>;
  /** Whether an approval submission is in flight. */
  readonly isSubmittingApproval?: boolean;
  /** Callback to submit a workflow-level human_input task decision. */
  readonly onSubmitTaskApproval?: (
    taskName: string,
    outcome: string,
    formData?: Record<string, unknown>,
    comment?: string,
  ) => Promise<unknown>;
  /** Whether a task approval submission is in flight. */
  readonly isSubmittingTaskApproval?: boolean;
  /** Additional CSS class names. */
  readonly className?: string;
}

type InspectorTabId = "summary" | "input" | "output" | "error" | "retries" | "agent" | "approval" | "events";

/** Compute the system-suggested tab from the current task detail (DD-003). */
function deriveAutoTab(detail: { status: string; error: unknown } | null): InspectorTabId {
  if (!detail) return "summary";
  if (detail.status === "failed" && detail.error) return "error";
  if (detail.status === "waiting_approval") return "approval";
  return "summary";
}

/**
 * Runtime inspector panel for workflow execution tasks.
 *
 * Displays rich per-task detail in a tabbed interface when a task node
 * is selected in the execution graph. Tabs are shown contextually based
 * on available data.
 *
 * Designed for embedding in both the Stigmer Console and third-party
 * dashboards — no routing, auth, or app-shell dependencies (DD-004).
 *
 * @example
 * ```tsx
 * <ExecutionInspector
 *   selectedTaskName={selectedTask}
 *   events={events}
 *   taskStates={taskStates}
 *   taskSnapshots={execution?.status?.tasks}
 *   onNavigateToAgentExecution={(id) => router.push(`/sessions/${id}`)}
 * />
 * ```
 */
export const ExecutionInspector = memo(function ExecutionInspector({
  selectedTaskName,
  events,
  taskStates,
  taskSnapshots,
  onNavigateToAgentExecution,
  pendingApprovals,
  onSubmitApproval,
  isSubmittingApproval,
  onSubmitTaskApproval,
  isSubmittingTaskApproval,
  className,
}: ExecutionInspectorProps) {
  const { detail } = useExecutionTaskDetail({
    selectedTaskName,
    events,
    taskStates,
    taskSnapshots,
  });

  const [activeTab, setActiveTab] = useState<InspectorTabId>(() => deriveAutoTab(detail));
  const [prevSelectedTask, setPrevSelectedTask] = useState(selectedTaskName);
  const [prevStatus, setPrevStatus] = useState(detail?.status);
  const userPickedTabRef = useRef(false);

  // Synchronous tab reset when the selected task changes.
  // React's "adjusting state when a prop changes" pattern — runs during
  // render so the correct tab is committed to the DOM on the first paint.
  if (selectedTaskName !== prevSelectedTask) {
    setPrevSelectedTask(selectedTaskName);
    setPrevStatus(detail?.status);
    userPickedTabRef.current = false;
    setActiveTab(deriveAutoTab(detail));
  }

  // Synchronous auto-select on status transition (same task only).
  // Navigates to Error/Approval when a live execution transitions.
  if (selectedTaskName === prevSelectedTask && detail?.status !== prevStatus) {
    setPrevStatus(detail?.status);
    if (!userPickedTabRef.current) {
      if (detail?.status === "failed" && detail.error) {
        setActiveTab("error");
      } else if (detail?.status === "waiting_approval") {
        setActiveTab("approval");
      }
    }
  }

  const handleTabChange = useCallback((tabId: string) => {
    userPickedTabRef.current = true;
    setActiveTab(tabId as InspectorTabId);
  }, []);

  if (!selectedTaskName || !detail) {
    return (
      <div className={cn("flex flex-1 flex-col items-center justify-center px-4 py-6 text-center", className)}>
        <SelectNodeIcon />
        <p className="mt-2 text-xs text-[var(--stgm-muted-foreground,#737373)]">
          Click a node to view execution details
        </p>
      </div>
    );
  }

  // Filter pending approvals relevant to the selected task (match by childExecutionId)
  const taskApprovals = pendingApprovals?.filter(
    (pa) => pa.childAgentExecutionId === detail.agentCall?.childExecutionId,
  ) ?? [];

  const tabs = buildVisibleTabs(detail, taskApprovals.length);
  const effectiveTab = tabs.some((t) => t.id === activeTab) ? activeTab : "summary";

  const BZ = BigInt(0);

  return (
    <div className={cn("flex h-full flex-col", className)}>
      {/* Header: task name + kind + compact metrics */}
      <div className="flex flex-col gap-1 border-b border-[var(--stgm-border,#e5e5e5)] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--stgm-foreground,#1a1a2e)]">
            {detail.taskName}
          </h3>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {detail.displayName}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
          <StatusBadge status={detail.status} />
          {detail.summary.durationMs > 0 && (
            <span className="tabular-nums text-muted-foreground">{formatDuration(detail.summary.durationMs)}</span>
          )}
          {detail.summary.costMicros > BZ && (
            <span className="tabular-nums text-muted-foreground">{formatMicroUsd(detail.summary.costMicros)}</span>
          )}
          {detail.summary.totalTokens > BZ && (
            <span className="tabular-nums text-muted-foreground">{formatTokenCount(detail.summary.totalTokens)} tok</span>
          )}
        </div>
      </div>

      {/* Tabs + content */}
      <Tabs
        tabs={tabs}
        activeTab={effectiveTab}
        onTabChange={handleTabChange}
        aria-label="Task execution details"
        className="min-h-0 flex-1"
      >
        <div className="h-full min-h-0 overflow-y-auto px-3 py-3">
          {effectiveTab === "summary" && <SummaryTab summary={detail.summary} />}
          {effectiveTab === "input" && <InputOutputTab data={detail.input} label="Input" />}
          {effectiveTab === "output" && <InputOutputTab data={detail.output} label="Output" />}
          {effectiveTab === "error" && detail.error && (
            <ErrorTab
              error={detail.error}
              childExecutionId={detail.agentCall?.childExecutionId}
              onNavigateToAgentExecution={onNavigateToAgentExecution}
            />
          )}
          {effectiveTab === "retries" && detail.retries && <RetriesTab retries={detail.retries} />}
          {effectiveTab === "agent" && detail.agentCall && (
            <AgentCallTab
              agentCall={detail.agentCall}
              taskStatus={detail.status}
              isTabActive={effectiveTab === "agent"}
              onNavigateToAgentExecution={onNavigateToAgentExecution}
            />
          )}
          {effectiveTab === "approval" && taskApprovals.length > 0 && onSubmitApproval && (
            <div className="space-y-2">
              {taskApprovals.map((pa) => (
                <WorkflowExecutionApprovalCard
                  key={pa.approval?.toolCallId ?? pa.childAgentExecutionId}
                  prompt={pa.approval?.message || `Tool "${pa.approval?.toolName}" requires approval`}
                  toolCallId={pa.approval?.toolCallId ?? ""}
                  approvers={[]}
                  timeoutSeconds={0}
                  onSubmitApproval={onSubmitApproval}
                  isSubmitting={isSubmittingApproval ?? false}
                />
              ))}
            </div>
          )}
          {effectiveTab === "approval" && detail.approval && onSubmitTaskApproval && (
            <WorkflowTaskApprovalCard
              taskName={detail.taskName}
              prompt={detail.approval.prompt}
              outcomes={detail.approval.outcomes}
              formSchema={detail.approval.formSchema ?? undefined}
              onSubmit={onSubmitTaskApproval}
              isSubmitting={isSubmittingTaskApproval ?? false}
            />
          )}
          {effectiveTab === "events" && <EventLogTab events={detail.eventLog} />}
        </div>
      </Tabs>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Tab visibility
// ---------------------------------------------------------------------------

function buildVisibleTabs(
  detail: NonNullable<ReturnType<typeof useExecutionTaskDetail>["detail"]>,
  approvalCount: number,
): TabItem[] {
  const tabs: TabItem[] = [{ id: "summary", label: "Summary" }];

  if (detail.input) tabs.push({ id: "input", label: "Input" });
  if (detail.output) tabs.push({ id: "output", label: "Output" });
  if (detail.error) tabs.push({ id: "error", label: "Error" });
  if (detail.retries && detail.retries.attempts.length > 1) {
    tabs.push({ id: "retries", label: "Retries", badge: detail.retries.attempts.length });
  }
  if (detail.agentCall) tabs.push({ id: "agent", label: "Agent" });
  if (approvalCount > 0 || detail.approval) {
    tabs.push({ id: "approval", label: "Approval", badge: approvalCount || undefined });
  }

  tabs.push({ id: "events", label: "Events", badge: detail.eventLog.length });

  return tabs;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<DerivedTaskState["status"], string> = {
  pending: "bg-[var(--stgm-muted,#e5e5e5)] text-[var(--stgm-muted-foreground,#737373)]",
  running: "bg-[var(--stgm-primary,#6366f1)]/10 text-[var(--stgm-primary,#6366f1)]",
  completed: "bg-[var(--stgm-success,#22c55e)]/10 text-[var(--stgm-success,#22c55e)]",
  failed: "bg-[var(--stgm-destructive,#ef4444)]/10 text-[var(--stgm-destructive,#ef4444)]",
  skipped: "bg-[var(--stgm-muted,#e5e5e5)] text-[var(--stgm-muted-foreground,#737373)]",
  retrying: "bg-[var(--stgm-muted,#e5e5e5)] text-[var(--stgm-muted-foreground,#737373)]",
  waiting_approval: "bg-[var(--stgm-warning,#f59e0b)]/10 text-[var(--stgm-warning,#f59e0b)]",
};

function StatusBadge({ status }: { readonly status: DerivedTaskState["status"] }) {
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", STATUS_COLORS[status])}>
      {status.replace(/_/g, " ")}
    </span>
  );
}

function SelectNodeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="text-[var(--stgm-muted-foreground,#737373)]" aria-hidden="true">
      <rect x="2" y="2" width="16" height="16" rx="3" />
      <path d="M7 10h6M10 7v6" />
    </svg>
  );
}
