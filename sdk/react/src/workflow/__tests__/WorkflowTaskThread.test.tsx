// Behavior tests for the WorkflowTaskThread organism (S8): progress header,
// per-variant card previews, the select and expand gestures, the AGENT_CALL
// transcript affordance (D-T02-2), and empty states (DD-006).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";
import { WorkflowTaskThread } from "../thread/WorkflowTaskThread";

beforeEach(() => {
  // useAutoScroll depends on browser APIs absent in happy-dom.
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function taskState(overrides: Partial<DerivedTaskState> & { taskName: string }): DerivedTaskState {
  return {
    taskKind: WorkflowTaskKind.http_call,
    status: "completed",
    durationMs: 1_500,
    costMicros: 0n,
    tokensUsed: 0n,
    attemptNumber: 1,
    error: "",
    childExecutionId: "",
    agentSlug: "",
    currentToolName: "",
    messagesCount: 0,
    toolCallsCount: 0,
    ...overrides,
  };
}

function statesOf(...states: DerivedTaskState[]): ReadonlyMap<string, DerivedTaskState> {
  return new Map(states.map((s) => [s.taskName, s]));
}

describe("WorkflowTaskThread", () => {
  it("renders the streaming empty state while running with no tasks yet", () => {
    render(
      <WorkflowTaskThread
        taskStates={new Map()}
        totalTasks={0}
        isRunning
        selectedTaskName={null}
      />,
    );
    expect(screen.getByText("Waiting for the first task to start…")).toBeTruthy();
  });

  it("renders the terminal empty state for event-less finished executions", () => {
    render(
      <WorkflowTaskThread
        taskStates={new Map()}
        totalTasks={0}
        isRunning={false}
        selectedTaskName={null}
      />,
    );
    expect(
      screen.getByText("No task activity was recorded for this execution."),
    ).toBeTruthy();
  });

  it("shows progress with total and active counts", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({ taskName: "a", status: "completed" }),
          taskState({ taskName: "b", status: "running" }),
        )}
        totalTasks={5}
        isRunning
        selectedTaskName={null}
      />,
    );
    expect(screen.getByText("1 of 5 tasks")).toBeTruthy();
    expect(screen.getByText("1 active")).toBeTruthy();
  });

  it("renders one card per task in map order with kind labels", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({ taskName: "fetch-data" }),
          taskState({ taskName: "notify", taskKind: WorkflowTaskKind.notification }),
        )}
        totalTasks={2}
        isRunning={false}
        selectedTaskName={null}
      />,
    );
    const cards = screen.getAllByRole("button", { pressed: false });
    expect(cards[0].textContent).toContain("fetch-data");
    expect(cards[0].textContent).toContain("HTTP Call");
    expect(cards[1].textContent).toContain("notify");
    expect(cards[1].textContent).toContain("Notification");
  });

  it("previews the live agent on a running AGENT_CALL card", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({
            taskName: "call-writer",
            taskKind: WorkflowTaskKind.agent_call,
            status: "running",
            agentSlug: "blog-writer",
            currentToolName: "web_search",
            messagesCount: 7,
            toolCallsCount: 3,
          }),
        )}
        totalTasks={1}
        isRunning
        selectedTaskName={null}
      />,
    );
    const card = screen.getByRole("button", { name: /^call-writer/ });
    expect(card.textContent).toContain("blog-writer");
    expect(card.textContent).toContain("running web_search");
    expect(card.textContent).toContain("7 msgs · 3 tools");
  });

  it("previews the first error line on a failed card and shows the attempt count", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({
            taskName: "flaky",
            status: "failed",
            attemptNumber: 3,
            error: "connection refused\nlong stack trace",
          }),
        )}
        totalTasks={1}
        isRunning={false}
        selectedTaskName={null}
      />,
    );
    const card = screen.getByRole("button", { name: /^flaky/ });
    expect(card.textContent).toContain("connection refused");
    expect(card.textContent).not.toContain("long stack trace");
    expect(card.textContent).toContain("attempt 3");
  });

  it("previews waiting approval regardless of variant", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({
            taskName: "review-gate",
            taskKind: WorkflowTaskKind.human_input,
            status: "waiting_approval",
          }),
        )}
        totalTasks={1}
        isRunning
        selectedTaskName={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: /^review-gate/ }).textContent,
    ).toContain("Awaiting approval");
  });

  it("selects on card click and deselects on re-click (graph node contract)", () => {
    const onTaskSelect = vi.fn();
    const { rerender } = render(
      <WorkflowTaskThread
        taskStates={statesOf(taskState({ taskName: "fetch-data" }))}
        totalTasks={1}
        isRunning={false}
        selectedTaskName={null}
        onTaskSelect={onTaskSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^fetch-data/ }));
    expect(onTaskSelect).toHaveBeenLastCalledWith("fetch-data");

    rerender(
      <WorkflowTaskThread
        taskStates={statesOf(taskState({ taskName: "fetch-data" }))}
        totalTasks={1}
        isRunning={false}
        selectedTaskName="fetch-data"
        onTaskSelect={onTaskSelect}
      />,
    );
    const selected = screen.getByRole("button", { name: /^fetch-data/ });
    expect(selected.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(selected);
    expect(onTaskSelect).toHaveBeenLastCalledWith(null);
  });

  it("expands to the detail body and opens the transcript for an AGENT_CALL", () => {
    const onOpenAgentExecution = vi.fn();
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({
            taskName: "call-writer",
            taskKind: WorkflowTaskKind.agent_call,
            status: "completed",
            agentSlug: "blog-writer",
            childExecutionId: "aex_child_1",
            costMicros: 120_000n,
            tokensUsed: 4_200n,
          }),
        )}
        totalTasks={1}
        isRunning={false}
        selectedTaskName={null}
        onOpenAgentExecution={onOpenAgentExecution}
      />,
    );

    const chevron = screen.getByRole("button", { name: "Expand call-writer" });
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(chevron);
    expect(chevron.getAttribute("aria-expanded")).toBe("true");

    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
    // The agent slug appears in the collapsed preview AND the detail's
    // definition list — assert the detail row specifically.
    expect(screen.getByText("Agent").nextElementSibling?.textContent).toBe(
      "blog-writer",
    );

    fireEvent.click(screen.getByRole("button", { name: "Open transcript" }));
    expect(onOpenAgentExecution).toHaveBeenCalledWith("aex_child_1", "call-writer");
  });

  it("shows the full error in the expanded body", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({
            taskName: "flaky",
            status: "failed",
            error: "connection refused\nat dial tcp 10.0.0.1:443",
          }),
        )}
        totalTasks={1}
        isRunning={false}
        selectedTaskName={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand flaky" }));
    expect(screen.getByText(/at dial tcp 10\.0\.0\.1:443/)).toBeTruthy();
  });

  it("keeps a card's expanded state across streaming updates (no remount)", () => {
    const running = () =>
      statesOf(
        taskState({ taskName: "settled" }),
        taskState({ taskName: "live", status: "running", messagesCount: 1 }),
      );
    const { rerender } = render(
      <WorkflowTaskThread
        taskStates={running()}
        totalTasks={2}
        isRunning
        selectedTaskName={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand settled" }));
    expect(
      screen
        .getByRole("button", { name: "Collapse settled" })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    // A fresh map (as the store produces per event append) with only the
    // live task changed must not reset the settled card's local state.
    rerender(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({ taskName: "settled" }),
          taskState({ taskName: "live", status: "running", messagesCount: 2 }),
        )}
        totalTasks={2}
        isRunning
        selectedTaskName={null}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "Collapse settled" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("renders a fan-out as overlapping running cards in first-started order (D-T02-1)", () => {
    // The concurrency shape of the fan-out fixture (four branches live at
    // once after prepare settled): the flat model shows parallelism as
    // multiple simultaneously-running cards under an honest progress line.
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({ taskName: "prepare", status: "completed" }),
          taskState({ taskName: "fetch-us", status: "running" }),
          taskState({ taskName: "fetch-eu", status: "running" }),
          taskState({ taskName: "fetch-apac", status: "running" }),
          taskState({ taskName: "fetch-latam", status: "running" }),
        )}
        totalTasks={6}
        isRunning
        selectedTaskName={null}
      />,
    );

    const cards = screen.getAllByRole("button", { pressed: false });
    const expectedOrder = [
      "prepare",
      "fetch-us",
      "fetch-eu",
      "fetch-apac",
      "fetch-latam",
    ];
    expect(cards).toHaveLength(expectedOrder.length);
    expectedOrder.forEach((name, i) => {
      expect(cards[i].textContent?.startsWith(name)).toBe(true);
    });
    expect(screen.getByText("1 of 6 tasks")).toBeTruthy();
    expect(screen.getByText("4 active")).toBeTruthy();
  });

  it("reveals a card selected from outside the thread (shared-selection scroll)", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const states = statesOf(
      taskState({ taskName: "a" }),
      taskState({ taskName: "b" }),
    );
    const { rerender } = render(
      <WorkflowTaskThread
        taskStates={states}
        totalTasks={2}
        isRunning={false}
        selectedTaskName={null}
      />,
    );
    scrollIntoView.mockClear();

    // Selection arriving via props (graph node, Usage row, gate
    // auto-select) — the newly selected card reveals itself.
    rerender(
      <WorkflowTaskThread
        taskStates={states}
        totalTasks={2}
        isRunning={false}
        selectedTaskName="b"
      />,
    );
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("mounts the jump-to-latest affordance (hidden while following)", () => {
    const { container } = render(
      <WorkflowTaskThread
        taskStates={statesOf(taskState({ taskName: "a" }))}
        totalTasks={1}
        isRunning
        selectedTaskName={null}
      />,
    );
    // Following is the initial auto-scroll state, so the button is mounted
    // but aria-hidden (it fades in only once the user scrolls up) — query
    // by attribute, not by role, since it is out of the a11y tree.
    const button = container.querySelector('[aria-label="Jump to latest"]');
    expect(button).toBeTruthy();
    expect(button?.getAttribute("aria-hidden")).toBe("true");
  });
});
