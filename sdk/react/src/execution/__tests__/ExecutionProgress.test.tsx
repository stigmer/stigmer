import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import { ExecutionProgress } from "../ExecutionProgress";

afterEach(() => {
  cleanup();
});

function makeExecution(phase: ExecutionPhase, error?: string): AgentExecution {
  const exec = create(AgentExecutionSchema);
  const status = create(AgentExecutionStatusSchema);
  status.phase = phase;
  if (error !== undefined) {
    status.error = error;
  }
  exec.status = status;
  return exec;
}

describe("ExecutionProgress", () => {
  it("renders nothing without an execution", () => {
    const { container } = render(<ExecutionProgress execution={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("surfaces the server error as an alert for a FAILED execution", () => {
    render(
      <ExecutionProgress
        execution={makeExecution(
          ExecutionPhase.EXECUTION_FAILED,
          "Activity task timed out",
        )}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Activity task timed out",
    );
  });

  // Cancelled is a quiet terminal state (stigmer#282): a CANCELLED execution
  // can legitimately carry a non-empty status.error (preserved prior error, or
  // a pre-fix server's "Execution cancelled" sentinel), so the phase — not the
  // error field — decides whether the alert renders.
  it("renders a CANCELLED execution quietly even when it carries an error", () => {
    render(
      <ExecutionProgress
        execution={makeExecution(
          ExecutionPhase.EXECUTION_CANCELLED,
          "Execution cancelled",
        )}
      />,
    );

    expect(screen.getByText(/cancelled/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Execution cancelled")).toBeNull();
  });
});
