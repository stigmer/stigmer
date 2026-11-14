// Pins SubagentSection over a subagent's folded thread: a helper drawn as a
// step (the step row's shell, its subject as the line, its agent's name as a
// tag, "Helper" without one, no opacity modifiers, its messages at the body's
// padding); disclosure (open while it runs or one of its calls waits for a
// person, at any depth; settled closed, opening on a click); a pill only when
// it failed (its reply as the error) or stopped, never Running or Completed;
// the running counter and the static duration; the flat layout as the work
// alone, with no header of its own; and its items as rows: messages, thinking
// and notes on their own, runs of tool calls as groups, internal to-do calls
// and compactions left out.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import type { MessageItem, NoteItem, ThinkingItem, Thread, TurnItem } from "@stigmer/client";
import { SubagentSection } from "../SubagentSection";
import { subagentSubjectOf } from "@stigmer/react-core";
import { ApprovalContext, type ApprovalContextValue } from "../ApprovalContext";
import { thread, toolUse } from "./__fixtures__/fold-values";
import { tagClasses } from "../../internal/surface/Tag";

afterEach(cleanup);

const answering: ApprovalContextValue = {
  onAnswer: () => {},
  submittingIds: new Set(),
  errorsByToolUseId: new Map(),
};

function message(id: string, text: string): MessageItem {
  return { kind: "message", id, text, live: false, processedAt: "" };
}

/** The card's own toggle is the first step-row toggle under its role=group. */
function sectionExpanded(container: HTMLElement): boolean {
  const toggle = container.querySelector('[role="group"] [data-cursor-target="thread-card-toggle"]');
  return toggle?.getAttribute("aria-expanded") === "true";
}

function waitingCall(id: string) {
  return toolUse({ id, name: "delete_file", ask: { argsPreview: '{"path":"/tmp/x"}' } });
}

// A helper reads as a step: the step row's shell, its subject as the line,
// its agent's name as a neutral tag, its time on the right, and a pill only
// when it failed or stopped (a running or finished helper says nothing).
describe("SubagentSection as a step", () => {
  it("shows a running helper's subject, its agent's name as a tag, and no Running pill", () => {
    const { container } = render(
      <SubagentSection thread={thread({ state: "running", agentName: "researcher" })} subject="Find the rounding code" />,
    );
    expect(screen.getByText("Find the rounding code")).toBeTruthy();
    expect(screen.getByText("researcher").className).toBe(tagClasses());
    expect(screen.queryByText("Running")).toBeNull();
    expect(sectionExpanded(container), "open while it runs").toBe(true);
  });

  it("tags a helper with no name of its own as Helper", () => {
    render(<SubagentSection thread={thread({ state: "running", agentName: "" })} subject="Find the rounding code" />);
    expect(screen.getByText("Helper").className).toBe(tagClasses());
  });

  it("shows a finished helper closed, with no Completed pill, and opens on a click", () => {
    const { container } = render(
      <SubagentSection thread={thread({ state: "completed", input: "Look in billing" })} subject="Find the rounding code" />,
    );
    expect(screen.queryByText("Completed")).toBeNull();
    expect(sectionExpanded(container)).toBe(false);
    expect(container.textContent).not.toContain("Look in billing");
    fireEvent.click(container.querySelector('[data-cursor-target="thread-card-toggle"]')!);
    expect(container.textContent).toContain("Look in billing");
  });

  it.each([
    ["failed", "Failed"],
    ["stopped", "Stopped"],
  ] as const)("shows a %s helper's pill", (state, label) => {
    render(<SubagentSection thread={thread({ state })} subject="Find the rounding code" />);
    expect(screen.getByText(label).className).toContain("stg:rounded-full");
  });

  it("draws on the step row's shell with no opacity modifiers, its own steps at the body's padding", () => {
    const { container } = render(
      <SubagentSection thread={thread({ state: "running", input: "Look in billing", items: [message("m1", "Looking.")] })} subject="Find it" />,
    );
    expect(container.querySelector('[data-cursor-target="subagent-row"]')?.className).toContain("stg:border-border-prominent");
    const classes = Array.from(container.querySelectorAll("[class]")).flatMap((el) => (el.getAttribute("class") ?? "").split(" "));
    expect(classes.filter((c) => /\/\d+$/.test(c)), "no opacity modifiers").toEqual([]);
    expect(screen.getByRole("article", { name: "AI response" }).className).not.toContain("stg:px-4");
  });
});

describe("SubagentSection auto-disclosure", () => {
  it("auto-opens while the subagent is running", () => {
    const { container } = render(<SubagentSection thread={thread({ state: "running" })} />);
    expect(sectionExpanded(container)).toBe(true);
  });

  it("stays collapsed when the subagent has settled", () => {
    const { container } = render(<SubagentSection thread={thread({ state: "completed" })} />);
    expect(sectionExpanded(container)).toBe(false);
  });

  it("auto-opens a settled subagent when a nested call waits for a person, and shows the gate inline", () => {
    const { container } = render(
      <ApprovalContext.Provider value={answering}>
        <SubagentSection thread={thread({ state: "completed", items: [waitingCall("tc-nested")] })} />
      </ApprovalContext.Provider>,
    );

    expect(sectionExpanded(container)).toBe(true);
    // The nested gate's actions surface inside the subagent section.
    expect(screen.getByLabelText("Allow")).toBeTruthy();
  });

  it("opens for a call waiting in a subagent the subagent started", () => {
    const nested = toolUse({
      id: "tc-task",
      name: "task",
      thread: thread({ id: "inner", state: "completed", items: [waitingCall("tc-deep")] }),
      result: "",
    });
    const { container } = render(
      <SubagentSection thread={thread({ state: "completed", items: [nested] })} />,
    );
    expect(sectionExpanded(container)).toBe(true);
  });
});

describe("SubagentSection header", () => {
  it("titles the card with the task's subject, and the agent's name without one", () => {
    const titled = render(<SubagentSection thread={thread({ state: "completed" })} subject="Survey the docs" />);
    expect(titled.getByRole("group").getAttribute("aria-label")).toBe("Subagent: Survey the docs, Completed");
    cleanup();

    const bare = render(<SubagentSection thread={thread({ state: "completed", agentName: "researcher" })} />);
    expect(bare.getByRole("group").getAttribute("aria-label")).toBe("Subagent: researcher, Completed");
  });

  it("labels a stopped subagent Stopped", () => {
    render(<SubagentSection thread={thread({ state: "stopped" })} />);
    expect(screen.getByText("Stopped")).toBeTruthy();
  });

  it("shows a failed subagent's reply as its error once opened", () => {
    const { container } = render(
      <SubagentSection thread={thread({ state: "failed", reply: "the tool crashed" })} />,
    );
    expect(screen.getByText("Failed")).toBeTruthy();
    fireEvent.click(container.querySelector('[data-cursor-target="thread-card-toggle"]')!);
    expect(screen.getByText("the tool crashed")).toBeTruthy();
  });

  it("never shows a completed subagent's reply as an error", () => {
    render(
      <SubagentSection thread={thread({ state: "completed", reply: "all done" })} collapsible={false} />,
    );
    expect(screen.queryByText("all done")).toBeNull();
  });

  it("reads the subject from a task call's description", () => {
    expect(subagentSubjectOf(toolUse({ name: "task", input: { description: "Find the bug" } }))).toBe("Find the bug");
    expect(subagentSubjectOf(toolUse({ name: "task", input: { description: 3 } }))).toBe("");
    expect(subagentSubjectOf(toolUse({ name: "task" }))).toBe("");
  });
});

describe("SubagentSection flat layout and items", () => {
  function renderFlat(t: Thread, subject?: string) {
    return render(<SubagentSection thread={t} subject={subject} collapsible={false} />);
  }

  it("renders the input and every item kind as rows, with no header of its own", () => {
    const thinking: ThinkingItem = { kind: "thinking", id: "t1", text: "weighing", live: false, processedAt: "" };
    const note: NoteItem = { kind: "note", id: "n1", text: "tools are off", processedAt: "" };
    const items: TurnItem[] = [
      message("m1", "Looking around."),
      thinking,
      toolUse({ id: "r1", name: "Bash", input: { command: "ls" }, result: "a.ts" }),
      toolUse({ id: "todo", name: "write_todos", input: { todos: [] }, result: "ok" }),
      { kind: "compacted", id: "c1", processedAt: "" },
      note,
      message("m2", "Found it."),
    ];
    const { container } = renderFlat(
      thread({ agentName: "researcher", input: "Find the config", state: "completed", items }),
      "Locate config",
    );
    const text = container.textContent ?? "";
    // The parent row draws the helper's header; the flat form is the work.
    expect(text).not.toContain("researcher");
    expect(text).not.toContain("Locate config");
    expect(text).toContain("Find the config");
    expect(text).toContain("Looking around.");
    expect(text).toContain("tools are off");
    expect(text).toContain("Found it.");
    // The shell call renders as a row; the internal to-do call does not.
    const rows = container.querySelectorAll('[data-cursor-target="tool-call-row"]');
    expect(rows).toHaveLength(1);
    expect(screen.queryByText("Context compacted")).toBeNull();
    expect(screen.getByLabelText("Model thinking")).toBeTruthy();
  });

  it("groups consecutive tool calls into one group and splits them at a message", () => {
    const items: TurnItem[] = [
      toolUse({ id: "s1", name: "Bash", input: { command: "ls" }, result: "x" }),
      toolUse({ id: "s2", name: "Bash", input: { command: "pwd" }, result: "y" }),
      message("m1", "Between."),
      toolUse({ id: "s3", name: "Bash", input: { command: "date" }, result: "z" }),
    ];
    const { container } = renderFlat(thread({ state: "completed", items }));
    const groups = container.querySelectorAll('[data-cursor-target="tool-call-group"]');
    expect(groups).toHaveLength(2);
    expect(groups[0]!.querySelectorAll('[data-cursor-target="tool-call-row"]')).toHaveLength(2);
  });
});

// A subagent whose engine reports its work only when its task call returns
// streams nothing mid-run, so the running card's honest live signal is a
// ticking counter from its start. Completed cards keep the precise static
// duration (start -> finish), not a counter.
describe("SubagentSection running duration", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a ticking elapsed time while running", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T12:00:42Z"));

    render(<SubagentSection thread={thread({ state: "running" })} startedAt="2026-07-02T12:00:00Z" />);

    expect(screen.getByText("42s")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByText("1m 02s")).toBeTruthy();
  });

  it("shows no counter while running when the start is unknown", () => {
    render(<SubagentSection thread={thread({ state: "running" })} />);
    expect(screen.queryByText(/^\d+s$/)).toBeNull();
  });

  it("shows the static duration (not a counter) once completed", () => {
    render(
      <SubagentSection
        thread={thread({ state: "completed" })}
        startedAt="2026-07-02T12:00:00Z"
        completedAt="2026-07-02T12:01:14.500Z"
      />,
    );
    // A completed 74.5s run, in whole seconds in the one duration format.
    expect(screen.getByText("1m 14s")).toBeTruthy();
  });
});
