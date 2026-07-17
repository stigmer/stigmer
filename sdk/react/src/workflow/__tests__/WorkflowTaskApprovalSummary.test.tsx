import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { WorkflowTaskApprovalSummary } from "../WorkflowTaskApprovalSummary";
import type { TaskOutcome } from "../WorkflowTaskApprovalCard";
import type { TaskDetailApprovalDecision } from "../task-detail/task-approval";

function makeDecision(
  overrides: Partial<TaskDetailApprovalDecision> = {},
): TaskDetailApprovalDecision {
  return {
    outcome: "approve",
    reviewer: "alice",
    respondedAt: "2026-06-02T07:40:08Z",
    comment: "",
    formData: null,
    waitDurationMs: 0,
    autoResolved: false,
    ...overrides,
  };
}

const outcomes: readonly TaskOutcome[] = [
  { name: "approve", label: "Approve Plan" },
  { name: "reject", label: "Reject" },
];

const baseProps = {
  taskName: "team_lead_review",
  prompt: "Review today's plan.",
  outcomes,
};

describe("WorkflowTaskApprovalSummary", () => {
  afterEach(cleanup);

  describe("outcome rendering", () => {
    it("renders the human-readable outcome label from the configured outcomes", () => {
      render(<WorkflowTaskApprovalSummary {...baseProps} decision={makeDecision()} />);
      expect(screen.getByText("Approve Plan")).toBeTruthy();
    });

    it("falls back to the capitalized outcome identifier when no label is configured", () => {
      render(
        <WorkflowTaskApprovalSummary
          {...baseProps}
          outcomes={[]}
          decision={makeDecision({ outcome: "pause_campaigns" })}
        />,
      );
      expect(screen.getByText("Pause campaigns")).toBeTruthy();
    });

    it("is read-only — renders no actionable buttons", () => {
      render(<WorkflowTaskApprovalSummary {...baseProps} decision={makeDecision()} />);
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  describe("decision metadata", () => {
    it("renders the reviewer", () => {
      render(
        <WorkflowTaskApprovalSummary {...baseProps} decision={makeDecision({ reviewer: "bob" })} />,
      );
      expect(screen.getByText("bob")).toBeTruthy();
    });

    it("renders the wait duration when present", () => {
      render(
        <WorkflowTaskApprovalSummary
          {...baseProps}
          decision={makeDecision({ waitDurationMs: 90_000 })}
        />,
      );
      expect(screen.getByText(/waited/)).toBeTruthy();
    });

    it("renders an auto-resolved badge when the gate was resolved by a timeout", () => {
      render(
        <WorkflowTaskApprovalSummary
          {...baseProps}
          decision={makeDecision({ autoResolved: true })}
        />,
      );
      expect(screen.getByText("auto-resolved")).toBeTruthy();
    });
  });

  describe("comment and form answers", () => {
    it("renders the reviewer comment when present", () => {
      render(
        <WorkflowTaskApprovalSummary
          {...baseProps}
          decision={makeDecision({ comment: "ship it" })}
        />,
      );
      expect(screen.getByText("Comment")).toBeTruthy();
      expect(screen.getByText("ship it")).toBeTruthy();
    });

    it("does not render a comment section when there is no comment", () => {
      render(<WorkflowTaskApprovalSummary {...baseProps} decision={makeDecision()} />);
      expect(screen.queryByText("Comment")).toBeNull();
    });

    it("renders submitted form answers with humanized labels", () => {
      render(
        <WorkflowTaskApprovalSummary
          {...baseProps}
          decision={makeDecision({ formData: { risk_notes: "low risk" } })}
        />,
      );
      expect(screen.getByText("Risk notes")).toBeTruthy();
      expect(screen.getByText("low risk")).toBeTruthy();
    });
  });

  describe("finalizing state", () => {
    it("shows a finalizing affordance when the decision is null", () => {
      render(<WorkflowTaskApprovalSummary {...baseProps} decision={null} />);
      expect(screen.getByText(/finalizing/i)).toBeTruthy();
    });

    it("shows a finalizing affordance when the outcome is not yet captured", () => {
      render(
        <WorkflowTaskApprovalSummary
          {...baseProps}
          decision={makeDecision({ outcome: "" })}
        />,
      );
      expect(screen.getByText(/finalizing/i)).toBeTruthy();
    });

    it("still renders the prompt while finalizing", () => {
      render(<WorkflowTaskApprovalSummary {...baseProps} decision={null} />);
      expect(screen.getByText("Review today's plan.")).toBeTruthy();
    });
  });

  describe("accessibility", () => {
    it('exposes a labelled group region', () => {
      render(<WorkflowTaskApprovalSummary {...baseProps} decision={makeDecision()} />);
      const group = screen.getByRole("group");
      expect(group.getAttribute("aria-label")).toBe(
        "Approval decision for team_lead_review",
      );
    });
  });
});
