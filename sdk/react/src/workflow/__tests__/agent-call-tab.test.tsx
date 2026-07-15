import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AgentCallTab } from "../execution-inspector/AgentCallTab";
import type { TaskDetailAgentCall } from "../execution-inspector/derive-task-detail";

function agentCall(
  overrides: Partial<TaskDetailAgentCall> = {},
): TaskDetailAgentCall {
  return {
    childExecutionId: "aex_1",
    agentSlug: "analyst",
    agentPhase: "",
    messagesCount: 4,
    toolCallsCount: 2,
    tokensConsumed: BigInt(1200),
    costMicros: BigInt(500),
    error: "",
    currentToolName: "",
    ...overrides,
  };
}

afterEach(cleanup);

describe("AgentCallTab (launcher)", () => {
  it("opens the transcript in place with the child id AND the task name", () => {
    const onOpen = vi.fn();
    render(
      <AgentCallTab
        agentCall={agentCall()}
        taskName="summarize-report"
        taskStatus="running"
        onOpenAgentExecution={onOpen}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open agent execution" }),
    );
    expect(onOpen).toHaveBeenCalledWith("aex_1", "summarize-report");
  });

  it("keeps the standalone pop-out as a secondary action", () => {
    const onNavigate = vi.fn();
    render(
      <AgentCallTab
        agentCall={agentCall()}
        taskName="t"
        taskStatus="completed"
        onNavigateToAgentExecution={onNavigate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open standalone" }));
    expect(onNavigate).toHaveBeenCalledWith("aex_1");
  });

  it("serves running and terminal tasks with the same launcher (stats visible)", () => {
    const { unmount } = render(
      <AgentCallTab agentCall={agentCall()} taskName="t" taskStatus="running" />,
    );
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Messages")).toBeTruthy();
    unmount();

    render(
      <AgentCallTab agentCall={agentCall()} taskName="t" taskStatus="completed" />,
    );
    expect(screen.queryByText("Running")).toBeNull();
    expect(screen.getByText("Messages")).toBeTruthy();
    expect(screen.getByText("analyst")).toBeTruthy();
  });

  it("shows the waiting state — no launch actions — while running without a child id", () => {
    render(
      <AgentCallTab
        agentCall={agentCall({ childExecutionId: "" })}
        taskName="t"
        taskStatus="running"
        onOpenAgentExecution={vi.fn()}
        onNavigateToAgentExecution={vi.fn()}
      />,
    );

    expect(screen.getByText("Waiting for agent to start...")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("hides launch actions for a TERMINAL task without a child id (nothing to open)", () => {
    render(
      <AgentCallTab
        agentCall={agentCall({ childExecutionId: "" })}
        taskName="t"
        taskStatus="completed"
        onOpenAgentExecution={vi.fn()}
        onNavigateToAgentExecution={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders the child's error inline", () => {
    render(
      <AgentCallTab
        agentCall={agentCall({ error: "agent crashed" })}
        taskName="t"
        taskStatus="failed"
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("agent crashed");
  });

  it("never embeds a transcript — the thumbnail is gone by design", () => {
    render(
      <AgentCallTab agentCall={agentCall()} taskName="t" taskStatus="running" />,
    );
    // The full transcript lives in WorkflowAgentExecutionDocument (panel
    // editor area); the inspector holds no child stream and no thread.
    expect(document.querySelector('[class*="max-h-"]')).toBeNull();
  });
});
