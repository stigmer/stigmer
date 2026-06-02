import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { WorkflowArchitectDialog } from "../WorkflowArchitectDialog";
import { useWorkflowArchitectFlow } from "../useWorkflowArchitectFlow";

vi.mock("../useWorkflowArchitectFlow", () => ({
  useWorkflowArchitectFlow: vi.fn(),
}));

vi.mock("../../execution/MessageThread", () => ({
  MessageThread: () => <div data-testid="message-thread" />,
}));

const mockedUseWorkflowArchitectFlow = vi.mocked(useWorkflowArchitectFlow);

const defaultFlow = {
  prompt: "",
  setPrompt: vi.fn(),
  phase: "idle" as const,
  execution: null,
  isStreaming: false,
  extractedYaml: null,
  explanation: null,
  error: null,
  generate: vi.fn(),
  createWorkflow: vi.fn(),
  reset: vi.fn(),
};

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  org: "test-org",
  onSuccess: vi.fn(),
  onError: vi.fn(),
};

describe("WorkflowArchitectDialog", () => {
  beforeEach(() => {
    mockedUseWorkflowArchitectFlow.mockReturnValue(defaultFlow as ReturnType<typeof useWorkflowArchitectFlow>);
  });

  afterEach(cleanup);

  it("does not render content when open is false", () => {
    const { container } = render(<WorkflowArchitectDialog {...defaultProps} open={false} />);

    const dialog = container.querySelector("dialog");
    expect(dialog).toBeTruthy();
    expect(dialog!.hasAttribute("open")).toBe(false);
  });

  it("shows input phase when idle and open", () => {
    render(<WorkflowArchitectDialog {...defaultProps} />);

    expect(screen.getByText("Generate Workflow")).toBeTruthy();
    expect(screen.getByRole("textbox")).toBeTruthy();
    expect(screen.getByText("Generate")).toBeTruthy();
  });

  it("disables Generate button for short prompt", () => {
    mockedUseWorkflowArchitectFlow.mockReturnValue({
      ...defaultFlow,
      prompt: "short",
    } as ReturnType<typeof useWorkflowArchitectFlow>);

    render(<WorkflowArchitectDialog {...defaultProps} />);

    const generateButton = screen.getByText("Generate");
    expect((generateButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows streaming phase", () => {
    mockedUseWorkflowArchitectFlow.mockReturnValue({
      ...defaultFlow,
      phase: "streaming",
      isStreaming: true,
      execution: { id: "exec-1" } as any,
    } as ReturnType<typeof useWorkflowArchitectFlow>);

    render(<WorkflowArchitectDialog {...defaultProps} />);

    expect(screen.getByText("Workflow Architect")).toBeTruthy();
    expect(screen.getByText(/Working/)).toBeTruthy();
  });

  it("shows result phase on complete", () => {
    mockedUseWorkflowArchitectFlow.mockReturnValue({
      ...defaultFlow,
      phase: "complete",
      extractedYaml: "name: my-workflow\ntasks: []",
      explanation: "Created a workflow with two tasks",
    } as ReturnType<typeof useWorkflowArchitectFlow>);

    render(<WorkflowArchitectDialog {...defaultProps} />);

    expect(screen.getByText("Generated Workflow")).toBeTruthy();
    // The raw YAML lives behind a collapsible "View YAML" toggle; expand it first.
    fireEvent.click(screen.getByText("▸ View YAML"));
    expect(screen.getByText(/name: my-workflow/)).toBeTruthy();
    expect(screen.getByText("Create Workflow")).toBeTruthy();
    expect(screen.getByText("Try Again")).toBeTruthy();
  });

  it("disables buttons during applying", () => {
    mockedUseWorkflowArchitectFlow.mockReturnValue({
      ...defaultFlow,
      phase: "applying",
      extractedYaml: "name: my-workflow",
      explanation: "Created a workflow",
    } as ReturnType<typeof useWorkflowArchitectFlow>);

    render(<WorkflowArchitectDialog {...defaultProps} />);

    expect(screen.getByText(/Creating/)).toBeTruthy();

    const tryAgainButton = screen.getByText("Try Again");
    expect((tryAgainButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows error phase", () => {
    mockedUseWorkflowArchitectFlow.mockReturnValue({
      ...defaultFlow,
      phase: "error",
      error: "Agent failed",
    } as ReturnType<typeof useWorkflowArchitectFlow>);

    render(<WorkflowArchitectDialog {...defaultProps} />);

    expect(screen.getByText("Generation Failed")).toBeTruthy();
    expect(screen.getByText("Agent failed")).toBeTruthy();
    expect(screen.getByText("Try Again")).toBeTruthy();
    expect(screen.getByText("Close")).toBeTruthy();
  });

  it("shows error phase for extraction-failed", () => {
    mockedUseWorkflowArchitectFlow.mockReturnValue({
      ...defaultFlow,
      phase: "extraction-failed",
      error: "Could not extract YAML from agent response",
    } as ReturnType<typeof useWorkflowArchitectFlow>);

    render(<WorkflowArchitectDialog {...defaultProps} />);

    expect(screen.getByText("Generation Failed")).toBeTruthy();
    expect(screen.getByText("Could not extract YAML from agent response")).toBeTruthy();
  });

  it("Cancel button calls onOpenChange", () => {
    const onOpenChange = vi.fn();

    render(<WorkflowArchitectDialog {...defaultProps} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByText("Cancel"));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
