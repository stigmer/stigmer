/**
 * File-review ledger authoring — ports filereview/author.go: the
 * deterministic event ids, the human-decision builder, the FILE_DECIDED
 * append (the backend-owned writer), the runner-event fold, and the
 * digest/completeness enforcement predicates SubmitFileDecision checks
 * before authoring a decision.
 */
import { create, enumToJson } from "@bufbuild/protobuf";

import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  DiffCompleteness,
  FileDecisionAction,
  FileDecisionOrigin,
  FileDecisionScope,
  FileReviewEventType,
  FileReviewEventTypeSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type {
  CapturedFileChange,
  FileChangeSet,
  FileDecision,
  FileReviewEventStream,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  FileDecisionSchema,
  FileReviewEventSchema,
  FileReviewEventStreamSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";

export const ACTOR_USER = "user";

/**
 * Stamps events authored by a platform policy (the DD-28 approved-command
 * auto-keep) — never attributed to the user, so the audit trail always
 * shows WHO decided.
 */
export const ACTOR_POLICY = "policy";

/**
 * The deterministic idempotency key for a file-review event:
 * changeSetId:scopeId:eventType (the type rendered as the FULL proto enum
 * value name, byte-identical to Go's .String()). Authoring is
 * append-if-absent on this key, so re-deriving or retrying never
 * duplicates an event.
 */
export function eventId(
  changeSetId: string,
  scopeId: string,
  eventType: FileReviewEventType,
): string {
  return `${changeSetId}:${scopeId}:${enumToJson(FileReviewEventTypeSchema, eventType) as string}`;
}

/**
 * The scope discriminator inside a decision's event id: the file change
 * id for FILE scope, the change set id for CHANGE_SET scope — lets a set
 * carry both one set-wide decision and per-file decisions without
 * event-id collisions.
 */
export function decisionScopeId(d: FileDecision): string {
  if (d.scope === FileDecisionScope.FILE) {
    return d.fileChangeId;
  }
  return d.changeSetId;
}

/**
 * Assembles a FileDecision from a validated SubmitFileDecision request
 * plus server-supplied identity. The id is deterministic
 * (changeSetId:scopeId) so a resubmit yields the same decision and the
 * same event id — idempotent by construction. Origin is always USER (the
 * policy auto-keep has its own constructor in autokeep.ts).
 */
export function buildFileDecision(
  changeSetId: string,
  fileChangeId: string,
  scope: FileDecisionScope,
  action: FileDecisionAction,
  expectedDigest: string,
  reviewerId: string,
  decidedAt: string,
  reason: string,
  acknowledgeUnreviewable: boolean,
): FileDecision {
  const decision = create(FileDecisionSchema, {
    changeSetId,
    fileChangeId,
    scope,
    action,
    expectedDigest,
    reviewerId,
    decidedAt,
    reason,
    acknowledgeUnreviewable,
    origin: FileDecisionOrigin.USER,
  });
  decision.id = `${changeSetId}:${decisionScopeId(decision)}`;
  return decision;
}

/**
 * Authors a FILE_DECIDED event for the decision and appends it to the
 * execution's file_review stream, idempotently by event id. The
 * backend-owned writer (the runner authors capture/reconcile events).
 * Run inside the store's write lock on a freshly-loaded stream so the
 * append can never clobber a concurrent write.
 */
export function recordFileDecisionEvent(
  status: AgentExecutionStatus | undefined,
  executionId: string,
  decision: FileDecision | undefined,
): void {
  recordFileDecisionEventWithActor(status, executionId, decision, ACTOR_USER);
}

/**
 * The single FILE_DECIDED append: the human path stamps ACTOR_USER, the
 * auto-keep policy stamps ACTOR_POLICY. Both share the deterministic
 * event id, so whichever authority decides first wins and a
 * retry/resubmit never duplicates.
 */
export function recordFileDecisionEventWithActor(
  status: AgentExecutionStatus | undefined,
  executionId: string,
  decision: FileDecision | undefined,
  actor: string,
): void {
  if (status === undefined || decision === undefined) {
    return;
  }
  let stream = status.fileReviewEventStream;
  if (stream === undefined) {
    stream = create(FileReviewEventStreamSchema, { executionId });
    status.fileReviewEventStream = stream;
  }
  const event = create(FileReviewEventSchema, {
    eventId: eventId(
      decision.changeSetId,
      decisionScopeId(decision),
      FileReviewEventType.FILE_DECIDED,
    ),
    changeSetId: decision.changeSetId,
    eventType: FileReviewEventType.FILE_DECIDED,
    timestamp: decision.decidedAt,
    actor,
    payload: { case: "fileDecided", value: decision },
  });
  if (hasEvent(stream, event.eventId)) {
    return;
  }
  stream.events.push(event);
}

/**
 * Folds the capture/reconcile events the runner authored on its
 * UpdateStatus payload into the execution's server-owned file_review
 * stream, append-only and idempotent by event_id — the file-review
 * analogue of ensureApprovalRequests: the runner contributes events, the
 * server owns the stream.
 *
 * Two invariants are enforced here, not merely documented:
 *   - One writer per event type. FILE_DECIDED is authored exclusively by
 *     SubmitFileDecision; a runner-sent FILE_DECIDED is dropped, so the
 *     runner can never forge a human decision.
 *   - Append-only. An event whose deterministic event_id already exists
 *     is skipped, so a re-sent heartbeat or a Temporal retry never
 *     duplicates (or overwrites) an event.
 *
 * Must run inside the store write lock on the freshly-loaded stream so
 * the appends cannot clobber a concurrent SubmitFileDecision.
 */
export function appendRunnerEvents(
  status: AgentExecutionStatus | undefined,
  executionId: string,
  requestStatus: AgentExecutionStatus | undefined,
): void {
  if (status === undefined || requestStatus === undefined) {
    return;
  }
  const incoming = requestStatus.fileReviewEventStream?.events ?? [];
  if (incoming.length === 0) {
    return;
  }

  let stream = status.fileReviewEventStream;
  if (stream === undefined) {
    stream = create(FileReviewEventStreamSchema, { executionId });
    status.fileReviewEventStream = stream;
  }

  for (const ev of incoming) {
    // Decisions are server-owned (SubmitFileDecision). Never accept one
    // from the runner — defense in depth against a forged human verdict.
    if (ev.eventType === FileReviewEventType.FILE_DECIDED) {
      continue;
    }
    if (ev.eventId === "" || ev.changeSetId === "") {
      continue;
    }
    if (hasEvent(stream, ev.eventId)) {
      continue;
    }
    stream.events.push(ev);
  }
}

function hasEvent(stream: FileReviewEventStream, id: string): boolean {
  return stream.events.some((ev) => ev.eventId === id);
}

/** The projected change set with the given id, or undefined. */
export function findChangeSet(
  changeSets: FileChangeSet[],
  changeSetId: string,
): FileChangeSet | undefined {
  return changeSets.find((cs) => cs.id === changeSetId);
}

/** The captured change with the given id within a set, or undefined. */
export function findChange(
  cs: FileChangeSet,
  fileChangeId: string,
): CapturedFileChange | undefined {
  return cs.changes.find((c) => c.id === fileChangeId);
}

/**
 * The digest a decision's expected_digest is checked against: the file's
 * file_digest for FILE scope, the set's aggregate_digest for CHANGE_SET
 * scope. Enforcement only — never used to correlate.
 */
export function targetDigest(
  cs: FileChangeSet,
  scope: FileDecisionScope,
  fileChangeId: string,
): string {
  if (scope === FileDecisionScope.FILE) {
    return findChange(cs, fileChangeId)?.fileDigest ?? "";
  }
  return cs.aggregateDigest;
}

/**
 * Why an APPROVE of the decision's target must be refused because its
 * diff is not fully reviewable, or "" when the approve may proceed — the
 * completeness sibling of targetDigest; the second precondition
 * SubmitFileDecision enforces before authoring a decision.
 *
 * The report rule: a non-COMPLETE diff can never be kept as if complete,
 * so an unreviewable target is not approvable. Applied to APPROVE only —
 * REJECT is never gated, so an unreviewable change stays discardable and
 * the turn can still resume (liveness). FILE scope turns on the one
 * file's diff_complete; CHANGE_SET scope on the set's diff_completeness,
 * so a complete file inside a PARTIAL_BLOCKED set is still approvable on
 * its own. Fail-closed: an UNSPECIFIED completeness, an absent change, or
 * an absent set are all not approvable.
 *
 * The binary-acknowledgment carve-out (DD-16 / DD-17): a BINARY file has
 * no text diff but its exact bytes are captured and byte-true
 * reconcilable, so acknowledged==true relaxes the completeness gate for
 * binaries — the ONLY relaxation: binary only (never a secret-withheld /
 * size-elided / uncapturable file, which have no keepable bytes), and it
 * never touches the expected_digest gate. The CHANGE_SET carve-out
 * re-derives "binary-only" from the actual changes, never from the
 * diff_completeness rollup, so a stale or mislabeled rollup can never
 * widen what may be kept.
 */
export function approveBlockedReason(
  cs: FileChangeSet | undefined,
  scope: FileDecisionScope,
  fileChangeId: string,
  acknowledged: boolean,
): string {
  if (cs === undefined) {
    return "change set is not reviewable";
  }
  if (scope === FileDecisionScope.FILE) {
    const c = findChange(cs, fileChangeId);
    if (c === undefined) {
      return `file change ${fileChangeId} is not reviewable`;
    }
    if (!c.diffComplete) {
      // A binary file the user consciously acknowledged is keepable: no
      // text diff, but exact reconcilable bytes. Every other
      // incompleteness has no keepable bytes, so acknowledgment does not
      // unblock it.
      if (acknowledged && isBinaryChange(c)) {
        return "";
      }
      return `file change ${fileChangeId} cannot be approved: its diff is not fully reviewable (incomplete or binary); reject it to discard, or wait for a complete capture`;
    }
    return "";
  }
  // CHANGE_SET scope: a COMPLETE set is approvable as-is. Otherwise the
  // only one-shot keep allowed is a set whose every incompleteness is
  // binary, and only when the user consciously acknowledged it ("Keep
  // all", DD-17). Re-derived from the actual changes, never the rollup,
  // so a stale label cannot let a non-binary file ride along.
  if (cs.diffCompleteness === DiffCompleteness.COMPLETE) {
    return "";
  }
  if (acknowledged && everyIncompleteChangeIsBinary(cs)) {
    return "";
  }
  return `change set ${cs.id} cannot be approved: at least one file's diff is not fully reviewable (incomplete or binary); reject the affected files or the whole set, or wait for a complete capture`;
}

/**
 * Whether either side of a captured change is binary — the single signal
 * for "reviewable as bytes but not as a text diff" (binary is conveyed by
 * FileContent.is_binary, never blocked_reason).
 */
export function isBinaryChange(c: CapturedFileChange): boolean {
  return (c.before?.isBinary ?? false) || (c.after?.isBinary ?? false);
}

/**
 * Whether the set has at least one incomplete change and every incomplete
 * change is binary — the "keep-all is safe" condition (DD-17). The
 * enforcement boundary for a CHANGE_SET-scoped acknowledged approve:
 * re-deriving from the changes means a secret-withheld / size-elided file
 * (absent content → not binary) always blocks the bulk keep, whatever the
 * diff_completeness rollup claims.
 */
export function everyIncompleteChangeIsBinary(cs: FileChangeSet): boolean {
  let sawIncomplete = false;
  for (const c of cs.changes) {
    if (c.diffComplete) {
      continue;
    }
    sawIncomplete = true;
    if (!isBinaryChange(c)) {
      return false;
    }
  }
  return sawIncomplete;
}
