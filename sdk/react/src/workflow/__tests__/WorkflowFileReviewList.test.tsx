import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FileChangeSetStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

// Mock the child execution stream: each child id maps to a canned execution.
const mockExecutions: Record<string, any> = {};
vi.mock("../../execution/useExecutionStream", () => ({
  useExecutionStream: (id: string | null) => ({
    execution: id ? (mockExecutions[id] ?? null) : null,
  }),
}));

// Stub FileReviewCard to a minimal control that surfaces its wiring, so the test
// exercises the container's mapping/forwarding — not the card's diff rendering.
vi.mock("../../execution/FileReviewCard", () => ({
  FileReviewCard: (props: any) => (
    <button
      data-testid={`card-${props.fileChangeSet.id}`}
      onClick={() => props.onSubmit(1 /* APPROVE */, { expectedDigest: "d" })}
    >
      review {props.fileChangeSet.id}
    </button>
  ),
}));

import { WorkflowFileReviewList } from "../WorkflowFileReviewList";

function awaitingSet(id: string) {
  return { id, status: FileChangeSetStatus.AWAITING_REVIEW, changes: [{ id: "fc" }] };
}

beforeEach(() => {
  for (const k of Object.keys(mockExecutions)) delete mockExecutions[k];
});

afterEach(() => {
  cleanup();
});

describe("WorkflowFileReviewList", () => {
  it("renders nothing when there are no references", () => {
    const { container } = render(
      <WorkflowFileReviewList pendingFileReviews={[]} onSubmitFileDecision={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a card for a referenced AWAITING_REVIEW set and forwards the decision with child routing", () => {
    mockExecutions["aex-1"] = { status: { fileChangeSets: [awaitingSet("fcs-1")] } };
    const onSubmit = vi.fn();

    render(
      <WorkflowFileReviewList
        pendingFileReviews={[{ childAgentExecutionId: "aex-1", changeSetId: ["fcs-1"] } as any]}
        onSubmitFileDecision={onSubmit}
      />,
    );

    const card = screen.getByTestId("card-fcs-1");
    fireEvent.click(card);
    expect(onSubmit).toHaveBeenCalledWith("aex-1", "fcs-1", 1, { expectedDigest: "d" });
  });

  it("does not render a set that is not in the surfaced reference", () => {
    // Child has an AWAITING set fcs-2, but the parent only surfaced fcs-1.
    mockExecutions["aex-1"] = {
      status: { fileChangeSets: [awaitingSet("fcs-1"), awaitingSet("fcs-2")] },
    };

    render(
      <WorkflowFileReviewList
        pendingFileReviews={[{ childAgentExecutionId: "aex-1", changeSetId: ["fcs-1"] } as any]}
        onSubmitFileDecision={vi.fn()}
      />,
    );

    expect(screen.getByTestId("card-fcs-1")).toBeTruthy();
    expect(screen.queryByTestId("card-fcs-2")).toBeNull();
  });

  it("does not render a referenced set that is no longer AWAITING_REVIEW", () => {
    mockExecutions["aex-1"] = {
      status: { fileChangeSets: [{ id: "fcs-1", status: FileChangeSetStatus.DECIDED, changes: [{ id: "fc" }] }] },
    };

    render(
      <WorkflowFileReviewList
        pendingFileReviews={[{ childAgentExecutionId: "aex-1", changeSetId: ["fcs-1"] } as any]}
        onSubmitFileDecision={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("card-fcs-1")).toBeNull();
  });

  it("renders reviews for multiple parallel children independently", () => {
    mockExecutions["aex-1"] = { status: { fileChangeSets: [awaitingSet("fcs-1")] } };
    mockExecutions["aex-2"] = { status: { fileChangeSets: [awaitingSet("fcs-2")] } };

    render(
      <WorkflowFileReviewList
        pendingFileReviews={[
          { childAgentExecutionId: "aex-1", changeSetId: ["fcs-1"] } as any,
          { childAgentExecutionId: "aex-2", changeSetId: ["fcs-2"] } as any,
        ]}
        onSubmitFileDecision={vi.fn()}
      />,
    );

    expect(screen.getByTestId("card-fcs-1")).toBeTruthy();
    expect(screen.getByTestId("card-fcs-2")).toBeTruthy();
  });

  it("shows a deep-link affordance when onNavigateToAgentExecution is provided", () => {
    mockExecutions["aex-1"] = { status: { fileChangeSets: [awaitingSet("fcs-1")] } };
    const onNavigate = vi.fn();

    render(
      <WorkflowFileReviewList
        pendingFileReviews={[{ childAgentExecutionId: "aex-1", changeSetId: ["fcs-1"] } as any]}
        onSubmitFileDecision={vi.fn()}
        onNavigateToAgentExecution={onNavigate}
      />,
    );

    fireEvent.click(screen.getByText("View agent execution"));
    expect(onNavigate).toHaveBeenCalledWith("aex-1");
  });
});
