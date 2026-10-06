import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  AgentRunSchema,
  AgentRunStatusSchema,
  type AgentRun,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";

import { RunProgress } from "../RunProgress";

afterEach(() => {
  cleanup();
});

function makeExecution(phase: RunPhase, error?: string): AgentRun {
  const exec = create(AgentRunSchema);
  const status = create(AgentRunStatusSchema);
  status.phase = phase;
  if (error !== undefined) {
    status.error = error;
  }
  exec.status = status;
  return exec;
}

describe("RunProgress", () => {
  it("renders nothing without an execution", () => {
    const { container } = render(<RunProgress run={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("surfaces the server error as an alert for a FAILED execution", () => {
    render(
      <RunProgress
        run={makeExecution(
          RunPhase.RUN_FAILED,
          "Activity task timed out",
        )}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Activity task timed out",
    );
  });

  // Cancelled is a quiet terminal state (stigmer#282): a CANCELLED run
  // can legitimately carry a non-empty status.error (preserved prior error, or
  // a pre-fix server's "Execution cancelled" sentinel), so the phase — not the
  // error field — decides whether the alert renders.
  it("renders a CANCELLED execution quietly even when it carries an error", () => {
    render(
      <RunProgress
        run={makeExecution(
          RunPhase.RUN_CANCELLED,
          "Execution cancelled",
        )}
      />,
    );

    expect(screen.getByText(/cancelled/i)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Execution cancelled")).toBeNull();
  });
});
