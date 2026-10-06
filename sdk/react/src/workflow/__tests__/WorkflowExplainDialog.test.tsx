/**
 * Pins WorkflowExplainDialog over a stubbed explain flow: opening starts a
 * fresh explanation (reset, then explain); while the run streams, the
 * dialog shows the live run in the message thread; once complete it shows
 * the explanation and offers to copy it; an error shows the message and a
 * Try Again that explains again; Close asks the host to close.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { UseExplainWorkflowFlowReturn } from "../useExplainWorkflowFlow";
import { useExplainWorkflowFlow } from "../useExplainWorkflowFlow";
import { WorkflowExplainDialog } from "../WorkflowExplainDialog";

vi.mock("../useExplainWorkflowFlow", () => ({
  useExplainWorkflowFlow: vi.fn(),
}));

// The thread streams through the conversation store (its own suites cover
// it); here it only reports which run it was handed, live or settled.
vi.mock("../../run/MessageThread", () => ({
  MessageThread: ({
    runs,
    activeStreamRun,
  }: {
    runs: readonly { metadata?: { id?: string } }[];
    activeStreamRun: { metadata?: { id?: string } } | null;
  }) => (
    <div data-testid="thread-stub">
      live:{activeStreamRun?.metadata?.id ?? "none"} settled:
      {runs.map((r) => r.metadata?.id).join(",")}
    </div>
  ),
}));

const explain = vi.fn().mockResolvedValue(undefined);
const reset = vi.fn();

function arrange(overrides: Partial<UseExplainWorkflowFlowReturn>) {
  vi.mocked(useExplainWorkflowFlow).mockReturnValue({
    phase: "idle",
    explanation: null,
    run: null,
    isStreaming: false,
    error: null,
    explain,
    reset,
    ...overrides,
  });
}

function renderDialog(onOpenChange = vi.fn()) {
  render(
    <WorkflowExplainDialog
      open
      onOpenChange={onOpenChange}
      org="org_acme"
      currentYaml="name: nightly"
    />,
  );
  return onOpenChange;
}

const RUN = { metadata: { id: "run-1" } } as unknown as UseExplainWorkflowFlowReturn["run"];

beforeEach(() => {
  explain.mockClear();
  reset.mockClear();
});
afterEach(cleanup);

describe("WorkflowExplainDialog", () => {
  it("starts a fresh explanation when opened, for the org and YAML it was given", () => {
    arrange({});
    renderDialog();

    expect(reset).toHaveBeenCalledTimes(1);
    expect(explain).toHaveBeenCalledTimes(1);
    expect(vi.mocked(useExplainWorkflowFlow)).toHaveBeenLastCalledWith(
      expect.objectContaining({ org: "org_acme", currentYaml: "name: nightly" }),
    );
  });

  it("shows the live run in the thread while it streams", () => {
    arrange({ phase: "streaming", run: RUN, isStreaming: true });
    renderDialog();

    expect(screen.getByTestId("thread-stub").textContent).toBe("live:run-1 settled:");
    expect(screen.getByText("Analyzing…")).toBeTruthy();
  });

  it("shows the starting state before the run exists", () => {
    arrange({ phase: "starting" });
    renderDialog();
    expect(screen.getByText("Starting Workflow Architect…")).toBeTruthy();
    expect(screen.queryByTestId("thread-stub")).toBeNull();
  });

  it("shows the explanation once complete and offers to copy it", () => {
    arrange({ phase: "complete", explanation: "It triages the inbox.", run: RUN });
    renderDialog();

    expect(screen.getByText("It triages the inbox.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy to clipboard" })).toBeTruthy();
    expect(screen.queryByTestId("thread-stub")).toBeNull();
  });

  it("falls back to the settled thread when the run ended without an explanation", () => {
    arrange({ phase: "complete", run: RUN });
    renderDialog();
    expect(screen.getByTestId("thread-stub").textContent).toBe("live:none settled:run-1");
  });

  it("shows an error with a Try Again that explains again, and Close asks the host to close", () => {
    arrange({ phase: "error", error: "Agent stream interrupted" });
    const onOpenChange = renderDialog();

    expect(screen.getByRole("alert").textContent).toBe("Agent stream interrupted");
    explain.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
    expect(explain).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
