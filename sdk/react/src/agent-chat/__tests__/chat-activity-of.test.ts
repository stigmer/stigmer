/**
 * Proves what the session view reports to an <AgentChat> frame
 * (../chat-activity-of.ts): a working turn as its working line's words,
 * whether it waits on the person, and when it started; an ended turn as
 * its run, its ending and the Files that run returned (no other run's);
 * a turn still without an ending, or no turn, as idle. Drawn over the
 * scenario catalogue's busy, approval and finished conversations.
 */
import { describe, it, expect } from "vitest";
import { SCENARIO_CLOCK, conversationOf, samples, scenarios } from "../../test";
import { chatActivityOf } from "../chat-activity-of";

const NOW = Date.parse(SCENARIO_CLOCK);

describe("chatActivityOf", () => {
  it("reports a working turn as its working line's words and its start", () => {
    expect(chatActivityOf(conversationOf(scenarios.busy).activeTurn!, undefined, [], NOW)).toEqual({
      kind: "working",
      phrase: "Running a command",
      waiting: false,
      startedAtMs: NOW - 90_000,
    });
  });

  it("reports a turn waiting on the person", () => {
    expect(chatActivityOf(conversationOf(scenarios.approval).activeTurn!, undefined, [], NOW)).toMatchObject({
      kind: "working",
      waiting: true,
    });
  });

  it("reports an ended turn with the Files its own run returned", () => {
    const finished = conversationOf(scenarios.finished);
    const last = finished.turns.at(-1)!;
    const otherRunFile = samples.outputFile("notes.md", { runId: "run_other" });
    expect(chatActivityOf(null, last, [...scenarios.finished.files, otherRunFile], NOW)).toEqual({
      kind: "ended",
      runId: last.runId,
      phase: "completed",
      filesMade: 2,
    });
  });

  it("reports idle before anything has run, and for a turn with no ending", () => {
    expect(chatActivityOf(null, undefined, [], NOW)).toEqual({ kind: "idle" });
    const unfinished = { ...conversationOf(scenarios.finished).turns.at(-1)!, ended: false };
    expect(chatActivityOf(null, unfinished, [], NOW)).toEqual({ kind: "idle" });
  });
});
