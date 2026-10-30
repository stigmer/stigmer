// Pins the terminal thread's split into history and live region
// (thread-items.ts): which items can no longer change, the settled prefix,
// and the history that only ever grows at its end, so <Static>, which prints
// by position, writes each item once and never moves one.
import { describe, expect, it } from "vitest";
import type { Turn } from "@stigmer/client";
import { samples, sampleInstant } from "@stigmer/react-sdk/test";
import { appendOnce, buildThreadItems, settledPrefixLength, type ThreadItem } from "../thread-items.js";
import { RUN_ID, reviewEvents, threadEvents, turnOf } from "./session-events.js";

const REPLY = "First paragraph.\n\n- one\n- two\n\nLast paragraph, still";

/** The items of `turns`, with approvals and records drawn. */
function itemsOf(turns: readonly Turn[], extra: Partial<Parameters<typeof buildThreadItems>[0]> = {}): ThreadItem[] {
  return buildThreadItems({ turns, runs: [], includeApprovals: true, includeFileReviewRecords: true, ...extra });
}

/** Each item as `kind:settled`, the shape the split reads. */
function shape(items: readonly ThreadItem[]): string[] {
  return items.map((item) => `${item.kind}:${item.settled ? "settled" : "live"}`);
}

/** The turn with its agent message still being written. */
function writing(turn: Turn): Turn {
  return { ...turn, items: turn.items.map((item) => (item.kind === "message" ? { ...item, live: true } : item)) };
}

describe("the thread's items", () => {
  it("settles every item of an ended turn, and ends it with how long it worked", () => {
    const turn = turnOf([
      samples.userMessageEvent("Fix it", { processedAt: sampleInstant(0) }),
      samples.runStatusEvent("running", { processedAt: sampleInstant(0) }),
      samples.agentMessageEvent(REPLY),
      samples.runStatusEvent("completed", { processedAt: sampleInstant(72_000) }),
    ]);
    const items = itemsOf([turn]);
    expect(shape(items)).toEqual(["message:settled", "reply-block:settled", "reply-block:settled", "reply-block:settled", "worked:settled"]);
    expect(items.at(-1)).toMatchObject({ kind: "worked", text: "Worked for 1m 12s" });
  });

  it("leaves no line for a completed turn under a second, and a badge for a failed one", () => {
    expect(itemsOf([samples.turn()]).map((item) => item.kind)).not.toContain("worked");
    const failed = itemsOf([samples.turn({ phase: "failed" })]);
    expect(failed.at(-1)).toMatchObject({ kind: "phase", settled: true });
  });

  it("settles a reply being written block by block: all but its last block", () => {
    const items = itemsOf([writing(samples.turn({ phase: "running", reply: REPLY }))]);
    expect(shape(items)).toEqual(["message:settled", "reply-block:settled", "reply-block:settled", "reply-block:live"]);
    expect(items.filter((item) => item.kind === "reply-block").map((item) => item.kind === "reply-block" && item.first)).toEqual([true, false, false]);
  });

  it("keeps a working turn's last tool group live, since the next call joins it, and settles one a reply follows", () => {
    const tools = [{ name: "read_file", input: { path: "a.ts" }, result: "ok" }];
    expect(shape(itemsOf([samples.turn({ phase: "running", tools, reply: "" })]))).toEqual(["message:settled", "tool-group:live"]);
    expect(shape(itemsOf([samples.turn({ phase: "running", tools, reply: "Done." })]))).toEqual([
      "message:settled",
      "tool-group:settled",
      "reply-block:settled",
    ]);
  });

  it("keeps a group with a call still running live, and everything after it", () => {
    const turn = samples.turn({ phase: "running", tools: [{ name: "execute", input: { command: "npm test" } }], reply: "Waiting on the tests." });
    const items = itemsOf([turn]);
    expect(shape(items)).toEqual(["message:settled", "tool-group:live", "reply-block:settled"]);
    expect(settledPrefixLength(items)).toBe(1);
  });

  it("keeps a running subagent live and settles a finished one", () => {
    const taskId = `${RUN_ID}.tc-task`;
    const running = turnOf([
      ...samples.turnEvents({ phase: "running", reply: "" }),
      samples.toolUseEvent("task", { description: "map it" }, { id: taskId }),
      ...threadEvents(taskId, { state: "running" }),
    ]);
    expect(shape(itemsOf([running])).at(-1)).toBe("subagent:live");
    const finished = turnOf([
      ...samples.turnEvents({ phase: "running", reply: "" }),
      samples.toolUseEvent("task", { description: "map it" }, { id: taskId }),
      ...threadEvents(taskId, { reply: "Found it." }),
      samples.agentMessageEvent("Next.", { id: `${RUN_ID}.root.m1` }),
    ]);
    expect(shape(itemsOf([finished]))).toContain("subagent:settled");
  });

  it("draws thinking while it streams and once it settled with text; a settled thinking with none draws nothing", () => {
    const events = [...samples.turnEvents({ phase: "running", reply: "" }), ...samples.thinkingEvents("Weighing the order of the lines.")];
    const turn = turnOf(events);
    const thinking = turn.items.find((item) => item.kind === "thinking")!;
    const live = { ...turn, items: turn.items.map((item) => (item === thinking ? { ...item, live: true } : item)) };
    expect(shape(itemsOf([live]))).toEqual(["message:settled", "message:live"]);
    expect(shape(itemsOf([turn]))).toEqual(["message:settled", "message:settled"]);
    const silent = { ...turn, items: turn.items.map((item) => (item === thinking ? { ...item, text: "" } : item)) };
    expect(shape(itemsOf([silent]))).toEqual(["message:settled"]);
  });

  it("never settles the tail: approvals, queued and pending messages", () => {
    const turn = samples.turn({ phase: "running", reply: "" });
    const asks = [{ ...samples.toolUse("execute"), state: "waiting" as const }];
    const items = itemsOf([{ ...turn, asks }], {
      queued: [{ id: "q1", text: "also this", state: "waiting" }],
      pendingUserMessage: "and that",
    });
    expect(shape(items).slice(1)).toEqual(["approval:live", "queued-message:live", "pending-message:live"]);
  });

  it("records a file review once every file is decided, never while one is undecided", () => {
    const events = samples.turnEvents({ reply: "Edited." });
    const undecided = turnOf([...events, ...reviewEvents([{ id: "a", path: "notes.md" }], [])]);
    expect(itemsOf([undecided]).map((item) => item.kind)).not.toContain("file-review-record");
    const decided = turnOf([...events, ...reviewEvents([{ id: "a", path: "notes.md" }], [{ id: "d", action: "keep", fileChangeId: "a" }])]);
    expect(itemsOf([decided]).find((item) => item.kind === "file-review-record")?.settled).toBe(true);
    expect(itemsOf([decided], { includeFileReviewRecords: false }).map((item) => item.kind)).not.toContain("file-review-record");
  });
});

describe("the settled prefix", () => {
  it("is every item up to the first that can still change", () => {
    expect(settledPrefixLength([])).toBe(0);
    expect(settledPrefixLength([{ settled: true }, { settled: true }])).toBe(2);
    expect(settledPrefixLength([{ settled: true }, { settled: false }, { settled: true }])).toBe(1);
    expect(settledPrefixLength([{ settled: false }])).toBe(0);
  });
});

describe("the history", () => {
  const a = { key: "a" };
  const b = { key: "b" };
  const c = { key: "c" };

  it("grows only at its end, by key, writing nothing twice", () => {
    expect(appendOnce([a], [a, b, c])).toEqual([a, b, c]);
    // An item seen again, or out of place, is not written again.
    expect(appendOnce([a, b], [b, a, c])).toEqual([a, b, c]);
  });

  it("is the same list when nothing is new, so Ink's history does not change", () => {
    const written = [a, b];
    expect(appendOnce(written, [a])).toBe(written);
    expect(appendOnce(written, [])).toBe(written);
  });
});
