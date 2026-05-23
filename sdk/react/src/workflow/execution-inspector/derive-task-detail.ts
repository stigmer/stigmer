/**
 * Pure derivation function that extracts rich per-task detail from
 * the execution event stream and status snapshot.
 *
 * No React dependencies — independently testable and usable outside
 * the inspector component.
 *
 * @since T05 (Runtime Inspector)
 */

import type { WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { JsonObject } from "@bufbuild/protobuf";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";
import { kindToDisplayName } from "../kind-metadata";
import { taskKindToString } from "../workflow-graph-conversions";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface TaskDetail {
  readonly taskName: string;
  readonly taskKind: WorkflowTaskKind;
  readonly displayName: string;
  readonly status: DerivedTaskState["status"];

  readonly summary: TaskDetailSummary;
  readonly input: TaskDetailIO | null;
  readonly output: TaskDetailIO | null;
  readonly error: TaskDetailError | null;
  readonly retries: TaskDetailRetryHistory | null;
  readonly agentCall: TaskDetailAgentCall | null;
  readonly approval: TaskDetailApproval | null;
  readonly eventLog: readonly WorkflowExecutionEvent[];
}

export interface TaskDetailSummary {
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly durationMs: number;
  readonly costMicros: bigint;
  readonly inputTokens: bigint;
  readonly outputTokens: bigint;
  readonly totalTokens: bigint;
  readonly attemptNumber: number;
}

export interface TaskDetailIO {
  readonly data: JsonObject;
  readonly summary: JsonObject | null;
  readonly artifactIds: readonly string[];
  readonly source: "snapshot" | "event-summary";
}

export interface TaskDetailError {
  readonly message: string;
  readonly attemptNumber: number;
  readonly maxAttempts: number;
  readonly willRetry: boolean;
  readonly durationMs: number;
  readonly category: string | null;
  readonly detail: string | null;
}

export interface TaskDetailRetryHistory {
  readonly attempts: readonly TaskDetailRetryAttempt[];
  readonly currentAttempt: number;
}

export interface TaskDetailRetryAttempt {
  readonly attemptNumber: number;
  readonly status: "completed" | "failed";
  readonly durationMs: number;
  readonly error: string;
  readonly delayBeforeMs: number;
  readonly startedAt: string;
}

export interface TaskDetailAgentCall {
  readonly childExecutionId: string;
  readonly agentSlug: string;
  readonly agentPhase: string;
  readonly messagesCount: number;
  readonly toolCallsCount: number;
  readonly tokensConsumed: bigint;
  readonly costMicros: bigint;
  readonly error: string;
  readonly currentToolName: string;
}

export interface TaskDetailApproval {
  readonly prompt: string;
  readonly approvers: readonly string[];
  readonly outcomes: readonly { readonly name: string; readonly label: string }[];
  readonly formSchema: JsonObject | null;
  readonly timeoutSeconds: number;
  readonly decision: TaskDetailApprovalDecision | null;
}

export interface TaskDetailApprovalDecision {
  readonly action: string;
  readonly resolvedBy: string;
  readonly comment: string;
  readonly waitDurationMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BIGINT_ZERO = BigInt(0);

// ---------------------------------------------------------------------------
// Main derivation
// ---------------------------------------------------------------------------

/**
 * Derives rich per-task detail by joining the event stream with the
 * status snapshot.
 *
 * Returns `null` when no data is available for the given task name
 * (no events AND no snapshot entry).
 */
export function deriveTaskDetail(
  taskName: string,
  events: readonly WorkflowExecutionEvent[],
  taskSnapshot: WorkflowTask | undefined,
  derivedState: DerivedTaskState | undefined,
): TaskDetail | null {
  const taskEvents = events.filter((e) => e.taskName === taskName);

  if (taskEvents.length === 0 && !taskSnapshot && !derivedState) {
    return null;
  }

  const buckets = bucketEvents(taskEvents);
  const summary = buildSummary(taskSnapshot, derivedState, buckets);
  const input = buildIO(taskSnapshot?.input, buckets.inputSummary, taskSnapshot?.artifactIds ?? []);
  const output = buildIO(taskSnapshot?.output, buckets.outputSummary, []);
  const snapshotMeta = taskSnapshot?.metadata
    ? (taskSnapshot.metadata as unknown as Record<string, unknown>)
    : undefined;
  const error = buildError(buckets, snapshotMeta);
  const retries = buildRetryHistory(buckets);
  const agentCall = buildAgentCall(buckets);
  const approval = buildApproval(buckets);

  const taskKind = derivedState?.taskKind ??
    buckets.taskKind ??
    WorkflowTaskKind.workflow_task_kind_unspecified;

  const status = derivedState?.status ?? "pending";
  const displayName = kindToDisplayName(taskKindToString(taskKind));

  return {
    taskName,
    taskKind,
    displayName,
    status,
    summary,
    input,
    output,
    error,
    retries,
    agentCall,
    approval,
    eventLog: taskEvents,
  };
}

// ---------------------------------------------------------------------------
// Event bucketing — single-pass categorization
// ---------------------------------------------------------------------------

interface EventBuckets {
  taskKind: WorkflowTaskKind | undefined;
  starts: Array<{ attemptNumber: number; occurredAt: string; inputSummary?: JsonObject }>;
  completions: Array<{ durationMs: number; costMicros: bigint; tokensUsed: bigint; outputSummary?: JsonObject }>;
  failures: Array<{ attemptNumber: number; maxAttempts: number; willRetry: boolean; error: string; durationMs: number }>;
  retryings: Array<{ failedAttempt: number; nextAttempt: number; delayMs: number }>;
  skipped: { reason: string } | null;
  agentStarted: { childExecutionId: string; agentSlug: string; messageSummary: string } | null;
  agentProgress: { agentPhase: number; currentToolName: string; tokensConsumed: bigint; messagesCount: number; toolCallsCount: number } | null;
  agentCompleted: { durationMs: number; tokensConsumed: bigint; costMicros: bigint; error: string; agentPhase: number } | null;
  approvalRequested: { prompt: string; approvers: string[]; timeoutSeconds: number; outcomes: Array<{ name: string; label: string }>; formSchema: JsonObject | null } | null;
  approvalResolved: { action: number; resolvedBy: string; comment: string; waitDurationMs: number } | null;
  inputSummary: JsonObject | null;
  outputSummary: JsonObject | null;
}

function bucketEvents(taskEvents: readonly WorkflowExecutionEvent[]): EventBuckets {
  const buckets: EventBuckets = {
    taskKind: undefined,
    starts: [],
    completions: [],
    failures: [],
    retryings: [],
    skipped: null,
    agentStarted: null,
    agentProgress: null,
    agentCompleted: null,
    approvalRequested: null,
    approvalResolved: null,
    inputSummary: null,
    outputSummary: null,
  };

  for (const evt of taskEvents) {
    const p = evt.payload;
    switch (p.case) {
      case "taskStarted":
        buckets.taskKind ??= p.value.taskKind;
        buckets.starts.push({
          attemptNumber: p.value.attemptNumber,
          occurredAt: evt.occurredAt,
          inputSummary: p.value.inputSummary as JsonObject | undefined,
        });
        if (p.value.inputSummary) {
          buckets.inputSummary = p.value.inputSummary as JsonObject;
        }
        break;

      case "taskCompleted":
        buckets.taskKind ??= p.value.taskKind;
        buckets.completions.push({
          durationMs: Number(p.value.durationMs),
          costMicros: p.value.costMicros,
          tokensUsed: p.value.tokensUsed,
          outputSummary: p.value.outputSummary as JsonObject | undefined,
        });
        if (p.value.outputSummary) {
          buckets.outputSummary = p.value.outputSummary as JsonObject;
        }
        break;

      case "taskFailed":
        buckets.taskKind ??= p.value.taskKind;
        buckets.failures.push({
          attemptNumber: p.value.attemptNumber,
          maxAttempts: p.value.maxAttempts,
          willRetry: p.value.willRetry,
          error: p.value.error,
          durationMs: Number(p.value.durationMs),
        });
        break;

      case "taskSkipped":
        buckets.taskKind ??= p.value.taskKind;
        buckets.skipped = { reason: p.value.reason };
        break;

      case "taskRetrying":
        buckets.retryings.push({
          failedAttempt: p.value.failedAttempt,
          nextAttempt: p.value.nextAttempt,
          delayMs: Number(p.value.delayMs),
        });
        break;

      case "agentCallStarted":
        buckets.agentStarted = {
          childExecutionId: p.value.childExecutionId,
          agentSlug: p.value.agentSlug,
          messageSummary: p.value.messageSummary,
        };
        break;

      case "agentCallProgress":
        buckets.agentProgress = {
          agentPhase: p.value.agentPhase,
          currentToolName: p.value.currentToolName,
          tokensConsumed: p.value.tokensConsumed,
          messagesCount: p.value.messagesCount,
          toolCallsCount: p.value.toolCallsCount,
        };
        break;

      case "agentCallCompleted":
        buckets.agentCompleted = {
          durationMs: Number(p.value.durationMs),
          tokensConsumed: p.value.tokensConsumed,
          costMicros: p.value.costMicros,
          error: p.value.error,
          agentPhase: p.value.agentPhase,
        };
        break;

      case "approvalRequested":
        buckets.approvalRequested = {
          prompt: p.value.prompt,
          approvers: [...p.value.approvers],
          timeoutSeconds: p.value.timeoutSeconds,
          outcomes: (p.value.outcomes ?? []).map((o) => ({ name: o.name, label: o.label })),
          formSchema: p.value.formSchema ? (p.value.formSchema as unknown as JsonObject) : null,
        };
        break;

      case "approvalResolved":
        buckets.approvalResolved = {
          action: p.value.action,
          resolvedBy: p.value.resolvedBy,
          comment: p.value.comment,
          waitDurationMs: Number(p.value.waitDurationMs),
        };
        break;
    }
  }

  return buckets;
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildSummary(
  snapshot: WorkflowTask | undefined,
  derived: DerivedTaskState | undefined,
  buckets: EventBuckets,
): TaskDetailSummary {
  const startedAt = snapshot?.startedAt || buckets.starts[0]?.occurredAt || null;
  const completedAt = snapshot?.completedAt || null;
  const durationMs = derived?.durationMs ?? 0;

  const costMicros = snapshot?.costMicros ?? derived?.costMicros ?? BIGINT_ZERO;
  const inputTokens = snapshot?.inputTokens ?? BIGINT_ZERO;
  const outputTokens = snapshot?.outputTokens ?? BIGINT_ZERO;
  const totalTokens = inputTokens + outputTokens > BIGINT_ZERO
    ? inputTokens + outputTokens
    : derived?.tokensUsed ?? BIGINT_ZERO;

  const attemptNumber = derived?.attemptNumber ?? buckets.starts.length;

  return {
    startedAt,
    completedAt,
    durationMs,
    costMicros,
    inputTokens,
    outputTokens,
    totalTokens,
    attemptNumber,
  };
}

function buildIO(
  snapshotData: JsonObject | undefined,
  eventSummary: JsonObject | null,
  artifactIds: readonly string[],
): TaskDetailIO | null {
  if (snapshotData && Object.keys(snapshotData).length > 0) {
    return {
      data: snapshotData,
      summary: eventSummary,
      artifactIds,
      source: "snapshot",
    };
  }

  if (eventSummary && Object.keys(eventSummary).length > 0) {
    return {
      data: eventSummary,
      summary: eventSummary,
      artifactIds,
      source: "event-summary",
    };
  }

  return null;
}

function buildError(buckets: EventBuckets, snapshotMetadata?: Record<string, unknown>): TaskDetailError | null {
  if (buckets.failures.length === 0) return null;

  const latest = buckets.failures[buckets.failures.length - 1];
  const category = typeof snapshotMetadata?.error_category === "string"
    ? snapshotMetadata.error_category
    : null;
  const detail = typeof snapshotMetadata?.error_detail === "string"
    ? snapshotMetadata.error_detail
    : null;

  return {
    message: latest.error,
    attemptNumber: latest.attemptNumber,
    maxAttempts: latest.maxAttempts,
    willRetry: latest.willRetry,
    durationMs: latest.durationMs,
    category,
    detail,
  };
}

function buildRetryHistory(buckets: EventBuckets): TaskDetailRetryHistory | null {
  if (buckets.starts.length <= 1 && buckets.failures.length === 0) return null;

  const attempts: TaskDetailRetryAttempt[] = [];

  for (let i = 0; i < buckets.starts.length; i++) {
    const start = buckets.starts[i];
    const failure = buckets.failures.find((f) => f.attemptNumber === start.attemptNumber);
    const completion = i === buckets.starts.length - 1 && buckets.completions.length > 0
      ? buckets.completions[buckets.completions.length - 1]
      : null;
    const retry = buckets.retryings.find((r) => r.failedAttempt === start.attemptNumber);

    attempts.push({
      attemptNumber: start.attemptNumber,
      status: failure ? "failed" : completion ? "completed" : "failed",
      durationMs: failure ? failure.durationMs : completion ? completion.durationMs : 0,
      error: failure ? failure.error : "",
      delayBeforeMs: retry ? retry.delayMs : 0,
      startedAt: start.occurredAt,
    });
  }

  if (attempts.length <= 1 && buckets.failures.length === 0) return null;

  const currentAttempt = buckets.starts.length > 0
    ? buckets.starts[buckets.starts.length - 1].attemptNumber
    : 1;

  return { attempts, currentAttempt };
}

function buildAgentCall(buckets: EventBuckets): TaskDetailAgentCall | null {
  if (!buckets.agentStarted) return null;

  return {
    childExecutionId: buckets.agentStarted.childExecutionId,
    agentSlug: buckets.agentStarted.agentSlug,
    agentPhase: String(buckets.agentCompleted?.agentPhase ?? buckets.agentProgress?.agentPhase ?? ""),
    messagesCount: buckets.agentProgress?.messagesCount ?? 0,
    toolCallsCount: buckets.agentProgress?.toolCallsCount ?? 0,
    tokensConsumed: buckets.agentCompleted?.tokensConsumed ?? buckets.agentProgress?.tokensConsumed ?? BIGINT_ZERO,
    costMicros: buckets.agentCompleted?.costMicros ?? BIGINT_ZERO,
    error: buckets.agentCompleted?.error ?? "",
    currentToolName: buckets.agentProgress?.currentToolName ?? "",
  };
}

function buildApproval(buckets: EventBuckets): TaskDetailApproval | null {
  if (!buckets.approvalRequested) return null;

  const req = buckets.approvalRequested;
  const res = buckets.approvalResolved;

  return {
    prompt: req.prompt,
    approvers: req.approvers,
    outcomes: req.outcomes,
    formSchema: req.formSchema,
    timeoutSeconds: req.timeoutSeconds,
    decision: res
      ? {
          action: String(res.action),
          resolvedBy: res.resolvedBy,
          comment: res.comment,
          waitDurationMs: res.waitDurationMs,
        }
      : null,
  };
}
