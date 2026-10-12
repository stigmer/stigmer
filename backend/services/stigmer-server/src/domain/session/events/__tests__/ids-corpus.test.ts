/**
 * The server's session event ids (../ids.ts) agree with the runner's: the
 * shared corpus apis/testdata/session-events/ids/vectors.json, which the
 * runner's ids-corpus test reads too, pins the tool use id each call id
 * derives. The run of a tool use id is the text before its first `.`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runIdOfToolUse, toolUseEventId } from "../ids.js";

interface IdVector {
  readonly name: string;
  readonly runId: string;
  readonly callId: string;
  readonly toolUseId: string;
}

const corpus = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../../../../../../apis/testdata/session-events/ids/vectors.json", import.meta.url)),
    "utf-8",
  ),
) as { vectors: IdVector[] };

describe("the session event id corpus, read by the server", () => {
  it("has vectors", () => {
    expect(corpus.vectors.length).toBeGreaterThan(0);
  });

  it.each(corpus.vectors)("$name", ({ runId, callId, toolUseId }) => {
    expect(toolUseEventId(runId, callId)).toBe(toolUseId);
    expect(runIdOfToolUse(toolUseId)).toBe(runId);
  });

  it("an id with no run part names no run", () => {
    expect(runIdOfToolUse("toolu_1")).toBe("");
    expect(runIdOfToolUse(".toolu_1")).toBe("");
  });
});
