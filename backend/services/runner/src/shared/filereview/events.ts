/**
 * The runner's file-review event producer: maps a harness-agnostic capture into
 * the proto {@code CapturedFileChange} + {@code FileReviewEvent} ledger entries
 * the server folds (append-only, by event_id) into the server-owned stream.
 *
 * This is the runner half of the apply-then-review subsystem. It is intentionally
 * harness-agnostic — it takes per-file before/after content and a kind, not a
 * git-specific shape — so the Cursor (git substrate) and deep-agent (mutation
 * buffer) harnesses author IDENTICAL ledger entries through one seam. Event ids
 * are deterministic ({@link eventId}) so a re-sent heartbeat or a Temporal retry
 * never duplicates an event.
 */

import { create } from "@bufbuild/protobuf";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  CapturedFileChangeSchema,
  FileReviewBaselineCapturedSchema,
  FileReviewCandidateCapturedSchema,
  FileReviewEventSchema,
  FileReviewEventStreamSchema,
  FileReviewFailureSchema,
  FileReviewReconciledSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import type {
  CapturedFileChange,
  FileReviewEvent,
  SnapshotRef,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { FileContentSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  DiffCompleteness,
  FileCaptureClass,
  FileChangeKind,
  FileReviewEventType,
  FileReviewFailureKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { aggregateDigest, fileDigest, sha256Bytes } from "./digest.js";
import { looksBinary } from "../file-change.js";

// The runner is the author of capture/reconcile/failure events. "runner" (not
// the generic "system") matches the cross-edition corpus fixtures and the
// proto's actor convention ("runner" for capture/reconcile, "user" for
// decisions). The projection ignores actor, but keeping it canonical keeps the
// ledger self-describing and the dual-edition corpus honest.
const ACTOR_RUNNER = "runner";

/**
 * The proto enum value NAME for a {@link FileReviewEventType}, e.g.
 * `FILE_REVIEW_EVENT_TYPE_BASELINE_CAPTURED`. {@link eventId} hashes this name so
 * the runner's ids are byte-identical to the Go `author.EventID` / Java
 * `FileReviewStreamAuthor.eventId` (which use the proto name).
 */
const FILE_REVIEW_EVENT_TYPE_NAME: Readonly<Record<FileReviewEventType, string>> = {
  [FileReviewEventType.UNSPECIFIED]: "FILE_REVIEW_EVENT_TYPE_UNSPECIFIED",
  [FileReviewEventType.BASELINE_CAPTURED]: "FILE_REVIEW_EVENT_TYPE_BASELINE_CAPTURED",
  [FileReviewEventType.CANDIDATE_CAPTURED]: "FILE_REVIEW_EVENT_TYPE_CANDIDATE_CAPTURED",
  [FileReviewEventType.FILE_DECIDED]: "FILE_REVIEW_EVENT_TYPE_FILE_DECIDED",
  [FileReviewEventType.RECONCILED]: "FILE_REVIEW_EVENT_TYPE_RECONCILED",
  [FileReviewEventType.FAILED]: "FILE_REVIEW_EVENT_TYPE_FAILED",
};

/**
 * The deterministic idempotency key for a file-review event:
 * `changeSetId:scopeId:eventTypeName`. Capture/reconcile/failure events are
 * change-set-scoped (scopeId == changeSetId); the per-file decision scope is the
 * server's concern. Identical to the Go/Java EventID.
 */
export function eventId(
  changeSetId: string,
  scopeId: string,
  type: FileReviewEventType,
): string {
  return `${changeSetId}:${scopeId}:${FILE_REVIEW_EVENT_TYPE_NAME[type]}`;
}

/** A single captured file delta, harness-agnostic (no git/CAS specifics). */
export interface CapturedChangeInput {
  /** Stable id of this file change within its set (correlation key, never a hash). */
  readonly id: string;
  /** Path before the change (workspace-root-relative). Empty for ADD. */
  readonly pathBefore: string;
  /** Path after the change. Empty for DELETE; differs from pathBefore for RENAME. */
  readonly pathAfter: string;
  readonly kind: FileChangeKind;
  /** Which substrate captured this file (git-tracked, ignored, CAS, ...). */
  readonly captureClass: FileCaptureClass;
  /** Pre-edit content. Omit for ADD. */
  readonly before?: string;
  /** Post-edit content. Omit for DELETE. */
  readonly after?: string;
  /**
   * False when this file's diff could not be captured completely (too large to
   * persist inline before CAS exists, truncated, or binary-only). A change set
   * with any incomplete file cannot be approved as complete.
   */
  readonly diffComplete?: boolean;
}

/** Build an inline FileContent body (offloaded later at the persist chokepoint). */
function inlineFileContent(content: string) {
  return create(FileContentSchema, {
    body: { case: "inline", value: content },
    isBinary: looksBinary(content),
  });
}

/**
 * Build a proto {@link CapturedFileChange} from harness-agnostic input,
 * computing the enforcement digests (`before_sha256`, `after_sha256`,
 * `file_digest`) over the captured bytes.
 */
export function buildCapturedFileChange(input: CapturedChangeInput): CapturedFileChange {
  const beforeSha256 =
    input.before !== undefined ? sha256Bytes(Buffer.from(input.before, "utf8")) : "";
  const afterSha256 =
    input.after !== undefined ? sha256Bytes(Buffer.from(input.after, "utf8")) : "";

  const fc = create(CapturedFileChangeSchema, {
    id: input.id,
    pathBefore: input.pathBefore,
    pathAfter: input.pathAfter,
    kind: input.kind,
    captureClass: input.captureClass,
    beforeSha256,
    afterSha256,
    diffComplete: input.diffComplete ?? true,
    fileDigest: fileDigest({
      pathBefore: input.pathBefore,
      pathAfter: input.pathAfter,
      kind: input.kind,
      beforeSha256,
      afterSha256,
    }),
  });
  if (input.before !== undefined) {
    fc.before = inlineFileContent(input.before);
  }
  if (input.after !== undefined) {
    fc.after = inlineFileContent(input.after);
  }
  return fc;
}

/** Coordinates a change set's lifecycle so every event carries one identity. */
export interface ChangeSetContext {
  readonly changeSetId: string;
  readonly turnId: string;
  /** "cursor" | "deep-agent". */
  readonly harnessId: string;
  /** ISO 8601 timestamp authored onto each event. */
  readonly timestamp: string;
}

/**
 * The BASELINE_CAPTURED event — the first event of a change set's lifecycle,
 * authored at turn start so the projection can materialize the set before any
 * candidate exists.
 */
export function buildBaselineCapturedEvent(
  ctx: ChangeSetContext,
  baselineSnapshot: SnapshotRef | undefined,
): FileReviewEvent {
  return create(FileReviewEventSchema, {
    eventId: eventId(ctx.changeSetId, ctx.changeSetId, FileReviewEventType.BASELINE_CAPTURED),
    changeSetId: ctx.changeSetId,
    eventType: FileReviewEventType.BASELINE_CAPTURED,
    timestamp: ctx.timestamp,
    actor: ACTOR_RUNNER,
    payload: {
      case: "baselineCaptured",
      value: create(FileReviewBaselineCapturedSchema, {
        changeSetId: ctx.changeSetId,
        turnId: ctx.turnId,
        harnessId: ctx.harnessId,
        ...(baselineSnapshot ? { baselineSnapshot } : {}),
      }),
    },
  });
}

/**
 * The CANDIDATE_CAPTURED event — authored at the turn boundary, carrying the
 * authoritative per-file diff and the aggregate digest. `diff_completeness` is
 * derived: PARTIAL_BLOCKED when any file is incomplete, else COMPLETE.
 */
export function buildCandidateCapturedEvent(
  ctx: ChangeSetContext,
  candidateSnapshot: SnapshotRef | undefined,
  changes: readonly CapturedFileChange[],
): FileReviewEvent {
  const allComplete = changes.every((c) => c.diffComplete);
  return create(FileReviewEventSchema, {
    eventId: eventId(ctx.changeSetId, ctx.changeSetId, FileReviewEventType.CANDIDATE_CAPTURED),
    changeSetId: ctx.changeSetId,
    eventType: FileReviewEventType.CANDIDATE_CAPTURED,
    timestamp: ctx.timestamp,
    actor: ACTOR_RUNNER,
    payload: {
      case: "candidateCaptured",
      value: create(FileReviewCandidateCapturedSchema, {
        changeSetId: ctx.changeSetId,
        ...(candidateSnapshot ? { candidateSnapshot } : {}),
        changes: [...changes],
        aggregateDigest: aggregateDigest(
          changes.map((c) => ({
            pathBefore: c.pathBefore,
            pathAfter: c.pathAfter,
            kind: c.kind,
            beforeSha256: c.beforeSha256,
            afterSha256: c.afterSha256,
          })),
        ),
        diffCompleteness: allComplete
          ? DiffCompleteness.COMPLETE
          : DiffCompleteness.PARTIAL_BLOCKED,
      }),
    },
  });
}

/** The RECONCILED event — authored after decisions are applied and verified. */
export function buildReconciledEvent(
  ctx: ChangeSetContext,
  approvedSnapshot: SnapshotRef | undefined,
): FileReviewEvent {
  return create(FileReviewEventSchema, {
    eventId: eventId(ctx.changeSetId, ctx.changeSetId, FileReviewEventType.RECONCILED),
    changeSetId: ctx.changeSetId,
    eventType: FileReviewEventType.RECONCILED,
    timestamp: ctx.timestamp,
    actor: ACTOR_RUNNER,
    payload: {
      case: "reconciled",
      value: create(FileReviewReconciledSchema, {
        changeSetId: ctx.changeSetId,
        ...(approvedSnapshot ? { approvedSnapshot } : {}),
      }),
    },
  });
}

/** A terminal FAILED event in the file-review lifecycle (audit + resume). */
export function buildFailedEvent(
  ctx: ChangeSetContext,
  kind: FileReviewFailureKind,
  detail: string,
): FileReviewEvent {
  return create(FileReviewEventSchema, {
    eventId: eventId(ctx.changeSetId, ctx.changeSetId, FileReviewEventType.FAILED),
    changeSetId: ctx.changeSetId,
    eventType: FileReviewEventType.FAILED,
    timestamp: ctx.timestamp,
    actor: ACTOR_RUNNER,
    payload: {
      case: "failed",
      value: create(FileReviewFailureSchema, { changeSetId: ctx.changeSetId, kind, detail }),
    },
  });
}

/**
 * Append the runner-authored events onto the status's file_review stream
 * (seeding it if absent), idempotently by event_id. The server re-applies the
 * same append-only/by-id discipline on receipt, so re-sending across throttled
 * persists is safe; this keeps the in-runner status consistent between persists.
 */
export function appendFileReviewEvents(
  status: AgentExecutionStatus,
  executionId: string,
  events: readonly FileReviewEvent[],
): void {
  if (events.length === 0) return;
  if (!status.fileReviewEventStream) {
    status.fileReviewEventStream = create(FileReviewEventStreamSchema, {
      executionId,
      events: [],
    });
  }
  const stream = status.fileReviewEventStream;
  const seen = new Set(stream.events.map((e) => e.eventId));
  for (const ev of events) {
    if (seen.has(ev.eventId)) continue;
    seen.add(ev.eventId);
    stream.events.push(ev);
  }
}
