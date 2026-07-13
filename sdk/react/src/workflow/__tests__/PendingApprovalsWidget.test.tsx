import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { PendingApprovalsWidget } from "../PendingApprovalsWidget";

function makeApproval(
  overrides: MessageInitShape<typeof PendingApprovalSchema> = {},
): PendingApproval {
  return create(PendingApprovalSchema, {
    executionId: "wfx-1",
    workflowName: "Article Pipeline",
    taskName: "reviewDraft",
    requester: "usr-alice",
    ...overrides,
  });
}

describe("PendingApprovalsWidget", () => {
  afterEach(cleanup);

  it("renders workflow name and task name", () => {
    render(
      <PendingApprovalsWidget
        approvals={[makeApproval()]}
        totalCount={1}
        isLoading={false}
      />,
    );
    expect(screen.getByText("Article Pipeline")).toBeTruthy();
    expect(screen.getByText(/reviewDraft/)).toBeTruthy();
  });

  describe("review-type badge", () => {
    it("shows the uiHint as a badge so dashboards can distinguish review types", () => {
      render(
        <PendingApprovalsWidget
          approvals={[makeApproval({ uiHint: "article-diff" })]}
          totalCount={1}
          isLoading={false}
        />,
      );
      expect(screen.getByText("article-diff")).toBeTruthy();
    });

    it("renders no badge for a generic review (empty uiHint)", () => {
      const { container } = render(
        <PendingApprovalsWidget
          approvals={[makeApproval()]}
          totalCount={1}
          isLoading={false}
        />,
      );
      // Only the workflow-name/task-name texts render; no badge span appears.
      expect(container.querySelectorAll("span.rounded")).toHaveLength(0);
    });
  });

  it("shows the empty state when there are no approvals", () => {
    render(
      <PendingApprovalsWidget approvals={[]} totalCount={0} isLoading={false} />,
    );
    expect(screen.getByText("No approvals pending")).toBeTruthy();
  });

  it("invokes onReviewClick with the execution id", () => {
    const onReviewClick = vi.fn();
    render(
      <PendingApprovalsWidget
        approvals={[makeApproval()]}
        totalCount={1}
        isLoading={false}
        onReviewClick={onReviewClick}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(onReviewClick).toHaveBeenCalledWith("wfx-1");
  });
});
