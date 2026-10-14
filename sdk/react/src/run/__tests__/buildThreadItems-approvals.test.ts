/**
 * buildThreadItems and the tool uses that wait for a person: a waiting call
 * that renders as a row (in the turn, or nested in a subagent, or a `task`
 * call whose thread has not opened yet) shows its decision inline and gets
 * no bottom card; a waiting call with no row of its own (an internal to-do
 * call) gets the bottom backstop card; with approvals off none is emitted.
 * Also pins that a gated turn's thinking and tool rows render faithfully,
 * before and after the answer.
 */
import { describe, it, expect } from "vitest";
import { buildThreadItems, type ThreadItem } from "../MessageThread";
import {
  asked,
  confirmed,
  result,
  said,
  status,
  subagent,
  thought,
  toolId,
  turnsOf,
  use,
  user,
} from "./__fixtures__/thread-events";

const R = "run_a";

function approvalItems(items: readonly ThreadItem[]): ThreadItem[] {
  return items.filter((i) => i.kind === "approval-request");
}

function hasToolInGroup(items: readonly ThreadItem[], id: string): boolean {
  return items.some((i) => i.kind === "tool-group" && i.toolUses.some((tu) => tu.id === id));
}

describe("buildThreadItems — inline vs. bottom approval partition", () => {
  it("does NOT emit a bottom card for a waiting call rendered as a row", () => {
    const turns = turnsOf(user(R, "go"), status(R, "running"), use(R, "c1", "edit_file", {}, { ask: true }), asked(R, "c1"));

    const items = buildThreadItems(turns, [], { includeApprovals: true });

    expect(approvalItems(items)).toHaveLength(0);
    expect(hasToolInGroup(items, toolId(R, "c1"))).toBe(true);
  });

  it("emits a bottom card for a waiting call with no row of its own (an internal to-do call)", () => {
    const turns = turnsOf(user(R, "go"), status(R, "running"), use(R, "c1", "write_todos", {}, { ask: true }), asked(R, "c1"));

    const items = buildThreadItems(turns, [], { includeApprovals: true });

    const bottom = approvalItems(items);
    expect(bottom).toHaveLength(1);
    expect(bottom[0]!.kind === "approval-request" && bottom[0]!.toolUse.id).toBe(toolId(R, "c1"));
    expect(bottom[0]!.key).toBe(`approval-${toolId(R, "c1")}`);
  });

  it("renders a waiting `task` call as a row while its thread has not opened (its gate is inline)", () => {
    const turns = turnsOf(user(R, "go"), status(R, "running"), use(R, "task1", "task", { description: "dig" }, { ask: true }), asked(R, "task1"));

    const items = buildThreadItems(turns, [], { includeApprovals: true });

    expect(hasToolInGroup(items, toolId(R, "task1"))).toBe(true);
    expect(items.some((i) => i.kind === "subagent")).toBe(false);
    expect(approvalItems(items)).toHaveLength(0);
  });

  it("does NOT emit a bottom card for a waiting call nested in a subagent", () => {
    const threadId = toolId(R, "task1");
    const turns = turnsOf(
      user(R, "go"),
      status(R, "running"),
      use(R, "task1", "task", { description: "dig" }),
      subagent(R, "task1", { items: [use(R, "nested", "fetch", {}, { ask: true, threadId }), asked(R, "nested", { threadId })] }),
    );

    const items = buildThreadItems(turns, [], { includeApprovals: true });

    expect(items.some((i) => i.kind === "subagent")).toBe(true);
    expect(turns[0]!.asks.map((a) => a.id)).toEqual([toolId(R, "nested")]);
    expect(approvalItems(items)).toHaveLength(0);
  });

  it("does NOT emit a bottom card for a waiting call nested in a subagent's own subagent", () => {
    const outer = toolId(R, "task1");
    const inner = toolId(R, "task2");
    const turns = turnsOf(
      user(R, "go"),
      status(R, "running"),
      use(R, "task1", "task", { description: "dig" }),
      subagent(R, "task1", {
        items: [
          use(R, "task2", "task", { description: "dig deeper" }, { threadId: outer }),
          ...subagent(R, "task2", {
            items: [use(R, "deep", "fetch", {}, { ask: true, threadId: inner }), asked(R, "deep", { threadId: inner })],
          }),
        ],
      }),
    );

    const items = buildThreadItems(turns, [], { includeApprovals: true });

    expect(turns[0]!.asks.map((a) => a.id)).toEqual([toolId(R, "deep")]);
    expect(approvalItems(items)).toHaveLength(0);
  });

  it("emits no approval items at all when approvals are disabled", () => {
    const turns = turnsOf(user(R, "go"), status(R, "running"), use(R, "c1", "write_todos", {}, { ask: true }), asked(R, "c1"));

    expect(approvalItems(buildThreadItems(turns, []))).toHaveLength(0);
  });
});

describe("buildThreadItems — a gated turn renders faithfully", () => {
  it("renders the leading thinking and the waiting tool while the turn waits", () => {
    const turns = turnsOf(
      user(R, "Self-DM me"),
      status(R, "running"),
      thought(R, 0, "planning the self-DM"),
      use(R, "state", "getAppState", {}, { ask: true }),
      asked(R, "state"),
      status(R, "waiting"),
    );

    const items = buildThreadItems(turns, [], { includeApprovals: true });

    expect(items.some((i) => i.kind === "message" && i.message.kind === "thinking" && i.message.text === "planning the self-DM")).toBe(true);
    expect(hasToolInGroup(items, toolId(R, "state"))).toBe(true);
  });

  it("renders the thinking, the answered tool and the later tools after the answer", () => {
    const turns = turnsOf(
      user(R, "Self-DM me"),
      status(R, "running"),
      thought(R, 0, "planning the self-DM"),
      use(R, "state", "getAppState", {}, { ask: true }),
      asked(R, "state"),
      confirmed(R, "state", "allow"),
      result(R, "state", "ok"),
      said(R, 1, ""),
      use(R, "click", "click"),
      result(R, "click", "clicked"),
      said(R, 2, "Captured the app state and clicked the element."),
    );

    const items = buildThreadItems(turns, [], { includeApprovals: true });

    expect(items.some((i) => i.kind === "message" && i.message.kind === "thinking")).toBe(true);
    expect(hasToolInGroup(items, toolId(R, "state"))).toBe(true);
    expect(hasToolInGroup(items, toolId(R, "click"))).toBe(true);
    expect(items.some((i) => i.kind === "message" && i.message.text === "Captured the app state and clicked the element.")).toBe(true);
    expect(approvalItems(items)).toHaveLength(0);
  });
});
