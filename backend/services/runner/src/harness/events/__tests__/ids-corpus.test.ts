/**
 * Cross-reader session event id parity.
 *
 * Loads the shared corpus (apis/testdata/session-events/ids/vectors.json)
 * and asserts the runner's {@link toolUseEventId} agrees with every vector:
 * the id a reader that answers a tool use derives from the call id it
 * holds is the id the runner wrote. Also pins that every derived id fits
 * the contract's pattern with each suffix appended.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  EVENT_ID_PATTERN,
  permissionAskedEventId,
  scopeEventPrefix,
  thinkingEventId,
  thinkingTextEventId,
  threadEventId,
  threadId,
  toolResultEventId,
  toolUseEventId,
} from "../ids.js";

interface IdVector {
  readonly name: string;
  readonly runId: string;
  readonly callId: string;
  readonly toolUseId: string;
}

const vectorsPath = fileURLToPath(
  new URL("../../../../../../../apis/testdata/session-events/ids/vectors.json", import.meta.url),
);
const corpus = JSON.parse(readFileSync(vectorsPath, "utf-8")) as { vectors: IdVector[] };

describe("session event id vector corpus", () => {
  it("has vectors", () => {
    expect(corpus.vectors.length).toBeGreaterThan(0);
  });

  it.each(corpus.vectors)("$name", ({ runId, callId, toolUseId }) => {
    expect(toolUseEventId(runId, callId)).toBe(toolUseId);
  });

  it.each(corpus.vectors)("$name: every derived id fits the contract's pattern", ({ runId, callId }) => {
    const use = toolUseEventId(runId, callId);
    const scope = scopeEventPrefix(runId, callId);
    const thread = threadId(runId, callId);
    for (const id of [
      use,
      toolResultEventId(use),
      permissionAskedEventId(use),
      thinkingTextEventId(thinkingEventId(scope, 99_999)),
      threadEventId(thread, "received"),
    ]) {
      expect(id).toMatch(EVENT_ID_PATTERN);
    }
  });
});
