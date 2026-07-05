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
  TurnCommandProvenance,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  FileContentSchema,
  ToolCallOutputRefSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { FileContent } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  DiffCompleteness,
  FileCaptureClass,
  FileChangeKind,
  FileReviewBlockReason,
  FileReviewEventType,
  FileReviewFailureKind,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { aggregateDigest, fileDigest, sha256Bytes } from "./digest.js";
import { countLineChanges, type LineChangeCounts } from "./line-counts.js";
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

/**
 * One side (before/after) of a captured file's content, in one of three shapes:
 *
 * - `inline` — the raw text bytes, carried on the wire (the git substrate reads
 *   them from the tree for text files). A plain string is accepted as shorthand.
 * - `ref` — a reference to an already-stored, content-addressed blob (the CAS
 *   substrate offloads ignored / non-git bodies to artifact storage and carries
 *   the ref, so the body is never stored twice).
 * - `binary` — a git-tracked binary side: NO body is carried (a binary has no
 *   reviewable text diff, and reconcile sources its bytes byte-exact from the
 *   git ref, never from the wire), only the byte-true content address. This is
 *   what keeps the enforcement digest honest for binaries — hashing a UTF-8
 *   decode of binary bytes would be lossy.
 */
export type CapturedContent =
  | {
      readonly kind: "inline";
      readonly text: string;
      /**
       * Byte-true SHA-256 of the RAW bytes, when the producer computed it at the
       * source (the git substrate does). Preferred over hashing `text`, which for
       * a non-UTF-8 blob (e.g. latin-1 with no NUL) would hash a lossy decode.
       * Absent for the plain-string shorthand, where `text` IS the exact content.
       */
      readonly sha256?: string;
    }
  | {
      readonly kind: "ref";
      /** Content address of the referenced blob (the enforcement digest). */
      readonly sha256: string;
      readonly storageKey: string;
      readonly sizeBytes: number;
      readonly isBinary: boolean;
      readonly mimeType?: string;
    }
  | {
      readonly kind: "binary";
      /** Byte-true SHA-256 of the raw bytes (the enforcement digest). */
      readonly sha256: string;
    };

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
  /** Pre-edit content (inline string, or a blob ref). Omit for ADD. */
  readonly before?: string | CapturedContent;
  /** Post-edit content (inline string, or a blob ref). Omit for DELETE. */
  readonly after?: string | CapturedContent;
  /**
   * False when this file's diff could not be captured completely (too large to
   * persist inline before CAS exists, truncated, or binary-only). A change set
   * with any incomplete file cannot be approved as complete.
   */
  readonly diffComplete?: boolean;
  /**
   * The honest cause the diff is not fully reviewable, set only alongside
   * `diffComplete === false` (defaults to UNSPECIFIED). Informational provenance
   * for the review UI — never an enforcement input and never folded into the
   * digests. Binary is conveyed by FileContent.is_binary, so binary files leave
   * this UNSPECIFIED. See {@link FileReviewBlockReason}.
   */
  readonly blockedReason?: FileReviewBlockReason;
  /**
   * Display line counts for this change, for producers whose bodies are not
   * inline here (the CAS substrate counts from the in-memory bytes before
   * offloading them as blob refs). Omit for inline content —
   * {@link buildCapturedFileChange} then counts the inline sides itself, with
   * the same shared {@link countLineChanges}. Informational only, never folded
   * into the digests.
   */
  readonly lineCounts?: LineChangeCounts;
}

/** Normalize the string-shorthand to a {@link CapturedContent}. */
function normalizeContent(v: string | CapturedContent | undefined): CapturedContent | undefined {
  if (v === undefined) return undefined;
  return typeof v === "string" ? { kind: "inline", text: v } : v;
}

/**
 * The enforcement digest of one content side. Inline text is hashed as UTF-8
 * bytes; a `ref`/`binary` side already carries its byte-true content address, so
 * it is reused verbatim. This single function is the sole sha authority — used
 * both at capture (in {@link buildCapturedFileChange}) and at the resume-time
 * reconcile check — so the two are consistent by construction across substrates.
 */
export function contentSha256(content: CapturedContent): string {
  switch (content.kind) {
    case "inline":
      return content.sha256 ?? sha256Bytes(Buffer.from(content.text, "utf8"));
    case "ref":
    case "binary":
      return content.sha256;
  }
}

/**
 * Count the display `+N −M` from a change's inline sides, or `undefined` when
 * counting is not honest here: a side that exists without inline text (a `ref`
 * whose bytes were already offloaded, or a `binary` side with no body), or
 * inline text that would render as binary (the UI shows "Binary file changed"
 * for it, never a line diff — a count would describe a diff nobody sees).
 * An absent side is fine — it is the empty document of an ADD/DELETE.
 */
function countInlineSides(
  before: CapturedContent | undefined,
  after: CapturedContent | undefined,
): LineChangeCounts | undefined {
  const beforeText = inlineTextOrNull(before);
  const afterText = inlineTextOrNull(after);
  if (beforeText === null || afterText === null) return undefined;
  return countLineChanges(beforeText, afterText);
}

/**
 * A side's countable inline text: the text for a non-binary inline side,
 * `undefined` for an absent side (countable as the empty document), and `null`
 * when the side exists but cannot be counted (ref / binary / binary-looking).
 */
function inlineTextOrNull(
  content: CapturedContent | undefined,
): string | undefined | null {
  if (content === undefined) return undefined;
  if (content.kind !== "inline" || looksBinary(content.text)) return null;
  return content.text;
}

/** Build the proto {@link FileContent} for one content side (inline, ref, or binary). */
function toFileContent(content: CapturedContent): FileContent {
  if (content.kind === "inline") {
    return create(FileContentSchema, {
      body: { case: "inline", value: content.text },
      isBinary: looksBinary(content.text),
    });
  }
  // A git-tracked binary carries no body: its bytes reconcile from the git ref,
  // and a text diff of binary content is meaningless. Consumers key off the
  // is_binary flag (the SDK renders "binary file changed"; the backend gates
  // approval on it), never a body.
  if (content.kind === "binary") {
    return create(FileContentSchema, { isBinary: true });
  }
  return create(FileContentSchema, {
    body: {
      case: "ref",
      value: create(ToolCallOutputRefSchema, {
        storageKey: content.storageKey,
        sizeBytes: BigInt(content.sizeBytes),
        contentHash: content.sha256,
        mimeType: content.mimeType ?? "application/octet-stream",
        isImage: false,
        truncatedPreview: "",
      }),
    },
    isBinary: content.isBinary,
  });
}

/**
 * Build a proto {@link CapturedFileChange} from harness-agnostic input,
 * computing the enforcement digests (`before_sha256`, `after_sha256`,
 * `file_digest`) over the captured bytes. Content may be inline (git) or a blob
 * ref (CAS) — the digests are identical either way, so the aggregate digest and
 * the reconcile enforcement compose across both substrates.
 *
 * Display line counts are stamped here too — the single seam every substrate
 * flows through — from `input.lineCounts` when the producer counted at its own
 * source (CAS), else counted from the inline sides. Counting happens BEFORE any
 * persist-time offload, so the counts survive a body being elided later. They
 * never enter `fileDigest` (informational, not enforcement).
 */
export function buildCapturedFileChange(input: CapturedChangeInput): CapturedFileChange {
  const before = normalizeContent(input.before);
  const after = normalizeContent(input.after);
  const beforeSha256 = before ? contentSha256(before) : "";
  const afterSha256 = after ? contentSha256(after) : "";
  const counts = input.lineCounts ?? countInlineSides(before, after);

  const fc = create(CapturedFileChangeSchema, {
    id: input.id,
    pathBefore: input.pathBefore,
    pathAfter: input.pathAfter,
    kind: input.kind,
    captureClass: input.captureClass,
    beforeSha256,
    afterSha256,
    diffComplete: input.diffComplete ?? true,
    blockedReason: input.blockedReason ?? FileReviewBlockReason.UNSPECIFIED,
    linesAdded: counts?.linesAdded ?? 0,
    linesRemoved: counts?.linesRemoved ?? 0,
    fileDigest: fileDigest({
      pathBefore: input.pathBefore,
      pathAfter: input.pathAfter,
      kind: input.kind,
      beforeSha256,
      afterSha256,
    }),
  });
  if (before) {
    fc.before = toFileContent(before);
  }
  if (after) {
    fc.after = toFileContent(after);
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
 * Derive a change set's {@link DiffCompleteness} rollup from its per-file
 * signals — the single source of the three-way rule, shared by the turn-boundary
 * capture ({@link buildCandidateCapturedEvent}) and the size backstop
 * (status-offload), so the value can never be computed two ways:
 *
 * - every file complete → `COMPLETE`
 * - else the ONLY incompleteness is binary (every incomplete file has a binary
 *   side) → `BINARY_SUMMARY_ONLY` — keepable in one acknowledged action, its
 *   exact bytes reconcile from the git ref / CAS blob
 * - else (≥1 non-binary incomplete: secret-withheld / size-elided /
 *   uncapturable — no keepable bytes) → `PARTIAL_BLOCKED`
 *
 * Binary is proven by `FileContent.is_binary` on either side (DD-15 D2), never
 * by the block reason. This mirrors the backend gate's `isBinaryChange`, so the
 * runner's rollup and the gate's per-file re-derivation agree by construction.
 */
export function deriveDiffCompleteness(
  changes: readonly CapturedFileChange[],
): DiffCompleteness {
  let sawIncomplete = false;
  for (const c of changes) {
    if (c.diffComplete) continue;
    sawIncomplete = true;
    if (!(c.before?.isBinary || c.after?.isBinary)) {
      // A non-binary incompleteness has no keepable bytes — it blocks the set
      // outright, regardless of any binaries alongside it.
      return DiffCompleteness.PARTIAL_BLOCKED;
    }
  }
  if (!sawIncomplete) return DiffCompleteness.COMPLETE;
  return DiffCompleteness.BINARY_SUMMARY_ONLY;
}

/**
 * The CANDIDATE_CAPTURED event — authored at the turn boundary, carrying the
 * authoritative per-file diff and the aggregate digest. `diff_completeness` is
 * the {@link deriveDiffCompleteness} rollup over the changes.
 *
 * `commandProvenance` (optional, DD-28) is the harness's approved-command turn
 * facts: when present, the backend verifies the cited consent rows against its
 * server-authored approval record and — on success — auto-keeps the set with a
 * policy-origin decision instead of arming the review gate. Never folded into
 * the aggregate digest (provenance, not content).
 */
export function buildCandidateCapturedEvent(
  ctx: ChangeSetContext,
  candidateSnapshot: SnapshotRef | undefined,
  changes: readonly CapturedFileChange[],
  commandProvenance?: TurnCommandProvenance,
): FileReviewEvent {
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
        diffCompleteness: deriveDiffCompleteness(changes),
        ...(commandProvenance ? { commandProvenance } : {}),
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
 * Whether a CANDIDATE_CAPTURED event exists for `changeSetId` on the status's
 * file_review stream — i.e. this turn actually produced a reviewable change
 * set. The capture seam authors no event for a no-op turn (an edit fully
 * reverted before the boundary), so this is the single signal both harnesses
 * gate on before opening a review or stamping transcript rows: a row must
 * never reference a change set that does not exist.
 */
export function hasCandidateCaptured(
  status: AgentExecutionStatus,
  changeSetId: string,
): boolean {
  return (status.fileReviewEventStream?.events ?? []).some(
    (e) =>
      e.changeSetId === changeSetId &&
      e.eventType === FileReviewEventType.CANDIDATE_CAPTURED,
  );
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
