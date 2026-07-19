/**
 * The human_input gate's data model for the thread card — the review
 * material a pending gate presents and the decision record a resolved gate
 * reports (T06).
 *
 * Ported from `execution-inspector/derive-task-detail.ts` when the Inspect
 * drill-down was removed and the review surface moved onto the gating
 * task's card. The event-scan join died with the inspector: the request /
 * resolution payloads are captured by the event store's single canonical
 * walk (`DerivedTaskState.approvalRequest` / `.approvalResolution`), and
 * these projections work off that capture plus the card's O(1) snapshot
 * lookup — never the event log (DD-T04-5, D-T02-4).
 *
 * No React dependencies — independently testable (DD-003).
 */

import type {
  ApprovalRequestedPayload,
  ApprovalResolvedPayload,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { toJson, type JsonObject, type JsonValue } from "@bufbuild/protobuf";
import { ValueSchema } from "@bufbuild/protobuf/wkt";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The review material of a pending human_input gate, projected to the plain
 * shape `WorkflowTaskReviewGate` renders — prompt, outcomes, form schema,
 * and the resolved payload (inline value or artifact reference).
 */
export interface TaskApprovalRequestView {
  /** Resolved prompt text from the task config, rendered as markdown. */
  readonly prompt: string;
  /** Configured outcomes; empty falls back to Approve / Reject. */
  readonly outcomes: readonly { readonly name: string; readonly label: string }[];
  /** JSON Schema for the reviewer's input form, or `null` when none. */
  readonly formSchema: JsonObject | null;
  /**
   * Inline review payload, unwrapped from the event's
   * `google.protobuf.Value` to plain JSON. `null` when the gate carries no
   * payload or when it was promoted to an artifact (see
   * {@link payloadArtifactId} — the two are mutually exclusive).
   */
  readonly payload: JsonValue | null;
  /** Renderer discriminator from the task config's `ui_hint`; `""` = none. */
  readonly uiHint: string;
  /** Artifact holding a promoted payload, or `null` when inline. */
  readonly payloadArtifactId: string | null;
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
/**
 * Display identity of the reviewer, snapshotted server-side at decision
 * time (see `reviewer_actor` in the human_input task-output contract).
 * Renderers apply the fallback ladder: displayName → email → raw
 * {@link TaskDetailApprovalDecision.reviewer} id → omit.
 */
export interface TaskReviewerActor {
  /** Canonical identity (matches the decision's `reviewer`). */
  readonly id: string;
  /** Human-readable name; `""` when unknown. */
  readonly displayName: string;
  /** Email address; `""` when unknown. */
  readonly email: string;
  /** Avatar URL; `""` when unknown. */
  readonly avatar: string;
}

/**
 * How a decided gate's reviewer should be presented — the fallback ladder
 * ({@link TaskReviewerActor} fields first, raw id last) collapsed to a
 * render-ready shape shared by the summary card and the thread caption.
 */
export interface TaskReviewerView {
  /** Best display label: display name → email → canonical id. Never empty. */
  readonly label: string;
  /** Email for secondary display; `""` when unknown or equal to the label. */
  readonly email: string;
  /** Avatar URL; `""` when unknown. */
  readonly avatar: string;
  /**
   * `true` when the label fell through to the raw identity (legacy records
   * that predate actor enrichment) — renderers de-emphasize it.
   */
  readonly isRawId: boolean;
}

export interface TaskDetailApprovalDecision {
  /** Chosen outcome identifier (e.g. "approve", "pause_campaigns"). */
  readonly outcome: string;
  /** Canonical reviewer identity; `""` when the decision is unattributed. */
  readonly reviewer: string;
  /** Display snapshot of the reviewer, or `null` for unenriched records. */
  readonly reviewerActor: TaskReviewerActor | null;
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
// Projections
// ---------------------------------------------------------------------------

/**
 * Projects the captured `approval_requested` payload to the plain view the
 * review gate renders. Pure and cheap — consumers memoize on the payload
 * message's identity (the store keeps it reference-stable).
 */
export function deriveTaskApprovalRequest(
  request: ApprovalRequestedPayload,
): TaskApprovalRequestView {
  return {
    prompt: request.prompt,
    outcomes: (request.outcomes ?? []).map((o) => ({
      name: o.name,
      label: o.label,
    })),
    formSchema: request.formSchema
      ? (request.formSchema as unknown as JsonObject)
      : null,
    // The payload rides the event as a google.protobuf.Value message;
    // unwrap it to plain JSON once here so all consumers downstream
    // (renderers, fallback card) work with ordinary values.
    payload: request.payload
      ? (toJson(ValueSchema, request.payload) as JsonValue)
      : null,
    uiHint: request.uiHint,
    payloadArtifactId: request.payloadArtifactId || null,
  };
}

/**
 * Builds the resolved-decision record for a decided human_input gate, or
 * `null` while no decision exists.
 *
 * The task's output IS the canonical decision record: the runner persists
 * the reviewer's full response ({ outcome, reviewer, responded_at, comment,
 * form_data, auto_resolved }) as the task output, a google.protobuf.Struct,
 * so every field survives. Prefer it, and fall back to the lightweight
 * `approval_resolved` event for fields the output snapshot has not captured
 * yet (the brief window after a decision is signalled but before the status
 * snapshot refreshes).
 */
export function deriveTaskApprovalDecision(
  resolution: ApprovalResolvedPayload | null,
  taskOutput: JsonObject | undefined,
): TaskDetailApprovalDecision | null {
  const outputOutcome = readSnapshotString(taskOutput, "outcome");
  if (resolution === null && outputOutcome === "") return null;

  return {
    outcome: outputOutcome,
    reviewer:
      readSnapshotString(taskOutput, "reviewer") || (resolution?.resolvedBy ?? ""),
    reviewerActor: deriveReviewerActor(resolution, taskOutput),
    respondedAt: readSnapshotString(taskOutput, "responded_at") || null,
    comment:
      readSnapshotString(taskOutput, "comment") || (resolution?.comment ?? ""),
    formData: readSnapshotObject(taskOutput, "form_data"),
    waitDurationMs: resolution ? Number(resolution.waitDurationMs) : 0,
    autoResolved: taskOutput?.["auto_resolved"] === true,
  };
}

/**
 * Collapses a decision's attribution into the render-ready reviewer view,
 * or `null` when the decision carries no attribution at all (timeout
 * auto-resolution, OSS single-user edition) — consumers omit the "by …"
 * segment entirely in that case.
 */
export function deriveTaskReviewer(
  decision: TaskDetailApprovalDecision,
): TaskReviewerView | null {
  const actor = decision.reviewerActor;
  const label = actor?.displayName || actor?.email || decision.reviewer;
  if (!label) return null;

  const email = actor?.email && actor.email !== label ? actor.email : "";
  return {
    label,
    email,
    avatar: actor?.avatar ?? "",
    isRawId: !actor?.displayName && !actor?.email,
  };
}

/**
 * Reviewer actor from the task-output snapshot (snake_case JSON stamped by
 * the control plane), falling back to the `approval_resolved` event's
 * proto actor for the finalizing window — mirroring the same output-first
 * precedence as the scalar decision fields.
 */
function deriveReviewerActor(
  resolution: ApprovalResolvedPayload | null,
  taskOutput: JsonObject | undefined,
): TaskReviewerActor | null {
  const snapshot = readSnapshotObject(taskOutput, "reviewer_actor");
  if (snapshot) {
    return {
      id: readSnapshotString(snapshot, "id"),
      displayName: readSnapshotString(snapshot, "display_name"),
      email: readSnapshotString(snapshot, "email"),
      avatar: readSnapshotString(snapshot, "avatar"),
    };
  }

  const eventActor = resolution?.resolvedByActor;
  if (eventActor) {
    return {
      id: eventActor.id,
      displayName: eventActor.displayName,
      email: eventActor.email,
      avatar: eventActor.avatar,
    };
  }

  return null;
}

/** Reads a string field from a task-output Struct, or `""` when absent. */
function readSnapshotString(obj: JsonObject | undefined, key: string): string {
  const value = obj?.[key];
  return typeof value === "string" ? value : "";
}

/** Reads a nested object field from a task-output Struct, or `null`. */
function readSnapshotObject(
  obj: JsonObject | undefined,
  key: string,
): JsonObject | null {
  const value = obj?.[key];
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}
