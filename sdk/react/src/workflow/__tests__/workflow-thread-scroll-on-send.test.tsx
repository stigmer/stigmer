// Scroll-on-send wiring pins for WorkflowTaskThread (stigmer-cloud#267):
// the workflow surface's send-analog is a HITL decision submission —
// submitting pins the thread (default-ON, opt-out via
// `scrollOnSend={false}`) BEFORE delegating, so the unblocked run's
// continuation lands in view. The real scroll mechanics are pinned in
// `internal/__tests__/useAutoScroll.layout.test.tsx`; this file pins the
// hitl-wrapper wiring through a spied `jumpToLatest`.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import { ApprovalRequestedPayloadSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";

const jumpToLatestSpy = vi.fn();

// Replaces only the scroll machine (browser observers happy-dom lacks) with
// a spied jumpToLatest — the wrapper under test calls it directly.
vi.mock("../../internal/useAutoScroll", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../internal/useAutoScroll")>();
  return {
    ...original,
    useAutoScroll: () => ({
      scrollRef: { current: null },
      sentinelRef: { current: null },
      contentRef: () => {},
      isFollowing: true,
      jumpToLatest: jumpToLatestSpy,
    }),
  };
});

import {
  WorkflowTaskThread,
  type WorkflowThreadHitl,
} from "../thread/WorkflowTaskThread";

afterEach(() => {
  cleanup();
  jumpToLatestSpy.mockClear();
});

function makeHitl(): WorkflowThreadHitl {
  return {
    submitApproval: vi.fn(),
    approvalSubmittingToolCallIds: new Set<string>(),
    approvalErrorsByToolCallId: new Map<string, Error>(),
    submitTaskApproval: vi.fn(),
    taskApprovalSubmittingTaskNames: new Set<string>(),
    taskApprovalErrorsByTaskName: new Map<string, Error>(),
    submitFileDecision: vi.fn(),
    fileDecisionSubmittingKeys: new Set<string>(),
    fileDecisionErrorsByKey: new Map<string, Error>(),
  };
}

/** A gating human_input task carrying its captured request payload. */
function gatedHumanInput(taskName: string): DerivedTaskState {
  return {
    taskName,
    taskKind: WorkflowTaskKind.human_input,
    status: "waiting_approval",
    durationMs: 0,
    costMicros: 0n,
    tokensUsed: 0n,
    attemptNumber: 1,
    error: "",
    childExecutionId: "",
    agentSlug: "",
    currentToolName: "",
    messagesCount: 0,
    toolCallsCount: 0,
    inputSummary: null,
    outputSummary: null,
    approvalRequest: create(ApprovalRequestedPayloadSchema, {
      prompt: "Ship the release?",
      outcomes: [
        { name: "ship", label: "Ship It" },
        { name: "hold", label: "Hold" },
      ],
    }),
    approvalResolution: null,
  } as DerivedTaskState;
}

function statesOf(...states: DerivedTaskState[]): ReadonlyMap<string, DerivedTaskState> {
  return new Map(states.map((s) => [s.taskName, s]));
}

function submitShipIt(): void {
  const form = screen.getByRole("form", {
    name: "Approval decision for review-gate",
  });
  fireEvent.click(within(form).getByRole("button", { name: "Ship It" }));
}

describe("WorkflowTaskThread — scroll-on-send (stigmer-cloud#267)", () => {
  it("pins the thread when a HITL decision is submitted, then delegates to the workflow-level submit (default-on)", () => {
    const hitl = makeHitl();
    render(
      <WorkflowTaskThread
        taskStates={statesOf(gatedHumanInput("review-gate"))}
        totalTasks={1}
        isRunning
        hitl={hitl}
      />,
    );
    expect(jumpToLatestSpy).not.toHaveBeenCalled();

    submitShipIt();

    expect(jumpToLatestSpy).toHaveBeenCalledTimes(1);
    expect(hitl.submitTaskApproval).toHaveBeenCalledWith(
      "review-gate",
      "ship",
      undefined,
      undefined,
    );
  });

  it("never pins with scrollOnSend={false} — the decision still routes through unchanged", () => {
    const hitl = makeHitl();
    render(
      <WorkflowTaskThread
        taskStates={statesOf(gatedHumanInput("review-gate"))}
        totalTasks={1}
        isRunning
        hitl={hitl}
        scrollOnSend={false}
      />,
    );

    submitShipIt();

    expect(jumpToLatestSpy).not.toHaveBeenCalled();
    expect(hitl.submitTaskApproval).toHaveBeenCalledWith(
      "review-gate",
      "ship",
      undefined,
      undefined,
    );
  });
});
