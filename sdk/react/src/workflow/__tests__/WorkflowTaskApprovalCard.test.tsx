import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { WorkflowTaskApprovalCard } from "../WorkflowTaskApprovalCard";
import type { TaskOutcome } from "../WorkflowTaskApprovalCard";

const defaultProps = {
  taskName: "review_task",
  outcomes: [] as readonly TaskOutcome[],
  onSubmit: vi.fn().mockResolvedValue(undefined),
  isSubmitting: false,
};

describe("WorkflowTaskApprovalCard", () => {
  afterEach(cleanup);

  describe("outcome rendering", () => {
    it("renders default Approve/Reject when outcomes array is empty", () => {
      render(<WorkflowTaskApprovalCard {...defaultProps} />);
      expect(screen.getByText("Approve")).toBeTruthy();
      expect(screen.getByText("Reject")).toBeTruthy();
    });

    it("renders custom outcome buttons with labels", () => {
      const outcomes: TaskOutcome[] = [
        { name: "lgtm", label: "Looks Good" },
        { name: "needs_work", label: "Needs Work" },
      ];
      render(<WorkflowTaskApprovalCard {...defaultProps} outcomes={outcomes} />);
      expect(screen.getByText("Looks Good")).toBeTruthy();
      expect(screen.getByText("Needs Work")).toBeTruthy();
    });

    it("falls back to capitalized name when label is empty", () => {
      const outcomes: TaskOutcome[] = [{ name: "proceed", label: "" }];
      render(<WorkflowTaskApprovalCard {...defaultProps} outcomes={outcomes} />);
      expect(screen.getByText("Proceed")).toBeTruthy();
    });
  });

  // The buttons now share the quiet, token-only DecisionButton primitive:
  // first outcome = neutral chip (`primary`), reject/deny or the trailing of two
  // = ghost-`danger`, middle outcomes = neutral `ghost`. No loud success/destructive
  // fills, and no `bg-token/NN` opacity modifiers.
  describe("button variants (quiet hierarchy)", () => {
    it("first outcome is the neutral chip (primary), never the loud success green", () => {
      render(<WorkflowTaskApprovalCard {...defaultProps} />);
      const btn = screen.getByRole("button", { name: "Approve" });
      expect(btn.className).toContain("stg:bg-accent");
      expect(btn.className).not.toContain("stg:bg-success");
    });

    it('outcome named "reject" is a quiet danger ghost (no red fill)', () => {
      const outcomes: TaskOutcome[] = [
        { name: "approve", label: "Approve" },
        { name: "reject", label: "Reject" },
        { name: "defer", label: "Defer" },
      ];
      render(<WorkflowTaskApprovalCard {...defaultProps} outcomes={outcomes} />);
      const btn = screen.getByRole("button", { name: "Reject" });
      expect(btn.className).toContain("stg:hover:text-destructive");
      expect(btn.className).not.toContain("stg:bg-destructive stg:text-destructive-foreground");
    });

    it('outcome named "deny" is a quiet danger ghost (no red fill)', () => {
      const outcomes: TaskOutcome[] = [
        { name: "approve", label: "Approve" },
        { name: "deny", label: "Deny" },
        { name: "defer", label: "Defer" },
      ];
      render(<WorkflowTaskApprovalCard {...defaultProps} outcomes={outcomes} />);
      const btn = screen.getByRole("button", { name: "Deny" });
      expect(btn.className).toContain("stg:hover:text-destructive");
      expect(btn.className).not.toContain("stg:bg-destructive stg:text-destructive-foreground");
    });

    it("second of two outcomes is the danger ghost (binary fallback)", () => {
      const outcomes: TaskOutcome[] = [
        { name: "accept", label: "Accept" },
        { name: "decline", label: "Decline" },
      ];
      render(<WorkflowTaskApprovalCard {...defaultProps} outcomes={outcomes} />);
      const btn = screen.getByRole("button", { name: "Decline" });
      expect(btn.className).toContain("stg:hover:text-destructive");
    });

    it("middle outcomes in 3+ are neutral ghosts (no resting fill)", () => {
      const outcomes: TaskOutcome[] = [
        { name: "approve", label: "Approve" },
        { name: "defer", label: "Defer" },
        { name: "escalate", label: "Escalate" },
      ];
      render(<WorkflowTaskApprovalCard {...defaultProps} outcomes={outcomes} />);
      const btn = screen.getByRole("button", { name: "Defer" });
      expect(btn.className).toContain("stg:text-muted-foreground");
      expect(btn.className).not.toMatch(/(?:^|\s)bg-/);
    });

    it("the card uses neutral chrome + warning accent, never the old amber fill", () => {
      render(<WorkflowTaskApprovalCard {...defaultProps} />);
      const card = screen.getByRole("form");
      expect(card.className).toContain("stg:border-border-prominent");
      expect(card.className).toContain("stg:border-l-warning");
      expect(card.className).not.toContain("stg:bg-warning");
    });
  });

  describe("form fields", () => {
    const formSchema = {
      type: "object",
      properties: {
        review_notes: { type: "string", description: "Enter your review notes" },
        risk_level: { type: "string", description: "Assess the risk" },
      },
    };

    it("renders textarea for each property in formSchema", () => {
      render(<WorkflowTaskApprovalCard {...defaultProps} formSchema={formSchema} />);
      const field1 = screen.getByLabelText("Review notes");
      const field2 = screen.getByLabelText("Risk level");
      expect(field1.tagName).toBe("TEXTAREA");
      expect(field2.tagName).toBe("TEXTAREA");
    });

    it("labels are derived from property names (underscores to spaces, capitalized)", () => {
      render(<WorkflowTaskApprovalCard {...defaultProps} formSchema={formSchema} />);
      expect(screen.getByText("Review notes")).toBeTruthy();
      expect(screen.getByText("Risk level")).toBeTruthy();
    });

    it("placeholder shows property description", () => {
      render(<WorkflowTaskApprovalCard {...defaultProps} formSchema={formSchema} />);
      expect(screen.getByPlaceholderText("Enter your review notes")).toBeTruthy();
      expect(screen.getByPlaceholderText("Assess the risk")).toBeTruthy();
    });
  });

  describe("review payload (issue #234 fallback display)", () => {
    it("renders an object payload as structured data", () => {
      render(
        <WorkflowTaskApprovalCard
          {...defaultProps}
          payload={{ severity: "P1", summary: "Escalate the incident" }}
        />,
      );
      expect(screen.getByLabelText("Review material for review_task")).toBeTruthy();
      expect(screen.getByText("Escalate the incident")).toBeTruthy();
    });

    it("renders non-object payloads as formatted JSON", () => {
      render(
        <WorkflowTaskApprovalCard {...defaultProps} payload={["item-1", "item-2"]} />,
      );
      const section = screen.getByLabelText("Review material for review_task");
      expect(section.textContent).toContain("item-1");
      expect(section.textContent).toContain("item-2");
    });

    it("renders no review material section when payload is absent", () => {
      render(<WorkflowTaskApprovalCard {...defaultProps} />);
      expect(screen.queryByLabelText("Review material for review_task")).toBeNull();
    });
  });

  describe("submission", () => {
    it("onSubmit called with (taskName, outcomeName, undefined, undefined) when no form or comment", () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      render(<WorkflowTaskApprovalCard {...defaultProps} onSubmit={onSubmit} />);
      fireEvent.click(screen.getByText("Approve"));
      expect(onSubmit).toHaveBeenCalledWith("review_task", "approve", undefined, undefined);
    });

    it("onSubmit called with (taskName, outcomeName, formData, comment) when form and comment filled", () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const formSchema = {
        type: "object",
        properties: {
          feedback: { type: "string", description: "Your feedback" },
        },
      };
      render(
        <WorkflowTaskApprovalCard {...defaultProps} onSubmit={onSubmit} formSchema={formSchema} />,
      );
      fireEvent.change(screen.getByLabelText("Feedback"), {
        target: { value: "looks great" },
      });
      fireEvent.change(screen.getByPlaceholderText("Comment (optional)"), {
        target: { value: "nice work" },
      });
      fireEvent.click(screen.getByText("Approve"));

      expect(onSubmit).toHaveBeenCalledWith(
        "review_task",
        "approve",
        { feedback: "looks great" },
        "nice work",
      );
    });

    it("empty form field values are filtered out (not included in formData)", () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      const formSchema = {
        type: "object",
        properties: {
          filled: { type: "string" },
          empty: { type: "string" },
        },
      };
      render(
        <WorkflowTaskApprovalCard {...defaultProps} onSubmit={onSubmit} formSchema={formSchema} />,
      );
      fireEvent.change(screen.getByLabelText("Filled"), {
        target: { value: "has value" },
      });
      fireEvent.click(screen.getByText("Approve"));

      expect(onSubmit).toHaveBeenCalledWith(
        "review_task",
        "approve",
        { filled: "has value" },
        undefined,
      );
    });

    it("whitespace-only comment is passed as undefined", () => {
      const onSubmit = vi.fn().mockResolvedValue(undefined);
      render(<WorkflowTaskApprovalCard {...defaultProps} onSubmit={onSubmit} />);
      fireEvent.change(screen.getByPlaceholderText("Comment (optional)"), {
        target: { value: "   " },
      });
      fireEvent.click(screen.getByText("Approve"));

      expect(onSubmit).toHaveBeenCalledWith("review_task", "approve", undefined, undefined);
    });
  });

  describe("loading state", () => {
    it("buttons disabled when isSubmitting is true", () => {
      render(<WorkflowTaskApprovalCard {...defaultProps} isSubmitting={true} />);
      const approveBtn = screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement;
      const rejectBtn = screen.getByRole("button", { name: "Reject" }) as HTMLButtonElement;
      expect(approveBtn.disabled).toBe(true);
      expect(rejectBtn.disabled).toBe(true);
    });

    it("spinner shown on the active outcome button during submission", () => {
      const { rerender } = render(
        <WorkflowTaskApprovalCard {...defaultProps} />,
      );
      fireEvent.click(screen.getByText("Approve"));

      rerender(<WorkflowTaskApprovalCard {...defaultProps} isSubmitting={true} />);

      const approveBtn = screen.getByRole("button", { name: "Approve" });
      expect(approveBtn.querySelector(".stg\\:animate-spin")).toBeTruthy();

      const rejectBtn = screen.getByRole("button", { name: "Reject" });
      expect(rejectBtn.querySelector(".stg\\:animate-spin")).toBeNull();
    });

    it("activeOutcome clears when isSubmitting transitions to false", () => {
      const { rerender } = render(
        <WorkflowTaskApprovalCard {...defaultProps} />,
      );
      fireEvent.click(screen.getByText("Approve"));

      rerender(<WorkflowTaskApprovalCard {...defaultProps} isSubmitting={true} />);
      expect(
        screen.getByRole("button", { name: "Approve" }).querySelector(".stg\\:animate-spin"),
      ).toBeTruthy();

      rerender(<WorkflowTaskApprovalCard {...defaultProps} isSubmitting={false} />);
      expect(
        screen.getByRole("button", { name: "Approve" }).querySelector(".stg\\:animate-spin"),
      ).toBeNull();
    });
  });

  describe("in-card decision error", () => {
    it("renders the failure notice beside the outcomes when error is set", () => {
      render(
        <WorkflowTaskApprovalCard {...defaultProps} error={new Error("signal failed")} />,
      );
      expect(
        screen.getByText(/Couldn.t submit decision — signal failed/),
      ).toBeTruthy();
    });

    it("renders no failure notice when error is null", () => {
      render(<WorkflowTaskApprovalCard {...defaultProps} error={null} />);
      expect(screen.queryByText(/Couldn.t submit decision/)).toBeNull();
    });
  });

  describe("accessibility", () => {
    it('root element has role="form"', () => {
      render(<WorkflowTaskApprovalCard {...defaultProps} />);
      expect(screen.getByRole("form")).toBeTruthy();
    });

    it("root element has aria-label with task name", () => {
      render(<WorkflowTaskApprovalCard {...defaultProps} />);
      const form = screen.getByRole("form");
      expect(form.getAttribute("aria-label")).toBe("Approval decision for review_task");
    });

    it("root element has aria-busy matching isSubmitting", () => {
      const { rerender } = render(
        <WorkflowTaskApprovalCard {...defaultProps} isSubmitting={false} />,
      );
      const form = screen.getByRole("form");
      expect(form.getAttribute("aria-busy")).toBe("false");

      rerender(<WorkflowTaskApprovalCard {...defaultProps} isSubmitting={true} />);
      expect(form.getAttribute("aria-busy")).toBe("true");
    });

    it("each outcome button has aria-label", () => {
      render(<WorkflowTaskApprovalCard {...defaultProps} />);
      expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    });

    it("form fields have associated labels via htmlFor/id", () => {
      const formSchema = {
        type: "object",
        properties: {
          my_field: { type: "string" },
        },
      };
      render(
        <WorkflowTaskApprovalCard {...defaultProps} formSchema={formSchema} />,
      );
      const label = screen.getByText("My field");
      const textarea = screen.getByLabelText("My field");
      expect(label.tagName).toBe("LABEL");
      expect((label as HTMLLabelElement).htmlFor).toBe("review_task-my_field");
      expect(textarea.id).toBe("review_task-my_field");
    });
  });
});
