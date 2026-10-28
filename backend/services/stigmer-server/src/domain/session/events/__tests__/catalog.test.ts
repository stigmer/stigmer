/**
 * Pins the catalog (../catalog.ts) and the codec (../codec.ts): every event
 * the contract carries declares its Managed Agents type once, on its oneof
 * member; a runner's types are a subset that leaves the user's turn, the
 * session's status, a turn's status, every file-review decision and a
 * person's stop of a background command to the server; a
 * draft's bytes carry no seq, session or accepted time, so a resent event
 * encodes to the stored bytes; an ask's policy source admits the word of
 * every source a run records (the shared policy-source corpus,
 * apis/testdata/hitl/policy-source); and every file-review word the server
 * speaks (../../filereview/words.ts) passes its event's validation.
 */
import path from "node:path";

import { create, equals } from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";
import { describe, expect, it } from "vitest";

import {
  SessionEventSchema,
  StigmerFileReviewChangeSchema,
  StigmerFileReviewDecidedEventSchema,
  StigmerFileReviewReconciledEventSchema,
  StigmerPermissionAskedEventSchema,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import { SESSION_EVENT_TYPES, isStigmerEventType } from "@stigmer/session-log";
import { RUNNER_EVENT_TYPES, SESSION_STATUS_TYPES } from "../catalog.js";
import { draftOf, eventOf } from "../codec.js";
import { hitlCorpusDir, readCorpusJson } from "../../../run/approval/__tests__/corpus-support.js";
import {
  ACTION_WORDS,
  ORIGIN_WORDS,
  SCOPE_WORDS,
  actionOfWord,
  scopeOfWord,
} from "../../filereview/words.js";

describe("the catalog", () => {
  it("every Stigmer event but a file-review decision, a permission grant, a turn's status and a person's stop is the runner's to append", () => {
    const own = SESSION_EVENT_TYPES.filter(isStigmerEventType);
    expect(own).toEqual([
      "stigmer.agent.thinking",
      "stigmer.permission.asked",
      "stigmer.harness.note",
      "stigmer.agent.structured_output",
      "stigmer.memory.recalled",
      "stigmer.file_review.changes",
      "stigmer.file_review.decided",
      "stigmer.file_review.reconciled",
      "stigmer.permission.grant",
      "stigmer.run.status",
      "stigmer.tool_result.full_output",
      "stigmer.background_command.status",
      "stigmer.background_command.stop_requested",
      "stigmer.mcp.tool_definition",
    ]);
    const serverOnly = [
      "stigmer.file_review.decided",
      "stigmer.permission.grant",
      "stigmer.run.status",
      "stigmer.background_command.stop_requested",
    ];
    for (const type of own) {
      expect(RUNNER_EVENT_TYPES.has(type), type).toBe(!serverOnly.includes(type));
    }
  });

  it("a person's answers and stop are the server's to write, never a runner's", () => {
    for (const type of [
      "user.tool_confirmation",
      "user.interrupt",
      "user.message",
      "stigmer.background_command.stop_requested",
    ]) {
      expect(RUNNER_EVENT_TYPES.has(type), type).toBe(false);
    }
  });

  it("a runner appends only landed types, never the user's turn, the session's status or a decision", () => {
    for (const type of RUNNER_EVENT_TYPES) {
      expect(SESSION_EVENT_TYPES).toContain(type);
    }
    for (const type of ["user.message", ...SESSION_STATUS_TYPES, "stigmer.file_review.decided"]) {
      expect(RUNNER_EVENT_TYPES.has(type)).toBe(false);
    }
  });
});

describe("the codec", () => {
  it("a draft leaves out seq, session and accepted time, and a read puts them back", () => {
    const event = create(SessionEventSchema, {
      seq: 9n,
      sessionId: "ses_1",
      runId: "run_1",
      threadId: "thr_1",
      event: { case: "agentMessage", value: { id: "m1", processedAt: "2026-10-11T09:30:00.000Z", content: [{ type: "text", text: "hi" }] } },
    });
    const draft = draftOf(event);
    expect([draft.eventId, draft.runId, draft.threadId, draft.type]).toEqual(["m1", "run_1", "thr_1", "agent.message"]);
    const bare = create(SessionEventSchema, {
      runId: "run_1",
      threadId: "thr_1",
      event: { case: "agentMessage", value: { id: "m1", content: [{ type: "text", text: "hi" }] } },
    });
    expect(draftOf(bare).data).toEqual(draft.data);
    const read = eventOf({ ...draft, sessionId: "ses_1", seq: 9, processedAt: "2026-10-11T09:30:00.000Z" });
    expect(equals(SessionEventSchema, read, event)).toBe(true);
  });
});

describe("an ask's policy source", () => {
  const validator = createValidator();
  const ask = (policySource: string) =>
    validator.validate(StigmerPermissionAskedEventSchema, create(StigmerPermissionAskedEventSchema, { id: "a", toolUseId: "u", policySource })).kind;

  it("admits the word of every source a run records, and none", () => {
    const corpus = readCorpusJson(path.join(hitlCorpusDir(), "policy-source", "vectors.json")) as unknown as {
      vectors: Array<{ policySource: string | null; name_proto: string }>;
    };
    expect(corpus.vectors.length).toBeGreaterThan(1);
    for (const vector of corpus.vectors) {
      expect(ask(vector.policySource ?? ""), vector.name_proto).toBe("valid");
    }
  });

  it("refuses any other word", () => {
    expect(ask("APPROVAL_POLICY_SOURCE_HOOK")).toBe("invalid");
  });
});

describe("the file-review words", () => {
  const validator = createValidator();
  const decided = (fields: { scope?: string; action?: string; origin?: string }) =>
    validator.validate(
      StigmerFileReviewDecidedEventSchema,
      create(StigmerFileReviewDecidedEventSchema, {
        id: "sevt_fd_1",
        changeSetId: "run_1:1",
        scope: "change_set",
        action: "keep",
        origin: "person",
        ...fields,
      }),
    ).kind;

  it("every scope, action and origin the server speaks is a word its event admits, read back as itself", () => {
    for (const word of SCOPE_WORDS) {
      expect(decided({ scope: word }), word).toBe("valid");
      expect(scopeOfWord(word)).toBe(word);
    }
    for (const word of ACTION_WORDS) {
      expect(decided({ action: word }), word).toBe("valid");
      expect(actionOfWord(word)).toBe(word);
    }
    for (const word of ORIGIN_WORDS) {
      expect(decided({ origin: word }), word).toBe("valid");
    }
  });

  it("refuses an enum name in place of a word, and reads no word from one", () => {
    expect(decided({ scope: "CHANGE_SET" })).toBe("invalid");
    expect(decided({ action: "APPROVE" })).toBe("invalid");
    expect(decided({ origin: "user" })).toBe("invalid");
    expect(scopeOfWord("CHANGE_SET")).toBeUndefined();
    expect(actionOfWord("approve")).toBeUndefined();
  });

  it("admits every change and reviewable word of the shared table, and the reconcile's failures", () => {
    const change = (fields: { change?: string; reviewable?: string }) =>
      validator.validate(
        StigmerFileReviewChangeSchema,
        create(StigmerFileReviewChangeSchema, { fileChangeId: "fc-1", change: "added", reviewable: "complete", ...fields }),
      ).kind;
    for (const word of ["added", "modified", "deleted", "renamed"]) {
      expect(change({ change: word }), word).toBe("valid");
    }
    for (const word of ["complete", "partial", "binary", "secret"]) {
      expect(change({ reviewable: word }), word).toBe("valid");
    }
    expect(change({ change: "binary_change" })).toBe("invalid");
    const reconciled = (failure: string) =>
      validator.validate(
        StigmerFileReviewReconciledEventSchema,
        create(StigmerFileReviewReconciledEventSchema, { id: "run_1.fr1.r", changeSetId: "run_1:1", failure }),
      ).kind;
    for (const failure of ["", "hash_mismatch", "reconcile_failed"]) {
      expect(reconciled(failure), failure || "none").toBe("valid");
    }
    expect(reconciled("failed")).toBe("invalid");
  });
});
