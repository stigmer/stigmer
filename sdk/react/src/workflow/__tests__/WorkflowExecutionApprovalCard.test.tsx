import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { WorkflowExecutionApprovalCard } from "../WorkflowExecutionApprovalCard";

// ApprovalAction enum: 1 = APPROVE, 3 = REJECT.
const APPROVE = 1;
const REJECT = 3;

const defaultProps = {
  prompt: "The agent wants to delete /tmp/x. Approve?",
  toolCallId: "tc-1",
  approvers: [] as readonly string[],
  timeoutSeconds: 0,
  onSubmitApproval: vi.fn().mockResolvedValue(undefined),
  isSubmitting: false,
};

afterEach(cleanup);

describe("WorkflowExecutionApprovalCard", () => {
  describe("content", () => {
    it("renders the prompt", () => {
      render(<WorkflowExecutionApprovalCard {...defaultProps} />);
      expect(screen.getByText(defaultProps.prompt)).toBeTruthy();
    });

    it("lists approvers and the timeout when provided", () => {
      render(
        <WorkflowExecutionApprovalCard
          {...defaultProps}
          approvers={["alice", "bob"]}
          timeoutSeconds={120}
        />,
      );
      expect(screen.getByText("Approvers: alice, bob")).toBeTruthy();
      expect(screen.getByText("Expires in 2m")).toBeTruthy();
    });
  });

  describe("submission", () => {
    it("submits APPROVE with the comment", () => {
      const onSubmitApproval = vi.fn().mockResolvedValue(undefined);
      render(
        <WorkflowExecutionApprovalCard {...defaultProps} onSubmitApproval={onSubmitApproval} />,
      );
      fireEvent.change(screen.getByPlaceholderText("Comment (optional)"), {
        target: { value: "ok" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Approve" }));
      expect(onSubmitApproval).toHaveBeenCalledWith("tc-1", APPROVE, "ok");
    });

    it("submits REJECT with no comment as undefined", () => {
      const onSubmitApproval = vi.fn().mockResolvedValue(undefined);
      render(
        <WorkflowExecutionApprovalCard {...defaultProps} onSubmitApproval={onSubmitApproval} />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
      expect(onSubmitApproval).toHaveBeenCalledWith("tc-1", REJECT, undefined);
    });
  });

  describe("quiet chrome & buttons (shared DecisionButton)", () => {
    it("uses neutral card chrome + warning accent, never the old amber fill", () => {
      render(<WorkflowExecutionApprovalCard {...defaultProps} />);
      const card = screen.getByRole("alert");
      expect(card.className).toContain("border-border-prominent");
      expect(card.className).toContain("border-l-warning");
      expect(card.className).not.toContain("bg-warning");
    });

    it("Approve is the neutral chip (not loud green); Reject is a quiet danger ghost (not a red fill)", () => {
      render(<WorkflowExecutionApprovalCard {...defaultProps} />);
      const approve = screen.getByRole("button", { name: "Approve" });
      expect(approve.className).toContain("bg-accent");
      expect(approve.className).not.toContain("bg-success");

      const reject = screen.getByRole("button", { name: "Reject" });
      expect(reject.className).toContain("hover:text-destructive");
      expect(reject.className).not.toContain("bg-destructive text-destructive-foreground");
      // No opacity-modifier debt (e.g. the old hover:bg-destructive/10).
      expect(reject.className).not.toMatch(/\/\d+(?:\s|$)/);
    });
  });

  describe("loading state", () => {
    it("disables both buttons while submitting", () => {
      render(<WorkflowExecutionApprovalCard {...defaultProps} isSubmitting />);
      expect(
        (screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(
        (screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement).disabled,
      ).toBe(true);
    });

    it("shows the spinner on the clicked button during submission", () => {
      const { rerender } = render(<WorkflowExecutionApprovalCard {...defaultProps} />);
      fireEvent.click(screen.getByRole("button", { name: "Reject" }));
      rerender(<WorkflowExecutionApprovalCard {...defaultProps} isSubmitting />);

      expect(
        screen.getByRole("button", { name: "Reject" }).querySelector(".animate-spin"),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Approve" }).querySelector(".animate-spin"),
      ).toBeNull();
    });
  });

  describe("in-card decision error", () => {
    it("renders the failure notice beside the actions when error is set", () => {
      render(
        <WorkflowExecutionApprovalCard
          {...defaultProps}
          error={new Error("gate already resolved")}
        />,
      );
      expect(
        screen.getByText(/Couldn.t submit decision — gate already resolved/),
      ).toBeTruthy();
    });

    it("renders no failure notice when error is null", () => {
      render(<WorkflowExecutionApprovalCard {...defaultProps} error={null} />);
      expect(screen.queryByText(/Couldn.t submit decision/)).toBeNull();
    });
  });
});
