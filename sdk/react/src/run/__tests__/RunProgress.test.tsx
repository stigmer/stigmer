// Pins RunProgress: nothing without a run, the run's phase badge, the
// server's failure reason as an alert (never for a cancelled run), and the
// turn's folded to-do list sorted by activity with each status's glyph.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import {
  RunSchema,
  RunStatusSchema,
  type Run,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { Todo } from "@stigmer/client";

import { RunProgress } from "../RunProgress";

afterEach(() => {
  cleanup();
});

function makeExecution(phase: RunPhase, error?: string): Run {
  const exec = create(RunSchema);
  const status = create(RunStatusSchema);
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

  it("renders nothing for a run with no status", () => {
    const { container } = render(<RunProgress run={create(RunSchema)} />);
    expect(container.innerHTML).toBe("");
  });

  it("lists the turn's to-dos by activity: in progress, pending, completed, cancelled", () => {
    const todo = (id: string, content: string, status: Todo["status"]): Todo => ({
      id,
      content,
      status,
      createdAt: "",
      updatedAt: "",
    });
    render(
      <RunProgress
        run={makeExecution(RunPhase.RUN_IN_PROGRESS)}
        todos={[
          todo("1", "Done already", "completed"),
          todo("2", "Dropped", "cancelled"),
          todo("3", "Up next", "pending"),
          todo("4", "Doing now", "in_progress"),
        ]}
      />,
    );
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toEqual(["Doing now", "Up next", "Done already", "Dropped"]);
    // A cancelled item is struck through.
    expect(screen.getByText("Dropped").className).toContain("stg:line-through");
  });

  it("shows no list for an empty to-do list", () => {
    render(<RunProgress run={makeExecution(RunPhase.RUN_COMPLETED)} todos={[]} />);
    expect(screen.queryByRole("list")).toBeNull();
  });
});
