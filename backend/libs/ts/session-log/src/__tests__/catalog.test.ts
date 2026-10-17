/**
 * Pins the catalog (../catalog.ts): every event the contract carries
 * declares one distinct dotted Managed Agents type on its oneof member,
 * read back to its case; Stigmer's own types are `stigmer.<area>.<action>`;
 * an event that holds nothing has no type, id or time.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { SessionEventSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import { SESSION_EVENT_TYPES, eventCaseOf, eventIdOf, eventTypeOf, isStigmerEventType, processedAtOf } from "../catalog.js";

describe("the catalog", () => {
  it("every oneof member declares a distinct dotted type", () => {
    expect(SESSION_EVENT_TYPES.length).toBe(SessionEventSchema.oneofs[0]!.fields.length);
    expect(new Set(SESSION_EVENT_TYPES).size).toBe(SESSION_EVENT_TYPES.length);
    for (const type of SESSION_EVENT_TYPES) {
      expect(type).toMatch(isStigmerEventType(type) ? /^stigmer(\.[a-z_]+){2}$/ : /^[a-z_]+\.[a-z_]+$/);
      expect(eventCaseOf(type)).toBeDefined();
    }
    expect(eventCaseOf("not.a_type")).toBeUndefined();
  });

  it("reads an event's type, id and time", () => {
    const event = create(SessionEventSchema, {
      event: { case: "stigmerRunStatus", value: { id: "e1", phase: "running", processedAt: "2026-10-13T00:00:00Z" } },
    });
    expect([eventTypeOf(event), eventIdOf(event), processedAtOf(event)]).toEqual(["stigmer.run.status", "e1", "2026-10-13T00:00:00Z"]);
  });

  it("an event without one has no type, and no id or time", () => {
    const empty = create(SessionEventSchema, {});
    expect(() => eventTypeOf(empty)).toThrow(/must hold an event/);
    expect(eventIdOf(empty)).toBe("");
    expect(processedAtOf(empty)).toBe("");
  });
});
