import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ExecutionInspector } from "../execution-inspector/ExecutionInspector";
import { useExecutionTaskDetail } from "../execution-inspector/useExecutionTaskDetail";
import type { TaskDetail } from "../execution-inspector/derive-task-detail";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";

vi.mock("../execution-inspector/useExecutionTaskDetail", () => ({
  useExecutionTaskDetail: vi.fn(),
}));

vi.mock("../kind-metadata", () => ({
  kindToDisplayName: (kind: string) => kind || "unknown",
}));

vi.mock("../execution-inspector/SummaryTab", () => ({
  SummaryTab: () => <div data-testid="summary-tab-content">Summary content</div>,
}));

vi.mock("../execution-inspector/InputOutputTab", () => ({
  InputOutputTab: ({ label }: { label: string }) => (
    <div data-testid={`${label.toLowerCase()}-tab-content`}>{label} content</div>
  ),
}));

vi.mock("../execution-inspector/ErrorTab", () => ({
  ErrorTab: () => <div data-testid="error-tab-content">Error content</div>,
}));

vi.mock("../execution-inspector/RetriesTab", () => ({
  RetriesTab: () => <div data-testid="retries-tab-content">Retries content</div>,
}));

vi.mock("../execution-inspector/AgentCallTab", () => ({
  AgentCallTab: () => <div data-testid="agent-tab-content">Agent content</div>,
}));

vi.mock("../execution-inspector/EventLogTab", () => ({
  EventLogTab: () => <div data-testid="events-tab-content">Events content</div>,
}));

const mockedUseExecutionTaskDetail = vi.mocked(useExecutionTaskDetail);

function makeDetail(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    taskName: "my-task",
    taskKind: WorkflowTaskKind.workflow_task_kind_unspecified,
    displayName: "Set Vars",
    status: "completed",
    summary: {
      startedAt: "2026-01-01T00:00:00Z",
      completedAt: "2026-01-01T00:00:05Z",
      durationMs: 5000,
      costMicros: BigInt(0),
      inputTokens: BigInt(0),
      outputTokens: BigInt(0),
      totalTokens: BigInt(0),
      attemptNumber: 1,
    },
    input: null,
    output: null,
    error: null,
    retries: null,
    agentCall: null,
    approval: null,
    eventLog: [],
    ...overrides,
  };
}

const defaultProps = {
  selectedTaskName: null as string | null,
  events: [] as any[],
  taskStates: new Map() as ReadonlyMap<string, DerivedTaskState>,
};

describe("ExecutionInspector", () => {
  afterEach(cleanup);

  it("renders empty state when selectedTaskName is null", () => {
    mockedUseExecutionTaskDetail.mockReturnValue({ detail: null });

    render(<ExecutionInspector {...defaultProps} selectedTaskName={null} />);

    expect(screen.getByText("Click a node to view execution details")).toBeTruthy();
  });

  it("renders empty state when detail is null", () => {
    mockedUseExecutionTaskDetail.mockReturnValue({ detail: null });

    render(<ExecutionInspector {...defaultProps} selectedTaskName="some-task" />);

    expect(screen.getByText("Click a node to view execution details")).toBeTruthy();
  });

  it("renders Summary tab by default for a completed task", () => {
    const detail = makeDetail({ status: "completed" });
    mockedUseExecutionTaskDetail.mockReturnValue({ detail });

    render(<ExecutionInspector {...defaultProps} selectedTaskName="my-task" />);

    expect(screen.getByRole("tab", { name: "Summary" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("summary-tab-content")).toBeTruthy();
  });

  it("auto-selects Error tab when task status is failed", () => {
    const detail = makeDetail({
      status: "failed",
      error: { message: "boom", attemptNumber: 1, maxAttempts: 3, willRetry: false, durationMs: 100 },
    });
    mockedUseExecutionTaskDetail.mockReturnValue({ detail });

    render(<ExecutionInspector {...defaultProps} selectedTaskName="failed-task" />);

    expect(screen.getByRole("tab", { name: "Error" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("error-tab-content")).toBeTruthy();
  });

  it("resets to Summary when selectedTaskName changes to a non-failed task", () => {
    const failedDetail = makeDetail({
      status: "failed",
      error: { message: "err", attemptNumber: 1, maxAttempts: 1, willRetry: false, durationMs: 50 },
    });
    mockedUseExecutionTaskDetail.mockReturnValue({ detail: failedDetail });

    const { rerender } = render(
      <ExecutionInspector {...defaultProps} selectedTaskName="task-a" />,
    );

    expect(screen.getByRole("tab", { name: "Error" }).getAttribute("aria-selected")).toBe("true");

    const completedDetail = makeDetail({ status: "completed" });
    mockedUseExecutionTaskDetail.mockReturnValue({ detail: completedDetail });

    rerender(<ExecutionInspector {...defaultProps} selectedTaskName="task-b" />);

    expect(screen.getByRole("tab", { name: "Summary" }).getAttribute("aria-selected")).toBe("true");
  });

  it("auto-selects Error tab when status transitions to failed on same task", () => {
    const runningDetail = makeDetail({ status: "running" });
    mockedUseExecutionTaskDetail.mockReturnValue({ detail: runningDetail });

    const { rerender } = render(
      <ExecutionInspector {...defaultProps} selectedTaskName="my-task" />,
    );

    expect(screen.getByRole("tab", { name: "Summary" }).getAttribute("aria-selected")).toBe("true");

    const failedDetail = makeDetail({
      status: "failed",
      error: { message: "crash", attemptNumber: 1, maxAttempts: 1, willRetry: false, durationMs: 200 },
    });
    mockedUseExecutionTaskDetail.mockReturnValue({ detail: failedDetail });

    rerender(<ExecutionInspector {...defaultProps} selectedTaskName="my-task" />);

    expect(screen.getByRole("tab", { name: "Error" }).getAttribute("aria-selected")).toBe("true");
  });

  describe("tab visibility", () => {
    it("shows only Summary and Events tabs for a minimal completed task", () => {
      const detail = makeDetail({ status: "completed" });
      mockedUseExecutionTaskDetail.mockReturnValue({ detail });

      render(<ExecutionInspector {...defaultProps} selectedTaskName="my-task" />);

      expect(screen.getByRole("tab", { name: "Summary" })).toBeTruthy();
      expect(screen.getByRole("tab", { name: "Events" })).toBeTruthy();
      expect(screen.queryByRole("tab", { name: "Input" })).toBeFalsy();
      expect(screen.queryByRole("tab", { name: "Output" })).toBeFalsy();
      expect(screen.queryByRole("tab", { name: "Error" })).toBeFalsy();
      expect(screen.queryByRole("tab", { name: "Retries" })).toBeFalsy();
      expect(screen.queryByRole("tab", { name: "Agent" })).toBeFalsy();
    });

    it("shows Input tab when detail.input is present", () => {
      const detail = makeDetail({
        input: { data: { key: "value" }, summary: null, artifactIds: [], source: "snapshot" },
      });
      mockedUseExecutionTaskDetail.mockReturnValue({ detail });

      render(<ExecutionInspector {...defaultProps} selectedTaskName="my-task" />);

      expect(screen.getByRole("tab", { name: "Input" })).toBeTruthy();
    });

    it("shows Output tab when detail.output is present", () => {
      const detail = makeDetail({
        output: { data: { result: "ok" }, summary: null, artifactIds: [], source: "snapshot" },
      });
      mockedUseExecutionTaskDetail.mockReturnValue({ detail });

      render(<ExecutionInspector {...defaultProps} selectedTaskName="my-task" />);

      expect(screen.getByRole("tab", { name: "Output" })).toBeTruthy();
    });

    it("shows Error tab when detail.error is present", () => {
      const detail = makeDetail({
        status: "failed",
        error: { message: "fail", attemptNumber: 1, maxAttempts: 1, willRetry: false, durationMs: 0 },
      });
      mockedUseExecutionTaskDetail.mockReturnValue({ detail });

      render(<ExecutionInspector {...defaultProps} selectedTaskName="my-task" />);

      expect(screen.getByRole("tab", { name: "Error" })).toBeTruthy();
    });

    it("shows Retries tab only when attempts > 1", () => {
      const detail = makeDetail({
        retries: {
          currentAttempt: 2,
          attempts: [
            { attemptNumber: 1, status: "failed", durationMs: 100, error: "err", delayBeforeMs: 0, startedAt: "" },
            { attemptNumber: 2, status: "completed", durationMs: 200, error: "", delayBeforeMs: 500, startedAt: "" },
          ],
        },
      });
      mockedUseExecutionTaskDetail.mockReturnValue({ detail });

      render(<ExecutionInspector {...defaultProps} selectedTaskName="my-task" />);

      expect(screen.getByRole("tab", { name: "Retries" })).toBeTruthy();
    });

    it("does not show Retries tab when only 1 attempt", () => {
      const detail = makeDetail({
        retries: {
          currentAttempt: 1,
          attempts: [
            { attemptNumber: 1, status: "completed", durationMs: 100, error: "", delayBeforeMs: 0, startedAt: "" },
          ],
        },
      });
      mockedUseExecutionTaskDetail.mockReturnValue({ detail });

      render(<ExecutionInspector {...defaultProps} selectedTaskName="my-task" />);

      expect(screen.queryByRole("tab", { name: "Retries" })).toBeFalsy();
    });

    it("shows Agent tab when detail.agentCall is present", () => {
      const detail = makeDetail({
        agentCall: {
          childExecutionId: "child-1",
          agentSlug: "my-agent",
          agentPhase: "3",
          messagesCount: 5,
          toolCallsCount: 2,
          tokensConsumed: BigInt(1000),
          costMicros: BigInt(500),
          error: "",
          currentToolName: "",
        },
      });
      mockedUseExecutionTaskDetail.mockReturnValue({ detail });

      render(<ExecutionInspector {...defaultProps} selectedTaskName="my-task" />);

      expect(screen.getByRole("tab", { name: "Agent" })).toBeTruthy();
    });
  });

  it("displays task name in the header", () => {
    const detail = makeDetail({ taskName: "classify_input" });
    mockedUseExecutionTaskDetail.mockReturnValue({ detail });

    render(<ExecutionInspector {...defaultProps} selectedTaskName="classify_input" />);

    expect(screen.getByText("classify_input")).toBeTruthy();
  });

  it("has an accessible tablist with aria-label", () => {
    const detail = makeDetail();
    mockedUseExecutionTaskDetail.mockReturnValue({ detail });

    render(<ExecutionInspector {...defaultProps} selectedTaskName="my-task" />);

    expect(screen.getByRole("tablist", { name: "Task execution details" })).toBeTruthy();
  });
});
