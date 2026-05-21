import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { WorkflowRepairCard } from "../WorkflowRepairCard";
import { useDiagnoseExecutionFlow } from "../useDiagnoseExecutionFlow";

vi.mock("../useDiagnoseExecutionFlow", () => ({
  useDiagnoseExecutionFlow: vi.fn(),
}));

vi.mock("../../execution/MessageThread", () => ({
  MessageThread: () => <div data-testid="message-thread" />,
}));

vi.mock("../workflow-yaml-diff", () => ({
  computeUnifiedDiff: () => [
    { type: "removed", content: "old-line" },
    { type: "added", content: "new-line" },
  ],
}));

const mockedUseDiagnoseExecutionFlow = vi.mocked(useDiagnoseExecutionFlow);

const defaultFlow = {
  phase: "idle" as const,
  completedExecutions: [] as unknown[],
  activeExecution: null,
  isStreaming: false,
  extractedYaml: null,
  explanation: null,
  error: null,
  diagnose: vi.fn(),
  sendFollowUp: vi.fn(),
  acceptFix: vi.fn(),
  discardFix: vi.fn(),
  reset: vi.fn(),
};

const defaultProps = {
  executionId: "exec-123",
  org: "test-org",
  currentWorkflowYaml: "name: test",
  onApplyFix: vi.fn(),
  onClose: vi.fn(),
};

describe("WorkflowRepairCard", () => {
  beforeEach(() => {
    mockedUseDiagnoseExecutionFlow.mockReturnValue(defaultFlow as ReturnType<typeof useDiagnoseExecutionFlow>);
  });

  afterEach(cleanup);

  it("shows starting indicator", () => {
    mockedUseDiagnoseExecutionFlow.mockReturnValue({
      ...defaultFlow,
      phase: "starting",
    } as ReturnType<typeof useDiagnoseExecutionFlow>);

    render(<WorkflowRepairCard {...defaultProps} />);

    expect(screen.getByText(/Starting Workflow Architect/)).toBeTruthy();
  });

  it("shows message thread when streaming", () => {
    mockedUseDiagnoseExecutionFlow.mockReturnValue({
      ...defaultFlow,
      phase: "streaming",
      isStreaming: true,
      activeExecution: { id: "exec-1" } as any,
      completedExecutions: [{ id: "exec-0" }] as any,
    } as ReturnType<typeof useDiagnoseExecutionFlow>);

    render(<WorkflowRepairCard {...defaultProps} />);

    expect(screen.getByTestId("message-thread")).toBeTruthy();
    expect(screen.getByText(/Analyzing/)).toBeTruthy();
  });

  it("shows fix with apply and discard buttons on complete", () => {
    mockedUseDiagnoseExecutionFlow.mockReturnValue({
      ...defaultFlow,
      phase: "complete",
      extractedYaml: "name: fixed",
      explanation: "Fixed the retry config",
      completedExecutions: [{ id: "exec-0" }] as any,
    } as ReturnType<typeof useDiagnoseExecutionFlow>);

    render(<WorkflowRepairCard {...defaultProps} />);

    expect(screen.getByText("Suggested Fix")).toBeTruthy();
    expect(screen.getByText("Apply Fix")).toBeTruthy();
    expect(screen.getByText("Discard")).toBeTruthy();
  });

  it("shows runtime error notice when ready without fix", () => {
    mockedUseDiagnoseExecutionFlow.mockReturnValue({
      ...defaultFlow,
      phase: "ready",
      completedExecutions: [{ id: "exec-0" }] as any,
      extractedYaml: null,
    } as ReturnType<typeof useDiagnoseExecutionFlow>);

    render(<WorkflowRepairCard {...defaultProps} />);

    expect(screen.getByText(/No workflow definition changes/)).toBeTruthy();
  });

  it("shows error with retry button", () => {
    mockedUseDiagnoseExecutionFlow.mockReturnValue({
      ...defaultFlow,
      phase: "error",
      error: "Stream failed",
    } as ReturnType<typeof useDiagnoseExecutionFlow>);

    render(<WorkflowRepairCard {...defaultProps} />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Stream failed");
    expect(screen.getByText("Try Again")).toBeTruthy();
  });

  it("Apply Fix calls onApplyFix with YAML", () => {
    const onApplyFix = vi.fn();
    const acceptFix = vi.fn().mockReturnValue("fixed: yaml");

    mockedUseDiagnoseExecutionFlow.mockReturnValue({
      ...defaultFlow,
      phase: "complete",
      extractedYaml: "fixed: yaml",
      explanation: "Applied a fix",
      completedExecutions: [{ id: "exec-0" }] as any,
      acceptFix,
    } as ReturnType<typeof useDiagnoseExecutionFlow>);

    render(<WorkflowRepairCard {...defaultProps} onApplyFix={onApplyFix} />);

    fireEvent.click(screen.getByText("Apply Fix"));

    expect(acceptFix).toHaveBeenCalledTimes(1);
    expect(onApplyFix).toHaveBeenCalledWith("fixed: yaml");
  });

  it("Discard calls discardFix", () => {
    const discardFix = vi.fn();

    mockedUseDiagnoseExecutionFlow.mockReturnValue({
      ...defaultFlow,
      phase: "complete",
      extractedYaml: "name: fixed",
      explanation: "Fixed it",
      completedExecutions: [{ id: "exec-0" }] as any,
      discardFix,
    } as ReturnType<typeof useDiagnoseExecutionFlow>);

    render(<WorkflowRepairCard {...defaultProps} />);

    fireEvent.click(screen.getByText("Discard"));

    expect(discardFix).toHaveBeenCalledTimes(1);
  });

  it("composer enabled in ready phase", () => {
    mockedUseDiagnoseExecutionFlow.mockReturnValue({
      ...defaultFlow,
      phase: "ready",
      completedExecutions: [{ id: "exec-0" }] as any,
    } as ReturnType<typeof useDiagnoseExecutionFlow>);

    render(<WorkflowRepairCard {...defaultProps} />);

    const textarea = screen.getByRole("textbox");
    expect((textarea as HTMLTextAreaElement).disabled).toBe(false);
  });

  it("composer disabled during streaming", () => {
    mockedUseDiagnoseExecutionFlow.mockReturnValue({
      ...defaultFlow,
      phase: "streaming",
      isStreaming: true,
      activeExecution: { id: "exec-1" } as any,
    } as ReturnType<typeof useDiagnoseExecutionFlow>);

    render(<WorkflowRepairCard {...defaultProps} />);

    const textarea = screen.getByRole("textbox");
    expect((textarea as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("close button calls onClose", () => {
    const onClose = vi.fn();

    render(<WorkflowRepairCard {...defaultProps} onClose={onClose} />);

    const closeButton = screen.getByLabelText("Close diagnosis panel");
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
