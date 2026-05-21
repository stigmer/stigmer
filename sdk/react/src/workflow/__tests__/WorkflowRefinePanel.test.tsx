import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { WorkflowRefinePanel } from "../WorkflowRefinePanel";
import { useRefineWorkflowFlow } from "../useRefineWorkflowFlow";

vi.mock("../useRefineWorkflowFlow", () => ({
  useRefineWorkflowFlow: vi.fn(),
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

const mockedUseRefineWorkflowFlow = vi.mocked(useRefineWorkflowFlow);

const defaultFlow = {
  phase: "idle" as const,
  completedExecutions: [] as unknown[],
  activeExecution: null,
  isStreaming: false,
  extractedYaml: null,
  explanation: null,
  error: null,
  sendInstruction: vi.fn(),
  acceptResult: vi.fn(),
  discardResult: vi.fn(),
  reset: vi.fn(),
};

const defaultProps = {
  org: "test-org",
  currentYaml: "name: test",
  onAccept: vi.fn(),
  onClose: vi.fn(),
};

describe("WorkflowRefinePanel", () => {
  beforeEach(() => {
    mockedUseRefineWorkflowFlow.mockReturnValue(defaultFlow as ReturnType<typeof useRefineWorkflowFlow>);
  });

  afterEach(cleanup);

  it("shows empty state when idle", () => {
    render(<WorkflowRefinePanel {...defaultProps} />);

    expect(screen.getByText(/Describe the changes you want/)).toBeTruthy();
  });

  it("enables composer in idle phase", () => {
    render(<WorkflowRefinePanel {...defaultProps} />);

    const textarea = screen.getByRole("textbox");
    expect((textarea as HTMLTextAreaElement).disabled).toBe(false);
    expect(screen.getByText("Send")).toBeTruthy();
  });

  it("shows starting indicator", () => {
    mockedUseRefineWorkflowFlow.mockReturnValue({
      ...defaultFlow,
      phase: "starting",
    } as ReturnType<typeof useRefineWorkflowFlow>);

    render(<WorkflowRefinePanel {...defaultProps} />);

    expect(screen.getByText(/Starting Workflow Architect/)).toBeTruthy();
  });

  it("shows message thread when streaming", () => {
    mockedUseRefineWorkflowFlow.mockReturnValue({
      ...defaultFlow,
      phase: "streaming",
      isStreaming: true,
      activeExecution: { id: "exec-1" } as any,
      completedExecutions: [{ id: "exec-0" }] as any,
    } as ReturnType<typeof useRefineWorkflowFlow>);

    render(<WorkflowRefinePanel {...defaultProps} />);

    expect(screen.getByTestId("message-thread")).toBeTruthy();
    expect(screen.getByText(/Working/)).toBeTruthy();
  });

  it("disables composer during streaming", () => {
    mockedUseRefineWorkflowFlow.mockReturnValue({
      ...defaultFlow,
      phase: "streaming",
      isStreaming: true,
      activeExecution: { id: "exec-1" } as any,
    } as ReturnType<typeof useRefineWorkflowFlow>);

    render(<WorkflowRefinePanel {...defaultProps} />);

    const textarea = screen.getByRole("textbox");
    expect((textarea as HTMLTextAreaElement).disabled).toBe(true);
  });

  it("shows accept and discard buttons on complete", () => {
    mockedUseRefineWorkflowFlow.mockReturnValue({
      ...defaultFlow,
      phase: "complete",
      extractedYaml: "name: updated",
      explanation: "Changed the name",
      completedExecutions: [{ id: "exec-0" }] as any,
    } as ReturnType<typeof useRefineWorkflowFlow>);

    render(<WorkflowRefinePanel {...defaultProps} />);

    expect(screen.getByText("Accept")).toBeTruthy();
    expect(screen.getByText("Discard")).toBeTruthy();
  });

  it("shows error message", () => {
    mockedUseRefineWorkflowFlow.mockReturnValue({
      ...defaultFlow,
      phase: "error",
      error: "Network failure",
    } as ReturnType<typeof useRefineWorkflowFlow>);

    render(<WorkflowRefinePanel {...defaultProps} />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Network failure");
  });

  it("disables send button for short input", () => {
    render(<WorkflowRefinePanel {...defaultProps} />);

    const textarea = screen.getByRole("textbox");
    const sendButton = screen.getByText("Send");

    fireEvent.change(textarea, { target: { value: "hi" } });
    expect((sendButton as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: "hello world" } });
    expect((sendButton as HTMLButtonElement).disabled).toBe(false);
  });

  it("accept calls onAccept with YAML", () => {
    const onAccept = vi.fn();
    const acceptResult = vi.fn().mockReturnValue("yaml: content");

    mockedUseRefineWorkflowFlow.mockReturnValue({
      ...defaultFlow,
      phase: "complete",
      extractedYaml: "yaml: content",
      completedExecutions: [{ id: "exec-0" }] as any,
      acceptResult,
    } as ReturnType<typeof useRefineWorkflowFlow>);

    render(<WorkflowRefinePanel {...defaultProps} onAccept={onAccept} />);

    fireEvent.click(screen.getByText("Accept"));

    expect(acceptResult).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith("yaml: content");
  });

  it("close button calls onClose", () => {
    const onClose = vi.fn();

    render(<WorkflowRefinePanel {...defaultProps} onClose={onClose} />);

    const closeButton = screen.getByLabelText("Close refinement panel");
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
