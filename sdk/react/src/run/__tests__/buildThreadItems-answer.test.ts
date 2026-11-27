/**
 * Which message a finished turn leads with, as its answer, and scores: the
 * message it closed on, when nothing the agent did came after it but its
 * thinking, notes and to-do updates. A turn that ended on a step, or on a
 * message the person sent mid-turn, closed on no answer: nothing leads, no
 * message carries the scores, its messages stay in time order under "How
 * it got there", and the run's scores sit at the turn's foot. A turn that
 * wrote no message (it only ran steps) carries them at its foot too
 * (stigmer/stigmer#3299). A thread that shows no scores carries no such row.
 */
import { describe, it, expect } from "vitest";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { buildThreadItems, type ThreadItem } from "../MessageThread";
import { ev, note, result, said, status, thought, toolId, turnsOf, use, user } from "./__fixtures__/thread-events";

const R = "run_a";

type HowItem = Extract<ThreadItem, { kind: "how-it-got-there" }>;

const m = (index: number) => `${R}.root.m${index}`;

/** A call that returned. */
function call(id: string, name: string): SessionEvent[] {
  return [use(R, id, name, { path: "a.ts" }), result(R, id, "ok")];
}

/** A finished turn of `events`, built into thread items. */
function finished(...events: ReadonlyArray<SessionEvent | readonly SessionEvent[]>): ThreadItem[] {
  return buildThreadItems(turnsOf(user(R, "go"), status(R, "running"), ...events, status(R, "completed")), [], { includeLiveness: false });
}

/** The keys a finished turn leads with: everything after the person's message, before "How it got there" and the scores row. */
function lead(items: readonly ThreadItem[]): string[] {
  return items.slice(1).filter((item) => item.kind !== "how-it-got-there" && item.kind !== "turn-scores").map((item) => item.key);
}

/** The run whose scores sit at the turn's foot, if any. */
function footScores(items: readonly ThreadItem[]): string | undefined {
  const last = items.at(-1);
  return last?.kind === "turn-scores" ? last.runId : undefined;
}

/** The message carrying the turn's scores, if any. */
function scored(items: readonly ThreadItem[]): string | undefined {
  const all = items.flatMap((item) => (item.kind === "how-it-got-there" ? item.items : [item]));
  return all.find((item) => item.kind === "message" && item.isFinalAnswer === true)?.key;
}

function howKeys(items: readonly ThreadItem[]): string[] {
  return (items.find((item): item is HowItem => item.kind === "how-it-got-there")?.items ?? []).map((item) => item.key);
}

describe("buildThreadItems answer", () => {
  it("leads with nothing when the turn ended on a step, its scores at its foot", () => {
    const items = finished(said(R, 0, "Let me find where invoices round."), call("c1", "read_file"), call("c2", "grep"));

    expect(lead(items)).toEqual([]);
    expect(scored(items)).toBeUndefined();
    expect(howKeys(items)[0]).toBe(m(0));
    expect(footScores(items)).toBe(R);
    expect(items.filter((item) => item.kind === "turn-scores")).toHaveLength(1);
  });

  it("leads with nothing when Stigmer stopped the turn: its last message was never an answer, and the scores move to its foot", () => {
    const items = buildThreadItems(
      turnsOf(user(R, "go"), status(R, "running"), said(R, 0, "Looking."), call("c1", "read_file"), said(R, 1, "Halfway there."), status(R, "completed", { stopCause: "platform_stop" })),
      [],
      { includeLiveness: false },
    );

    expect(scored(items)).toBeUndefined();
    expect(items.some((item) => item.kind === "how-it-got-there")).toBe(false);
    expect(items.filter((item) => item.kind === "turn-scores").map((item) => (item.kind === "turn-scores" ? item.runId : ""))).toEqual([R]);
  });

  it("stamps every agent message with its run, and only the final answer as final", () => {
    const items = finished(said(R, 0, "Let me look."), call("c1", "read_file"), said(R, 1, "Invoices round in billing.ts."));
    const all = items.flatMap((item) => (item.kind === "how-it-got-there" ? item.items : [item]));
    const messages = all.filter((item): item is Extract<ThreadItem, { kind: "message" }> => item.kind === "message" && item.message.kind === "message");

    expect(messages.map((item) => [item.key, item.runId, item.isFinalAnswer === true, item.takesActions === true])).toEqual([
      [m(1), R, true, true],
      [m(0), R, false, true],
    ]);
  });

  it("carries no scores row when the turn closed on its answer", () => {
    expect(footScores(finished(call("c1", "read_file"), said(R, 0, "Done.")))).toBeUndefined();
  });

  it("carries the scores at its foot, once, when the turn ran steps and wrote no message", () => {
    const items = finished(call("c1", "read_file"), call("c2", "grep"), call("c3", "shell"));

    expect(scored(items)).toBeUndefined();
    expect(footScores(items)).toBe(R);
    expect(items.filter((item) => item.kind === "turn-scores")).toHaveLength(1);
  });

  it("puts the scores at the very foot of a stopped turn: after its ending note and its outcome", () => {
    const stopped = (...events: Array<SessionEvent | readonly SessionEvent[]>) =>
      buildThreadItems(
        turnsOf(user(R, "go"), status(R, "running"), ...events, status(R, "completed", { stopCause: "platform_stop" })),
        [],
        { includeLiveness: false, includeOutcomes: true },
      );

    for (const items of [stopped(call("c1", "read_file")), stopped(said(R, 0, "Looking."), call("c1", "read_file"))]) {
      const kinds = items.map((item) => item.kind);
      expect(kinds.at(-1)).toBe("turn-scores");
      expect(kinds.indexOf("execution-error")).toBeLessThan(kinds.indexOf("turn-scores"));
      expect(kinds.indexOf("outcome")).toBeLessThan(kinds.indexOf("turn-scores"));
    }
  });

  it("puts an earlier turn's scores after its outcome too", () => {
    const S = "run_b";
    const items = buildThreadItems(
      turnsOf(
        user(R, "go"), status(R, "running"), ...call("c1", "read_file"), status(R, "completed", { stopCause: "platform_stop" }),
        user(S, "again"), status(S, "running"), said(S, 0, "Done."), status(S, "completed"),
      ),
      [],
      { includeLiveness: false, includeOutcomes: true },
    );
    const keys = items.map((item) => item.key);

    expect(keys.indexOf(`outcome-${R}`)).toBeGreaterThan(-1);
    expect(keys.indexOf(`${R}-scores`)).toBe(keys.indexOf(`outcome-${R}`) + 1);
  });

  it("carries no scores row in a thread that shows no scores, so no empty row takes space", () => {
    const events = turnsOf(user(R, "go"), status(R, "running"), ...call("c1", "read_file"), said(R, 0, "Looking."), ...call("c2", "grep"), status(R, "completed"));
    const items = buildThreadItems(events, [], { includeLiveness: false, includeScores: false });

    expect(items.some((item) => item.kind === "turn-scores")).toBe(false);
    expect(footScores(buildThreadItems(events, [], { includeLiveness: false }))).toBe(R);
  });

  it("leads with the last message when the turn closed on it", () => {
    const items = finished(said(R, 0, "Let me look."), call("c1", "read_file"), said(R, 1, "Invoices round in billing.ts."));

    expect(lead(items)).toEqual([m(1)]);
    expect(scored(items)).toBe(m(1));
    expect(howKeys(items)).toEqual([m(0), `${toolId(R, "c1")}-tc`]);
  });

  it("keeps the closing message the answer when only a to-do update, thinking, a note or an empty message came after it", () => {
    const items = finished(
      call("c1", "read_file"),
      said(R, 0, "Done."),
      use(R, "t1", "write_todos", { todos: [{ content: "Fix it", status: "completed" }] }),
      result(R, "t1", "ok"),
      thought(R, 1, "wrapping up"),
      note(R, 2, "Context saved"),
      said(R, 3, ""),
    );

    expect(lead(items)[0]).toBe(m(0));
    expect(scored(items)).toBe(m(0));
  });

  it("leads with nothing when the turn ended on a message the person sent mid-turn", () => {
    const items = finished(
      said(R, 0, "Working on it."),
      ev(R, { case: "userMessage", value: { id: `${R}.mid`, content: [{ type: "text", text: "also check tax" }], processedAt: "t" } }),
    );

    expect(lead(items)).toEqual([]);
    expect(scored(items)).toBeUndefined();
    expect(footScores(items)).toBe(R);
  });
});
