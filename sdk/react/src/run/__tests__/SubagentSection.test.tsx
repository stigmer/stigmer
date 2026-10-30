// Pins SubagentSection over a subagent's folded thread: disclosure (open
// while it runs or one of its calls waits for a person, at any depth;
// settled closed), its title (the task's subject, else the agent's name),
// its status badges (running, completed, failed with the reply as error,
// stopped), the running counter and the static duration, the flat layout
// with a completed subagent's icon in the ready colour the theme contract
// measures as text, and its items as rows: messages, thinking and notes on
// their own, runs of tool calls as groups, internal to-do calls and
// compactions left out.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import type { MessageItem, NoteItem, ThinkingItem, Thread, TurnItem } from "@stigmer/client";
import { SubagentSection } from "../SubagentSection";
import { subagentSubjectOf } from "@stigmer/react-core";
import { ApprovalContext, type ApprovalContextValue } from "../ApprovalContext";
import { thread, toolUse } from "./__fixtures__/fold-values";

afterEach(cleanup);

const answering: ApprovalContextValue = {
  onAnswer: () => {},
  submittingIds: new Set(),
  errorsByToolUseId: new Map(),
};

function message(id: string, text: string): MessageItem {
  return { kind: "message", id, text, live: false, processedAt: "" };
}

/** The CollapsibleCard's own toggle is the first button under its role=group. */
function sectionExpanded(container: HTMLElement): boolean {
  const toggle = container.querySelector('[role="group"] > button');
  return toggle?.getAttribute("aria-expanded") === "true";
}

function waitingCall(id: string) {
  return toolUse({ id, name: "delete_file", ask: { argsPreview: '{"path":"/tmp/x"}' } });
}

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
    expect(screen.getByLabelText("Approve")).toBeTruthy();
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
    fireEvent.click(container.querySelector('[role="group"] > button')!);
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

  it("renders the name, subject, input and every item kind as rows", () => {
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
    expect(text).toContain("researcher");
    expect(text).toContain("Locate config");
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

  it("draws a completed subagent's header icon in the measured ready colour", () => {
    const { container } = renderFlat(thread({ state: "completed" }));
    const icon = container.querySelector("span[aria-hidden='true']") as HTMLElement;
    expect(icon.className.split(" ")).toContain("stg:text-status-ready");
  });

  it("shows the static duration in the flat header once finished", () => {
    render(
      <SubagentSection
        thread={thread({ state: "completed" })}
        startedAt="2026-07-02T12:00:00Z"
        completedAt="2026-07-02T12:00:05Z"
        collapsible={false}
      />,
    );
    expect(screen.getByText("5.0s")).toBeTruthy();
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
    expect(screen.getByText("1m 2s")).toBeTruthy();
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
    // formatDuration's m/s rendering for a completed 74.5s run.
    expect(screen.getByText("1m 15s")).toBeTruthy();
  });
});
