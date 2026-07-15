import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

vi.mock("../../execution/useLiveAgentExecution", () => ({
  useLiveAgentExecution: vi.fn(),
}));
// The thread is the execution domain's heaviest organism; the document's
// contract with it is props-shaped, so a probe recording them suffices.
vi.mock("../../execution/MessageThread", () => ({
  MessageThread: vi.fn(() => <div data-testid="message-thread-probe" />),
}));

import { useLiveAgentExecution } from "../../execution/useLiveAgentExecution";
import { MessageThread } from "../../execution/MessageThread";
import { WorkflowAgentExecutionDocument } from "../WorkflowAgentExecutionDocument";

const mockUseLiveAgentExecution = vi.mocked(useLiveAgentExecution);
const mockMessageThread = vi.mocked(MessageThread);

function executionFixture(id: string, phase: ExecutionPhase): AgentExecution {
  const exec = create(AgentExecutionSchema);
  exec.metadata = create(ApiResourceMetadataSchema, { id });
  exec.status = create(AgentExecutionStatusSchema, { phase });
  return exec;
}

/** The hook's healthy resting shape; spread overrides per scenario. */
function hookState(
  overrides: Partial<ReturnType<typeof useLiveAgentExecution>> = {},
): ReturnType<typeof useLiveAgentExecution> {
  return {
    execution: null,
    phase: ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED,
    isLoading: false,
    isStreaming: false,
    isReconnecting: false,
    error: null,
    reconnect: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("WorkflowAgentExecutionDocument", () => {
  it("renders a live transcript with the Live indicator while streaming", () => {
    const running = executionFixture("aex_1", ExecutionPhase.EXECUTION_IN_PROGRESS);
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        execution: running,
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        isStreaming: true,
      }),
    );

    render(
      <WorkflowAgentExecutionDocument
        childExecutionId="aex_1"
        taskName="summarize-report"
        agentSlug="analyst"
      />,
    );

    expect(mockUseLiveAgentExecution).toHaveBeenCalledWith("aex_1");
    expect(screen.getByTestId("message-thread-probe")).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByText("summarize-report")).toBeTruthy();
    expect(screen.getByText("analyst")).toBeTruthy();

    const threadProps = mockMessageThread.mock.calls[0][0];
    expect(threadProps.activeStreamExecution).toBe(running);
  });

  it("passes NO HITL handlers to the thread — the transcript is read-only", () => {
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        execution: executionFixture("aex_1", ExecutionPhase.EXECUTION_IN_PROGRESS),
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        isStreaming: true,
      }),
    );

    render(
      <WorkflowAgentExecutionDocument childExecutionId="aex_1" taskName="t" />,
    );

    // Child HITL routes through the WORKFLOW's submit path (bottom Approvals
    // tab / inspector). Wiring the thread's own handlers here would bypass
    // that coordination — their absence is the contract, not an omission.
    const threadProps = mockMessageThread.mock.calls[0][0];
    expect(threadProps.onApprovalSubmit).toBeUndefined();
    expect(threadProps.submittingApprovalIds).toBeUndefined();
  });

  it("renders a terminal transcript with the phase badge and no Live indicator", () => {
    const done = executionFixture("aex_2", ExecutionPhase.EXECUTION_COMPLETED);
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({ execution: done, phase: ExecutionPhase.EXECUTION_COMPLETED }),
    );

    render(
      <WorkflowAgentExecutionDocument childExecutionId="aex_2" taskName="t" />,
    );

    expect(screen.getByTestId("message-thread-probe")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Completed" })).toBeTruthy();
    expect(screen.queryByText("Live")).toBeNull();
  });

  it("shows a Reconnecting affordance during a transient stream drop", () => {
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        execution: executionFixture("aex_3", ExecutionPhase.EXECUTION_IN_PROGRESS),
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        isReconnecting: true,
      }),
    );

    render(
      <WorkflowAgentExecutionDocument childExecutionId="aex_3" taskName="t" />,
    );

    expect(screen.getByText("Reconnecting…")).toBeTruthy();
    // The last snapshot stays visible through the drop.
    expect(screen.getByTestId("message-thread-probe")).toBeTruthy();
  });

  it("shows the loading skeleton before the first snapshot", () => {
    mockUseLiveAgentExecution.mockReturnValue(hookState({ isLoading: true }));

    render(
      <WorkflowAgentExecutionDocument childExecutionId="aex_4" taskName="t" />,
    );

    expect(screen.getByLabelText("Loading conversation")).toBeTruthy();
    expect(screen.queryByTestId("message-thread-probe")).toBeNull();
  });

  it("surfaces an error with a Retry wired to reconnect()", () => {
    const reconnect = vi.fn();
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({ error: new Error("stream exhausted retries"), reconnect }),
    );

    render(
      <WorkflowAgentExecutionDocument childExecutionId="aex_5" taskName="t" />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "stream exhausted retries",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it("renders an honest not-found notice when the execution no longer exists", () => {
    mockUseLiveAgentExecution.mockReturnValue(hookState());

    render(
      <WorkflowAgentExecutionDocument childExecutionId="aex_6" taskName="t" />,
    );

    expect(
      screen.getByText("This agent execution is no longer available."),
    ).toBeTruthy();
    expect(screen.queryByTestId("message-thread-probe")).toBeNull();
  });

  it("fires the standalone pop-out with the child execution id", () => {
    const navigate = vi.fn();
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        execution: executionFixture("aex_7", ExecutionPhase.EXECUTION_COMPLETED),
        phase: ExecutionPhase.EXECUTION_COMPLETED,
      }),
    );

    render(
      <WorkflowAgentExecutionDocument
        childExecutionId="aex_7"
        taskName="t"
        onNavigateToAgentExecution={navigate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open standalone/ }));
    expect(navigate).toHaveBeenCalledWith("aex_7");
  });

  it("omits the pop-out when the host provides no navigation", () => {
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        execution: executionFixture("aex_8", ExecutionPhase.EXECUTION_COMPLETED),
        phase: ExecutionPhase.EXECUTION_COMPLETED,
      }),
    );

    render(
      <WorkflowAgentExecutionDocument childExecutionId="aex_8" taskName="t" />,
    );

    expect(screen.queryByRole("button", { name: /Open standalone/ })).toBeNull();
  });
});
