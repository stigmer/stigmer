/**
 * Pins the ids the Claude engine is handed (`engine-session-id.ts`): each a
 * name-based (version 5) UUID of a platform id, so every turn of a session
 * resumes the same engine session on any runner and the transcript answers
 * "was this message taken" by identity, with nothing stored beside it.
 *
 * The goldens were computed outside this codebase (Python's `uuid.uuid5`
 * under the module's namespace), so a change to the namespace, the kind
 * prefixes or the byte layout fails here: any of those orphans every saved
 * engine session.
 */

import { describe, it, expect } from "vitest";

import { engineSessionIdOf, runMessageIdOf, sentMessageIdOf } from "../engine-session-id.js";

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("the engine's ids", () => {
  it("derives the session id from the thread id, matching an independent RFC 9562 version 5 computation", () => {
    expect(engineSessionIdOf("thr_1")).toBe("c07fede7-26ed-5f91-8733-ed591cb931f3");
    expect(engineSessionIdOf("")).toBe("fdf2e3a3-215c-5200-a8a8-90b4408d9f4b");
  });

  it("derives the run's opening message id from the execution id", () => {
    expect(runMessageIdOf("run_1")).toBe("f7bfedf6-1a52-5ae4-b771-22d80ccb0771");
  });

  it("derives a sent message's id from its user message id", () => {
    expect(sentMessageIdOf("umsg_1")).toBe("25711f78-fd66-5f59-be83-08e52d624353");
  });

  it("answers the same id for the same platform id every time", () => {
    expect(engineSessionIdOf("thr_same")).toBe(engineSessionIdOf("thr_same"));
    expect(runMessageIdOf("run_same")).toBe(runMessageIdOf("run_same"));
  });

  it("never collides across kinds for the same platform id", () => {
    const ids = new Set([engineSessionIdOf("x"), runMessageIdOf("x"), sentMessageIdOf("x")]);
    expect(ids.size).toBe(3);
  });

  it("answers a well-formed version 5 UUID with the RFC variant bits", () => {
    for (const id of [engineSessionIdOf("a"), runMessageIdOf("b"), sentMessageIdOf("c"), engineSessionIdOf("ünïcødé")]) {
      expect(id).toMatch(UUID_V5);
    }
  });
});
