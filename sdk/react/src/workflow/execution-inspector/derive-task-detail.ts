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
import { toJson, type JsonObject, type JsonValue } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store.js";
import { kindToDisplayName } from "../kind-metadata.js";
import { taskKindToString } from "../workflow-graph-conversions.js";
import { buildIO, type TaskDetailIO } from "../task-detail/task-detail-io.js";

// Re-exported from the shared task-detail module (T04 extraction) so this
// module's public surface — and the barrels that re-export it — stay
// byte-compatible.
export type { TaskDetailIO };

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
  /**
   * Resolved review payload the gate presented — the material under
   * review (issue #234). `null` when the gate carries no payload or when
   * the payload is artifact-backed (see {@link payloadArtifactId}).
   */
  readonly payload: JsonValue | null;
  /**
   * Renderer discriminator from the task config's `ui_hint`. Consumers
   * with a registered review renderer for this hint present domain-native
   * UI; everything else falls back to structured-data display. The empty
   * string when the task config sets no hint.
   */
  readonly uiHint: string;
  /**
   * Artifact holding the payload when it exceeded the inline promotion
   * threshold. Mutually exclusive with {@link payload}; resolve the
   * content via `stigmer.artifact.getContent`. `null` when inline.
   */
  readonly payloadArtifactId: string | null;
  readonly decision: TaskDetailApprovalDecision | null;
}

/**
 * A resolved human_input decision, sourced from the canonical task-output
 * record (the runner stores the reviewer's full response as the task
 * output) and enriched with timing from the `approval_resolved` event.
 *
 * `outcome` is the empty string during the brief window after a decision
 * is signalled but before the status snapshot reflects the task output —
 * consumers render a "finalizing" affordance in that state.
 */
export interface TaskDetailApprovalDecision {
  /** Chosen outcome identifier (e.g. "approve", "pause_campaigns"). */
  readonly outcome: string;
  /** Reviewer who made the decision. */
  readonly reviewer: string;
  /** ISO-8601 timestamp the decision was recorded, or `null`. */
  readonly respondedAt: string | null;
  /** Free-text comment the reviewer attached, or the empty string. */
  readonly comment: string;
  /** Structured form answers submitted with the decision, or `null`. */
  readonly formData: JsonObject | null;
  /** How long the gate was pending, in milliseconds (from the event). */
  readonly waitDurationMs: number;
  /** `true` when a timeout policy resolved the gate without a human. */
  readonly autoResolved: boolean;
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

  const taskKind = derivedState?.taskKind ??
    buckets.taskKind ??
    WorkflowTaskKind.workflow_task_kind_unspecified;

  const agentCall = buildAgentCall(buckets, taskKind, snapshotMeta);
  const approval = buildApproval(buckets, taskSnapshot?.output);

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
  agentProgress: { childExecutionId: string; agentPhase: number; currentToolName: string; tokensConsumed: bigint; messagesCount: number; toolCallsCount: number } | null;
  agentCompleted: { durationMs: number; tokensConsumed: bigint; costMicros: bigint; error: string; agentPhase: number } | null;
  approvalRequested: { prompt: string; approvers: string[]; timeoutSeconds: number; outcomes: Array<{ name: string; label: string }>; formSchema: JsonObject | null; payload: JsonValue | null; uiHint: string; payloadArtifactId: string | null } | null;
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
          childExecutionId: p.value.childExecutionId,
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
          // The payload rides the event as a google.protobuf.Value message;
          // unwrap it to plain JSON once here so all consumers downstream
          // (renderers, fallback card) work with ordinary values.
          payload: p.value.payload ? (toJson(ValueSchema, p.value.payload) as JsonValue) : null,
          uiHint: p.value.uiHint,
          payloadArtifactId: p.value.payloadArtifactId || null,
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

function buildAgentCall(
  buckets: EventBuckets,
  taskKind: WorkflowTaskKind,
  snapshotMeta: Record<string, unknown> | undefined,
): TaskDetailAgentCall | null {
  if (buckets.agentStarted) {
    const childExecutionId =
      buckets.agentStarted.childExecutionId ||
      buckets.agentProgress?.childExecutionId ||
      "";

    return {
      childExecutionId,
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

  if (taskKind === WorkflowTaskKind.agent_call && snapshotMeta) {
    const aexId = snapshotMeta.agent_execution_id;
    if (typeof aexId === "string" && aexId) {
      return {
        childExecutionId: aexId,
        agentSlug: typeof snapshotMeta.agent_slug === "string" ? snapshotMeta.agent_slug : "",
        agentPhase: "",
        messagesCount: 0,
        toolCallsCount: typeof snapshotMeta.tool_call_count === "number" ? snapshotMeta.tool_call_count : 0,
        tokensConsumed: BIGINT_ZERO,
        costMicros: BIGINT_ZERO,
        error: "",
        currentToolName: "",
      };
    }
  }

  return null;
}

function buildApproval(
  buckets: EventBuckets,
  taskOutput: JsonObject | undefined,
): TaskDetailApproval | null {
  if (!buckets.approvalRequested) return null;

  const req = buckets.approvalRequested;
  const res = buckets.approvalResolved;

  // The human_input task's output IS the canonical decision record: the
  // runner persists the reviewer's full response ({ outcome, reviewer,
  // responded_at, comment, form_data, auto_resolved }) as the task output,
  // a google.protobuf.Struct, so every field survives. Prefer it, and fall
  // back to the lightweight approval_resolved event for fields the output
  // snapshot has not captured yet (the brief window after a decision is
  // signalled but before the status snapshot refreshes).
  const outputOutcome = readSnapshotString(taskOutput, "outcome");
  const hasDecision = res !== null || outputOutcome !== "";
  if (!hasDecision) {
    return {
      prompt: req.prompt,
      approvers: req.approvers,
      outcomes: req.outcomes,
      formSchema: req.formSchema,
      timeoutSeconds: req.timeoutSeconds,
      payload: req.payload,
      uiHint: req.uiHint,
      payloadArtifactId: req.payloadArtifactId,
      decision: null,
    };
  }

  return {
    prompt: req.prompt,
    approvers: req.approvers,
    outcomes: req.outcomes,
    formSchema: req.formSchema,
    timeoutSeconds: req.timeoutSeconds,
    payload: req.payload,
    uiHint: req.uiHint,
    payloadArtifactId: req.payloadArtifactId,
    decision: {
      outcome: outputOutcome,
      reviewer: readSnapshotString(taskOutput, "reviewer") || (res?.resolvedBy ?? ""),
      respondedAt: readSnapshotString(taskOutput, "responded_at") || null,
      comment: readSnapshotString(taskOutput, "comment") || (res?.comment ?? ""),
      formData: readSnapshotObject(taskOutput, "form_data"),
      waitDurationMs: res?.waitDurationMs ?? 0,
      autoResolved: taskOutput?.["auto_resolved"] === true,
    },
  };
}

/** Reads a string field from a task-output Struct, or `""` when absent. */
function readSnapshotString(obj: JsonObject | undefined, key: string): string {
  const value = obj?.[key];
  return typeof value === "string" ? value : "";
}

/** Reads a nested object field from a task-output Struct, or `null`. */
function readSnapshotObject(obj: JsonObject | undefined, key: string): JsonObject | null {
  const value = obj?.[key];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}
