import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type {
  DerivedCostSummary,
  DerivedTaskState,
} from "../../internal/store/workflow-execution-event-store";
import { WorkflowUsageTab } from "../facets/WorkflowUsageTab";

function costSummary(overrides: Partial<DerivedCostSummary> = {}): DerivedCostSummary {
  return {
    costConsumedMicros: 0n,
    costRemainingMicros: -1n,
    tokensConsumed: 0n,
    tokensRemaining: -1n,
    thresholdBreached: false,
    ...overrides,
  };
}

function taskState(overrides: Partial<DerivedTaskState> & { taskName: string }): DerivedTaskState {
  return {
    taskKind: WorkflowTaskKind.llm_call,
    status: "completed",
    durationMs: 0,
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

afterEach(cleanup);

describe("WorkflowUsageTab", () => {
  it("shows the empty state before any usage accrues", () => {
    render(
      <WorkflowUsageTab costSummary={costSummary()} taskStates={new Map()} />,
    );
    expect(
      screen.getByText(
        "No usage data yet. Cost and token stats will appear here.",
      ),
    ).toBeTruthy();
  });

  it("renders the aggregate alone when no task qualifies for the breakdown (e.g. snapshot-fallback states)", () => {
    render(
      <WorkflowUsageTab
        costSummary={costSummary({ costConsumedMicros: 190_000n, tokensConsumed: 12_400n })}
        taskStates={statesOf(taskState({ taskName: "zeroed_by_fallback" }))}
      />,
    );
    expect(screen.getByText("$0.19")).toBeTruthy();
    expect(screen.getByText(/12\.4K tokens/)).toBeTruthy();
    expect(screen.queryByText("By task")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders the budget limit when the stream reports remaining amounts", () => {
    render(
      <WorkflowUsageTab
        costSummary={costSummary({
          costConsumedMicros: 250_000n,
          costRemainingMicros: 750_000n,
          tokensConsumed: 1_000n,
          tokensRemaining: 9_000n,
        })}
        taskStates={new Map()}
      />,
    );
    expect(screen.getByText("of $1.00 budget")).toBeTruthy();
    expect(screen.getByText(/1\.0K tokens of 10\.0K/)).toBeTruthy();
  });

  it("omits budget limits when remaining is unknown (-1 sentinel)", () => {
    render(
      <WorkflowUsageTab
        costSummary={costSummary({ costConsumedMicros: 250_000n, tokensConsumed: 1_000n })}
        taskStates={new Map()}
      />,
    );
    expect(screen.queryByText(/budget/)).toBeNull();
  });

  it("announces a breached threshold in text, not color alone", () => {
    render(
      <WorkflowUsageTab
        costSummary={costSummary({ costConsumedMicros: 900_000n, thresholdBreached: true })}
        taskStates={new Map()}
      />,
    );
    expect(screen.getByText("Budget threshold breached")).toBeTruthy();
  });

  it("renders the per-task breakdown most-expensive-first with kind labels", () => {
    render(
      <WorkflowUsageTab
        costSummary={costSummary({ costConsumedMicros: 900_000n })}
        taskStates={statesOf(
          taskState({ taskName: "cheap_task", costMicros: 10_000n, tokensUsed: 100n }),
          taskState({
            taskName: "call_agent",
            taskKind: WorkflowTaskKind.agent_call,
            costMicros: 800_000n,
            tokensUsed: 40_000n,
          }),
        )}
      />,
    );
    expect(screen.getByText("By task")).toBeTruthy();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("call_agent");
    expect(items[0].textContent).toContain("Agent Call");
    expect(items[0].textContent).toContain("$0.80");
    expect(items[1].textContent).toContain("cheap_task");
  });

  it("marks in-flight tasks so live usage reads as live", () => {
    render(
      <WorkflowUsageTab
        costSummary={costSummary({ tokensConsumed: 1_200n })}
        taskStates={statesOf(
          taskState({
            taskName: "call_agent",
            taskKind: WorkflowTaskKind.agent_call,
            status: "running",
            tokensUsed: 1_200n,
          }),
        )}
      />,
    );
    expect(screen.getByRole("listitem").textContent).toContain("running");
  });

  it("selects the task when a breakdown row is clicked", () => {
    const onSelectTask = vi.fn();
    render(
      <WorkflowUsageTab
        costSummary={costSummary({ costConsumedMicros: 100_000n })}
        taskStates={statesOf(
          taskState({ taskName: "expensive_task", costMicros: 100_000n }),
        )}
        onSelectTask={onSelectTask}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /expensive_task/ }));
    expect(onSelectTask).toHaveBeenCalledWith("expensive_task");
  });

  it("renders rows as static (non-interactive) entries without onSelectTask", () => {
    render(
      <WorkflowUsageTab
        costSummary={costSummary({ costConsumedMicros: 100_000n })}
        taskStates={statesOf(
          taskState({ taskName: "expensive_task", costMicros: 100_000n }),
        )}
      />,
    );
    expect(screen.getByRole("listitem").textContent).toContain("expensive_task");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
