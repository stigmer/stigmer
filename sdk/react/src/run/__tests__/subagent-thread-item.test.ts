/**
 * buildThreadItems and subagents: a `task` call whose thread has opened in
 * the session's events (`ToolUse.thread`) becomes a subagent item carrying
 * the thread and its call, whether the subagent still works or finished,
 * and never also a tool row; a `task` call whose thread has not opened yet
 * renders as an ordinary row, so it is never invisible.
 */
import { describe, it, expect } from "vitest";
import { buildThreadItems, type ThreadItem } from "../MessageThread";
import { result, said, status, subagent, toolId, turnsOf, use, user } from "./__fixtures__/thread-events";

const R = "run_a";
const TASK = toolId(R, "task1");

function subagentItem(items: readonly ThreadItem[]) {
  return items.find((i): i is Extract<ThreadItem, { kind: "subagent" }> => i.kind === "subagent");
}

function groupedNames(items: readonly ThreadItem[]): string[] {
  return items.flatMap((i) => (i.kind === "tool-group" ? i.toolUses.map((tu) => tu.name) : []));
}

describe("buildThreadItems subagent correlation", () => {
  it("renders a working subagent as a subagent item while the parent runs", () => {
    const items = buildThreadItems(
      turnsOf(
        user(R, "Please delegate to the researcher."),
        status(R, "running"),
        said(R, 0, "Delegating to the researcher."),
        use(R, "task1", "task", { description: "Research renewable energy" }),
        subagent(R, "task1", { input: "Research renewable energy", items: [said(R, 0, "Looking", TASK)] }),
      ),
      [],
    );
    const item = subagentItem(items);

    expect(item?.key).toBe(`sa-${TASK}`);
    expect(item?.toolUse.id).toBe(TASK);
    expect(item?.thread.state).toBe("running");
    expect(item?.thread.items.map((i) => i.kind)).toEqual(["message"]);
    expect(groupedNames(items)).not.toContain("task");
  });

  it("renders a finished subagent as a subagent item", () => {
    const item = subagentItem(
      buildThreadItems(
        turnsOf(
          user(R, "go"),
          use(R, "task1", "task"),
          subagent(R, "task1", { finished: "completed", reply: "done" }),
          result(R, "task1", "done"),
          status(R, "completed"),
        ),
        [],
      ),
    );

    expect(item?.thread.state).toBe("completed");
    expect(item?.thread.reply).toBe("done");
  });

  it("renders a task call whose thread has not opened as a row, never invisible", () => {
    const items = buildThreadItems(turnsOf(user(R, "go"), status(R, "running"), use(R, "task1", "task")), []);

    expect(subagentItem(items)).toBeUndefined();
    expect(groupedNames(items)).toEqual(["task"]);
  });
});
