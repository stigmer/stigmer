/**
 * Which message a finished turn leads with, as its answer, and scores: the
 * message it closed on, when nothing the agent did came after it but its
 * thinking, notes and to-do updates. A turn that ended on a step, or on a
 * message the person sent mid-turn, closed on no answer: nothing leads,
 * nothing is scored, and its messages stay in time order under "How it got
 * there".
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

/** The keys a finished turn leads with: everything after the person's message, before "How it got there". */
function lead(items: readonly ThreadItem[]): string[] {
  return items.slice(1).filter((item) => item.kind !== "how-it-got-there").map((item) => item.key);
}

/** The message carrying the turn's scores, if any. */
function scored(items: readonly ThreadItem[]): string | undefined {
  const all = items.flatMap((item) => (item.kind === "how-it-got-there" ? item.items : [item]));
  return all.find((item) => item.kind === "message" && item.scoresRunId !== undefined)?.key;
}

function howKeys(items: readonly ThreadItem[]): string[] {
  return (items.find((item): item is HowItem => item.kind === "how-it-got-there")?.items ?? []).map((item) => item.key);
}

describe("buildThreadItems answer", () => {
  it("leads with nothing and scores nothing when the turn ended on a step", () => {
    const items = finished(said(R, 0, "Let me find where invoices round."), call("c1", "read_file"), call("c2", "grep"));

    expect(lead(items)).toEqual([]);
    expect(scored(items)).toBeUndefined();
    expect(howKeys(items)[0]).toBe(m(0));
  });

  it("leads with the last message when the turn closed on it", () => {
    const items = finished(said(R, 0, "Let me look."), call("c1", "read_file"), said(R, 1, "Invoices round in billing.ts."));

    expect(lead(items)).toEqual([m(1)]);
    expect(scored(items)).toBe(m(1));
    expect(howKeys(items)).toEqual([m(0), `${toolId(R, "c1")}-tc`]);
  });

  it("keeps the closing message the answer when only a to-do update, thinking or a note came after it", () => {
    const items = finished(
      call("c1", "read_file"),
      said(R, 0, "Done."),
      use(R, "t1", "write_todos", { todos: [{ content: "Fix it", status: "completed" }] }),
      result(R, "t1", "ok"),
      thought(R, 1, "wrapping up"),
      note(R, 2, "Context saved"),
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
  });
});
