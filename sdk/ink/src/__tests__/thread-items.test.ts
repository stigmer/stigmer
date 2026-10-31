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
    expect(failed.at(-1)).toMatchObject({ kind: "phase", key: `${RUN_ID}-end`, settled: true });
  });

  it("settles a reply being written block by block: all but its last block, and a list just above it", () => {
    const items = itemsOf([writing(samples.turn({ phase: "running", reply: `${REPLY}\n\nMore` }))]);
    expect(shape(items)).toEqual(["message:settled", "reply-block:settled", "reply-block:settled", "reply-block:settled", "reply-block:live"]);
    expect(shape(itemsOf([writing(samples.turn({ phase: "running", reply: REPLY }))]))).toEqual([
      "message:settled",
      "reply-block:settled",
      "reply-block:live",
      "reply-block:live",
    ]);
    expect(items.filter((item) => item.kind === "reply-block").map((item) => item.kind === "reply-block" && item.first)).toEqual([true, false, false, false]);
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

  it("writes a list streamed in pieces whole, though a later piece joins it to an earlier one", () => {
    const text = "Steps:\n\n1. one\n\n2. two\n\n3. three\n\nDone.";
    let written: readonly ThreadItem[] = [];
    for (let end = 1; end <= text.length; end += 1) {
      const turn = writing(samples.turn({ phase: "running", reply: text.slice(0, end) }));
      const items = itemsOf([turn]);
      written = appendOnce(written, items.slice(0, settledPrefixLength(items)));
    }
    written = appendOnce(written, itemsOf([samples.turn({ phase: "running", reply: text })]));
    const blocks = written.flatMap((item) => (item.kind === "reply-block" ? [item.token.raw.trim()] : []));
    expect(blocks).toEqual(["Steps:", "1. one\n\n2. two\n\n3. three", "Done."]);
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

describe("the thread's items, by turn", () => {
  it("leaves out a reconcile turn and a turn with nothing in it, and keeps a turn that has items but no message", () => {
    const shown = samples.turn({ runId: "run_shown" });
    const reconcile = samples.turn({ runId: "run_undo" });
    // Failed, so it would leave a badge if it were drawn.
    const empty = { ...samples.turn({ runId: "run_empty", phase: "failed" }), userMessage: undefined, items: [] };
    const itemsOnly = { ...samples.turn({ runId: "run_items", reply: "Picked up." }), userMessage: undefined };
    const runs = [samples.run({ id: "run_undo" })];
    runs[0]!.spec!.reconcileFileReview = true;
    const items = itemsOf([shown, reconcile, empty, itemsOnly], { runs });
    expect(items.map((item) => item.key)).toEqual(["run_shown-spec", "run_shown.root.m0-b0", "run_items.root.m0-b0"]);
  });

  it("keys every item by what it is, so the history writes each once", () => {
    const taskId = `${RUN_ID}.tc-task`;
    const turn = turnOf([
      samples.userMessageEvent("Fix it", { processedAt: sampleInstant(0) }),
      samples.runStatusEvent("running", { processedAt: sampleInstant(0) }),
      ...samples.thinkingEvents("Weighing it."),
      samples.toolUseEvent("read_file", { path: "a.ts" }),
      samples.toolUseEvent("task", { description: "map it" }, { id: taskId }),
      ...threadEvents(taskId, { reply: "Found it." }),
      samples.agentMessageEvent("One.\n\nTwo."),
      ...reviewEvents([{ id: "a", path: "notes.md" }], [{ id: "d", action: "keep", fileChangeId: "a" }]),
      samples.runStatusEvent("completed", { processedAt: sampleInstant(5_000) }),
    ]);
    const asking = { ...samples.turn({ runId: "run_next", phase: "running", reply: "" }), asks: [{ ...samples.toolUse("execute"), state: "waiting" as const }] };
    const items = itemsOf([turn, asking], { queued: [{ id: "q1", text: "also", state: "waiting" }], pendingUserMessage: "and that" });
    expect(items.map((item) => item.key)).toEqual([
      `${RUN_ID}-spec`,
      `${RUN_ID}.root.t0`,
      `${RUN_ID}.tc-read_file-tc`,
      `sa-${taskId}`,
      `${RUN_ID}.root.m0-b0`,
      `${RUN_ID}.root.m0-b1`,
      `${RUN_ID}-frr-cs-1`,
      `${RUN_ID}-end`,
      "run_next-spec",
      `approval-${RUN_ID}.tc-execute`,
      "queued-q1",
      "pending-user-msg",
    ]);
    expect(items.at(7)).toMatchObject({ kind: "worked", text: "Worked for 5s" });
  });

  it("names the person's message by the turn's run when the log has none", () => {
    const run = samples.run({ id: "run_spec", message: "From the run" });
    const turn = { ...samples.turn({ runId: "run_spec", reply: "Done." }), userMessage: undefined };
    expect(itemsOf([turn], { runs: [run] })[0]).toMatchObject({ key: "run_spec-spec", message: { kind: "user", id: "run_spec.user", text: "From the run" } });
  });

  it("keeps a group live while any one of its calls runs, closing it before a subagent that follows", () => {
    const taskId = `${RUN_ID}.tc-task`;
    const turn = turnOf([
      ...samples.turnEvents({ phase: "running", reply: "", tools: [{ name: "read_file", input: { path: "a.ts" }, result: "ok" }, { name: "execute", input: { command: "npm test" } }] }),
      samples.toolUseEvent("task", { description: "map it" }, { id: taskId }),
      ...threadEvents(taskId, { reply: "Found it." }),
      samples.agentMessageEvent("Next.", { id: `${RUN_ID}.root.m1` }),
    ]);
    const items = itemsOf([turn]);
    expect(shape(items)).toEqual(["message:settled", "tool-group:live", "subagent:settled", "reply-block:settled"]);
    expect(items[1]).toMatchObject({ toolUses: [{ name: "read_file" }, { name: "execute" }] });
  });

  it("settles a note and a message the person sent mid-turn, and drops a thinking of only spaces", () => {
    const turn = turnOf([...samples.turnEvents({ phase: "running", reply: "" }), ...samples.thinkingEvents("   ")]);
    const note = { kind: "note" as const, id: "n1", text: "Context was compacted.", live: false, processedAt: "" };
    const sent = { kind: "user_message" as const, id: "u2", text: "only the tests", processedAt: "" };
    const withMore = { ...turn, items: [...turn.items, note, sent, { kind: "message" as const, id: "m9", text: "Ok.", live: false, processedAt: "" }] } as Turn;
    expect(shape(itemsOf([withMore]))).toEqual(["message:settled", "message:settled", "message:settled", "reply-block:settled"]);
    expect(itemsOf([withMore])[2]).toMatchObject({ key: "u2", message: { kind: "user", text: "only the tests" } });
  });

  it("draws no approvals when the thread answers none, and no record for a set with no files", () => {
    const turn = { ...samples.turn({ phase: "running", reply: "" }), asks: [{ ...samples.toolUse("execute"), state: "waiting" as const }] };
    expect(itemsOf([turn], { includeApprovals: false }).map((item) => item.kind)).toEqual(["message"]);
    const decided = turnOf([...samples.turnEvents({ reply: "" }), ...reviewEvents([{ id: "a", path: "notes.md" }], [{ id: "d", action: "keep", fileChangeId: "a" }])]);
    const noFiles = { ...decided, fileReview: decided.fileReview.map((set) => ({ ...set, files: [] })) };
    expect(itemsOf([noFiles]).map((item) => item.kind)).not.toContain("file-review-record");
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
  const line = (key: string): ThreadItem => ({ kind: "worked", text: key, key, settled: true });
  const a = line("a");
  const b = line("b");
  const c = line("c");

  it("grows only at its end, by key, writing nothing twice", () => {
    expect(appendOnce([a], [a, b, c])).toEqual([a, b, c]);
    // An item seen again, or out of place, is not written again.
    expect(appendOnce([a, b], [b, a, c])).toEqual([a, b, c]);
  });

  it("marks a file review's record written below what followed its turn as an earlier turn's", () => {
    const decided = turnOf([
      ...samples.turnEvents({ reply: "Edited." }),
      ...reviewEvents([{ id: "a", path: "notes.md" }], [{ id: "d", action: "keep", fileChangeId: "a" }]),
    ]);
    const record = itemsOf([decided]).find((item) => item.kind === "file-review-record")!;
    // Decided with its turn: written in place, as its turn's.
    expect(appendOnce([a], [a, record, b]).at(1)).toBe(record);
    // Decided once the next turn's message was written: below it, and says so.
    expect(appendOnce([a, b], [a, record, b]).at(-1)).toEqual({ ...record, earlier: true });
    expect(appendOnce([a, b], [a, b, record]).at(-1)).toBe(record);
    expect(appendOnce([], [record, a])).toEqual([record, a]);
    expect(appendOnce([], [record, a])[0]).toBe(record);
  });

  it("is the same list when nothing is new, so Ink's history does not change", () => {
    const written = [a, b];
    expect(appendOnce(written, [a])).toBe(written);
    expect(appendOnce(written, [])).toBe(written);
  });
});
