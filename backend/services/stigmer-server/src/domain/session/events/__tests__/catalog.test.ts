/**
 * Pins the catalog (../catalog.ts) and the codec (../codec.ts): every event
 * the contract carries declares its Managed Agents type once, on its oneof
 * member; a runner's types are a subset that leaves the user's turn, the
 * session's status, a turn's status and every file-review decision to
 * the server; a
 * draft's bytes carry no seq, session or accepted time, so a resent event
 * encodes to the stored bytes; an ask's policy source admits the word of
 * every source a run records; and every file-review word the server maps
 * (../../filereview/words.ts) passes its event's validation, while a value
 * newer than this binary maps to no word.
 */
import { create, equals } from "@bufbuild/protobuf";
import { createValidator } from "@bufbuild/protovalidate";
import { describe, expect, it } from "vitest";

import {
  ApprovalPolicySourceSchema,
  FileDecisionActionSchema,
  FileDecisionOriginSchema,
  FileDecisionScopeSchema,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import {
  SessionEventSchema,
  StigmerFileReviewChangeSchema,
  StigmerFileReviewDecidedEventSchema,
  StigmerFileReviewReconciledEventSchema,
  StigmerPermissionAskedEventSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import {
  RUNNER_EVENT_TYPES,
  SESSION_EVENT_TYPES,
  SESSION_STATUS_TYPES,
  eventCaseOf,
  eventIdOf,
  eventTypeOf,
  isStigmerEventType,
} from "../catalog.js";
import { draftOf, eventOf } from "../codec.js";
import {
  actionOfWord,
  actionWordOf,
  originWordOf,
  scopeOfWord,
  scopeWordOf,
} from "../../filereview/words.js";

describe("the catalog", () => {
  it("every oneof member declares a distinct dotted type", () => {
    expect(SESSION_EVENT_TYPES.length).toBe(SessionEventSchema.oneofs[0]!.fields.length);
    expect(new Set(SESSION_EVENT_TYPES).size).toBe(SESSION_EVENT_TYPES.length);
    for (const type of SESSION_EVENT_TYPES) {
      expect(type).toMatch(isStigmerEventType(type) ? /^stigmer(\.[a-z_]+){2}$/ : /^[a-z_]+\.[a-z_]+$/);
      expect(eventCaseOf(type)).toBeDefined();
    }
  });

  it("every Stigmer event but a file-review decision, a permission grant and a turn's status is the runner's to append", () => {
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
    ]);
    const serverOnly = ["stigmer.file_review.decided", "stigmer.permission.grant", "stigmer.run.status"];
    for (const type of own) {
      expect(RUNNER_EVENT_TYPES.has(type), type).toBe(!serverOnly.includes(type));
    }
  });

  it("a person's answers and stop are the server's to write, never a runner's", () => {
    for (const type of ["user.tool_confirmation", "user.interrupt", "user.message"]) {
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

  it("an event without one has no type, and no id", () => {
    const empty = create(SessionEventSchema, {});
    expect(() => eventTypeOf(empty)).toThrow();
    expect(eventIdOf(empty)).toBe("");
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
    for (const value of ApprovalPolicySourceSchema.values) {
      expect(ask(value.number === 0 ? "" : value.localName.toLowerCase())).toBe("valid");
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

  it("every scope, action and origin a decision carries has a word its event admits, read back to the same value", () => {
    for (const value of FileDecisionScopeSchema.values) {
      const word = scopeWordOf(value.number);
      expect(word === undefined, value.name).toBe(value.number === 0);
      if (word !== undefined) {
        expect(decided({ scope: word }), value.name).toBe("valid");
        expect(scopeOfWord(word)).toBe(value.number);
      }
    }
    for (const value of FileDecisionActionSchema.values) {
      const word = actionWordOf(value.number);
      expect(word === undefined, value.name).toBe(value.number === 0);
      if (word !== undefined) {
        expect(decided({ action: word }), value.name).toBe("valid");
        expect(actionOfWord(word)).toBe(value.number);
      }
    }
    for (const value of FileDecisionOriginSchema.values) {
      const word = originWordOf(value.number);
      expect(word, value.name).toBeDefined();
      expect(decided({ origin: word ?? "" }), value.name).toBe("valid");
    }
  });

  it("a value newer than this binary (a later binary's write, during a roll) has no word", () => {
    const newer: number = 99;
    expect(scopeWordOf(newer)).toBeUndefined();
    expect(actionWordOf(newer)).toBeUndefined();
    expect(originWordOf(newer)).toBeUndefined();
  });

  it("refuses a ledger name in place of a word, and reads no value from one", () => {
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
