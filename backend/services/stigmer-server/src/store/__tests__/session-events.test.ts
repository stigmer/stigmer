/**
 * Pins the driver-neutral rules of the session event log
 * (../session-events.ts) both drivers apply: a draft batch is refused
 * whole for an event with no id or type, or one id twice with other
 * bytes, and kept once when an id repeats with the same bytes; bytes
 * compare exactly; the accepted time never runs backwards in a session;
 * and a limit is a positive integer.
 */
import { describe, expect, it } from "vitest";

import {
  SessionEventConflictError,
  assertSessionEventLimit,
  dedupeSessionEventDrafts,
  sameBytes,
  sessionEventInstant,
} from "../session-events.js";
import type { SessionEventDraft } from "../session-events.js";

function draft(eventId: string, body: string, type = "agent.message"): SessionEventDraft {
  return { eventId, runId: "run_1", threadId: "", type, data: new TextEncoder().encode(body) };
}

describe("a draft batch", () => {
  it("keeps a repeated id with the same bytes once, in first order", () => {
    expect(dedupeSessionEventDrafts("s", [draft("a", "x"), draft("b", "y"), draft("a", "x")]).map((d) => d.eventId)).toEqual([
      "a",
      "b",
    ]);
  });

  it("refuses one id twice with other bytes", () => {
    expect(() => dedupeSessionEventDrafts("s", [draft("a", "x"), draft("a", "z")])).toThrow(SessionEventConflictError);
  });

  it("refuses an event with no id or no type", () => {
    expect(() => dedupeSessionEventDrafts("s", [draft("", "x")])).toThrow(/needs an id and a type/);
    expect(() => dedupeSessionEventDrafts("s", [draft("a", "x", "")])).toThrow(/needs an id and a type/);
  });
});

describe("the helpers", () => {
  it("compares bytes exactly, length and content", () => {
    expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(sameBytes(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });

  it("stamps fixed-width UTC milliseconds, never before the session's newest event", () => {
    const at = Date.parse("2026-10-11T09:30:00.123Z");
    expect(sessionEventInstant(at, undefined)).toBe("2026-10-11T09:30:00.123Z");
    expect(sessionEventInstant(at, "2026-10-11T09:31:00.000Z")).toBe("2026-10-11T09:31:00.000Z");
    expect(sessionEventInstant(at, "2026-10-11T09:29:00.000Z")).toBe("2026-10-11T09:30:00.123Z");
  });

  it("refuses a limit a caller cannot mean", () => {
    for (const limit of [0, -1, 1.5]) {
      expect(() => assertSessionEventLimit(limit)).toThrow();
    }
    expect(() => assertSessionEventLimit(1)).not.toThrow();
  });
});
