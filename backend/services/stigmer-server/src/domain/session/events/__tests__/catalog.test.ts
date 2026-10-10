/**
 * Pins the catalog (../catalog.ts) and the codec (../codec.ts): every event
 * the contract carries declares its Managed Agents type once, on its oneof
 * member; a runner's types are a subset that leaves the user's turn and
 * the session's status to the server; and a draft's bytes carry no seq,
 * session or accepted time, so a resent event encodes to the stored bytes.
 */
import { create, equals } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { SessionEventSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import { RUNNER_EVENT_TYPES, SESSION_EVENT_TYPES, SESSION_STATUS_TYPES, eventCaseOf, eventIdOf, eventTypeOf } from "../catalog.js";
import { draftOf, eventOf } from "../codec.js";

describe("the catalog", () => {
  it("every oneof member declares a distinct dotted type", () => {
    expect(SESSION_EVENT_TYPES.length).toBe(SessionEventSchema.oneofs[0]!.fields.length);
    expect(new Set(SESSION_EVENT_TYPES).size).toBe(SESSION_EVENT_TYPES.length);
    for (const type of SESSION_EVENT_TYPES) {
      expect(type).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(eventCaseOf(type)).toBeDefined();
    }
  });

  it("a runner appends only landed types, never the user's turn or the session's status", () => {
    for (const type of RUNNER_EVENT_TYPES) {
      expect(SESSION_EVENT_TYPES).toContain(type);
    }
    for (const type of ["user.message", ...SESSION_STATUS_TYPES]) {
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
