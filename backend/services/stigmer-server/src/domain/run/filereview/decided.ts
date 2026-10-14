/**
 * The `stigmer.file_review.decided` event every file-review decision is
 * recorded as: a person's keep or undo (the decision core,
 * ../../session/filereview/decide.ts) and the rules that keep changes on
 * the person's behalf (autokeep.ts). The server is its only writer; a
 * writer returns the event from its run write (session/events/
 * run-writes.ts), which appends it after the write's status events.
 *
 * The id is derived from the decision's target alone: the change set and,
 * for a file decision, the file. A target's decision is final, so a second
 * decision on it carries the same id and the log refuses it; a retry of
 * the same decision appends nothing. The text hashed is the target's key
 * as every decision on it has always been keyed, so a target decided
 * before this module wrote its event keeps the same id.
 *
 * `decided_by` is the account of the person who decided, from the caller
 * the decision core authorized; a rule's keep names nobody.
 *
 * Proven by __tests__/decided.test.ts.
 */
import { createHash } from "node:crypto";

import { create } from "@bufbuild/protobuf";

import { SessionEventSchema, type SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import { SESSION_EVENT_ID_PREFIX } from "../../session/events/catalog.js";
import type { ActionWord, OriginWord, ScopeWord } from "../../session/filereview/words.js";

/** One decision, as its event says it. */
export interface Decision {
  readonly changeSetId: string;
  readonly scope: ScopeWord;
  /** The file decided; ignored for a change-set decision. */
  readonly fileChangeId: string;
  readonly action: ActionWord;
  /** The digest the decision was made against. */
  readonly expectedDigest: string;
  readonly origin: OriginWord;
  readonly reason: string;
  /** The account of the person who decided; "" for a rule's keep. */
  readonly decidedBy: string;
}

/** The id prefix of a `stigmer.file_review.decided` event: server-minted, so `sevt_`. */
const DECIDED_EVENT_ID_PREFIX = `${SESSION_EVENT_ID_PREFIX}_fd_`;

/** The suffix of a decision target's key (module header). */
const TARGET_KEY_SUFFIX = "FILE_REVIEW_EVENT_TYPE_FILE_DECIDED";

/**
 * The decided event id of a decision on this target: the prefix and the
 * first 40 hex digits of the sha256 of the target's key,
 * `<change set>:<file, or the change set again>:FILE_REVIEW_EVENT_TYPE_FILE_DECIDED`.
 */
export function fileReviewDecidedEventId(changeSetId: string, scope: ScopeWord, fileChangeId: string): string {
  const scopeId = scope === "file" ? fileChangeId : changeSetId;
  const key = `${changeSetId}:${scopeId}:${TARGET_KEY_SUFFIX}`;
  return `${DECIDED_EVENT_ID_PREFIX}${createHash("sha256").update(key).digest("hex").slice(0, 40)}`;
}

/** The decision as its event, on the change set's run. */
export function decidedEvent(runId: string, decision: Decision): SessionEvent {
  const fileChangeId = decision.scope === "file" ? decision.fileChangeId : "";
  return create(SessionEventSchema, {
    runId,
    event: {
      case: "stigmerFileReviewDecided",
      value: {
        id: fileReviewDecidedEventId(decision.changeSetId, decision.scope, fileChangeId),
        changeSetId: decision.changeSetId,
        scope: decision.scope,
        fileChangeId,
        action: decision.action,
        expectedDigest: decision.expectedDigest,
        origin: decision.origin,
        reason: decision.reason,
        decidedBy: decision.decidedBy,
      },
    },
  });
}
