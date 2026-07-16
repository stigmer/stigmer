// Behavior tests for the WorkflowTaskThread organism: progress header,
// per-variant card previews, the select and expand gestures, the AGENT_CALL
// transcript affordance (D-T02-2), empty states (DD-006), and the in-thread
// HITL section (S10).
//
// GUARDRAIL (S5 rationale): the entire file renders WITHOUT a StigmerProvider.
// Any component reaching for a client hook (the child's agentExecution.*
// submit path) would throw — so a passing render plus the hitl spies
// receiving decisions proves in-card gates route through the WORKFLOW-level
// wiring only. (WorkflowFileReviewList streams its child itself and therefore
// NEEDS the provider — it is stubbed at the module seam here; its own suite
// covers the real child-derived rendering.)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import {
  WorkflowPendingApprovalSchema,
  WorkflowPendingFileReviewSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import type {
  WorkflowPendingApproval,
  WorkflowPendingFileReview,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";
import type { WorkflowFileDecisionSubmit } from "../WorkflowFileReviewList";
import { formatMetaChips } from "../format-utils";
import { WorkflowTaskThread, type WorkflowThreadHitl } from "../thread/WorkflowTaskThread";

// Streams its child (needs the provider this guardrail file deliberately
// omits) — stubbed to prove the seam: the gating card hands it the
// task-scoped references and the workflow-level decision submit.
vi.mock("../WorkflowFileReviewList", () => ({
  WorkflowFileReviewList: ({
    pendingFileReviews,
    onSubmitFileDecision,
  }: {
    pendingFileReviews: readonly WorkflowPendingFileReview[];
    onSubmitFileDecision: WorkflowFileDecisionSubmit;
  }) => (
    <div data-testid="file-review-list-stub">
      {pendingFileReviews.map((ref) => (
        <button
          key={ref.childAgentExecutionId}
          type="button"
          onClick={() =>
            onSubmitFileDecision(
              ref.childAgentExecutionId,
              ref.changeSetId[0] ?? "",
              1 as never,
            )
          }
        >
          decide-files-{ref.childAgentExecutionId}
        </button>
      ))}
    </div>
  ),
}));

// Spy-wrapped passthrough: every card render calls formatMetaChips with the
// item's own metric fields, so its call log is a per-card render probe (the
// memoized cards have no other module seam to observe bails through).
vi.mock("../format-utils", async (importOriginal) => {
  const original = await importOriginal<typeof import("../format-utils")>();
  return { ...original, formatMetaChips: vi.fn(original.formatMetaChips) };
});

beforeEach(() => {
  // useAutoScroll depends on browser APIs absent in happy-dom.
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function taskState(overrides: Partial<DerivedTaskState> & { taskName: string }): DerivedTaskState {
  return {
    taskKind: WorkflowTaskKind.http_call,
    status: "completed",
    durationMs: 1_500,
    costMicros: 0n,
    tokensUsed: 0n,
    attemptNumber: 1,
    error: "",
    childExecutionId: "",
    agentSlug: "",
    currentToolName: "",
    messagesCount: 0,
    toolCallsCount: 0,
    ...overrides,
  };
}

function statesOf(...states: DerivedTaskState[]): ReadonlyMap<string, DerivedTaskState> {
  return new Map(states.map((s) => [s.taskName, s]));
}

describe("WorkflowTaskThread", () => {
  it("renders the streaming empty state while running with no tasks yet", () => {
    render(
      <WorkflowTaskThread
        taskStates={new Map()}
        totalTasks={0}
        isRunning
        selectedTaskName={null}
      />,
    );
    expect(screen.getByText("Waiting for the first task to start…")).toBeTruthy();
  });

  it("renders the terminal empty state for event-less finished executions", () => {
    render(
      <WorkflowTaskThread
        taskStates={new Map()}
        totalTasks={0}
        isRunning={false}
        selectedTaskName={null}
      />,
    );
    expect(
      screen.getByText("No task activity was recorded for this execution."),
    ).toBeTruthy();
  });

  it("shows progress with total and active counts", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({ taskName: "a", status: "completed" }),
          taskState({ taskName: "b", status: "running" }),
        )}
        totalTasks={5}
        isRunning
        selectedTaskName={null}
      />,
    );
    expect(screen.getByText("1 of 5 tasks")).toBeTruthy();
    expect(screen.getByText("1 active")).toBeTruthy();
  });

  it("renders one card per task in map order with kind labels", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({ taskName: "fetch-data" }),
          taskState({ taskName: "notify", taskKind: WorkflowTaskKind.notification }),
        )}
        totalTasks={2}
        isRunning={false}
        selectedTaskName={null}
      />,
    );
    const cards = screen.getAllByRole("button", { pressed: false });
    expect(cards[0].textContent).toContain("fetch-data");
    expect(cards[0].textContent).toContain("HTTP Call");
    expect(cards[1].textContent).toContain("notify");
    expect(cards[1].textContent).toContain("Notification");
  });

  it("previews the live agent on a running AGENT_CALL card", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({
            taskName: "call-writer",
            taskKind: WorkflowTaskKind.agent_call,
            status: "running",
            agentSlug: "blog-writer",
            currentToolName: "web_search",
            messagesCount: 7,
            toolCallsCount: 3,
          }),
        )}
        totalTasks={1}
        isRunning
        selectedTaskName={null}
      />,
    );
    const card = screen.getByRole("button", { name: /^call-writer/ });
    expect(card.textContent).toContain("blog-writer");
    expect(card.textContent).toContain("running web_search");
    expect(card.textContent).toContain("7 msgs · 3 tools");
  });

  it("previews the first error line on a failed card and shows the attempt count", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({
            taskName: "flaky",
            status: "failed",
            attemptNumber: 3,
            error: "connection refused\nlong stack trace",
          }),
        )}
        totalTasks={1}
        isRunning={false}
        selectedTaskName={null}
      />,
    );
    const card = screen.getByRole("button", { name: /^flaky/ });
    expect(card.textContent).toContain("connection refused");
    expect(card.textContent).not.toContain("long stack trace");
    expect(card.textContent).toContain("attempt 3");
  });

  it("previews waiting approval regardless of variant", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({
            taskName: "review-gate",
            taskKind: WorkflowTaskKind.human_input,
            status: "waiting_approval",
          }),
        )}
        totalTasks={1}
        isRunning
        selectedTaskName={null}
      />,
    );
    expect(
      screen.getByRole("button", { name: /^review-gate/ }).textContent,
    ).toContain("Awaiting approval");
  });

  it("selects on card click and deselects on re-click (graph node contract)", () => {
    const onTaskSelect = vi.fn();
    const { rerender } = render(
      <WorkflowTaskThread
        taskStates={statesOf(taskState({ taskName: "fetch-data" }))}
        totalTasks={1}
        isRunning={false}
        selectedTaskName={null}
        onTaskSelect={onTaskSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^fetch-data/ }));
    expect(onTaskSelect).toHaveBeenLastCalledWith("fetch-data");

    rerender(
      <WorkflowTaskThread
        taskStates={statesOf(taskState({ taskName: "fetch-data" }))}
        totalTasks={1}
        isRunning={false}
        selectedTaskName="fetch-data"
        onTaskSelect={onTaskSelect}
      />,
    );
    const selected = screen.getByRole("button", { name: /^fetch-data/ });
    expect(selected.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(selected);
    expect(onTaskSelect).toHaveBeenLastCalledWith(null);
  });

  it("expands to the detail body and opens the transcript for an AGENT_CALL", () => {
    const onOpenAgentExecution = vi.fn();
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({
            taskName: "call-writer",
            taskKind: WorkflowTaskKind.agent_call,
            status: "completed",
            agentSlug: "blog-writer",
            childExecutionId: "aex_child_1",
            costMicros: 120_000n,
            tokensUsed: 4_200n,
          }),
        )}
        totalTasks={1}
        isRunning={false}
        selectedTaskName={null}
        onOpenAgentExecution={onOpenAgentExecution}
      />,
    );

    const chevron = screen.getByRole("button", { name: "Expand call-writer" });
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(chevron);
    expect(chevron.getAttribute("aria-expanded")).toBe("true");

    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
    // The agent slug appears in the collapsed preview AND the detail's
    // definition list — assert the detail row specifically.
    expect(screen.getByText("Agent").nextElementSibling?.textContent).toBe(
      "blog-writer",
    );

    fireEvent.click(screen.getByRole("button", { name: "Open transcript" }));
    expect(onOpenAgentExecution).toHaveBeenCalledWith("aex_child_1", "call-writer");
  });

  it("shows the full error in the expanded body", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({
            taskName: "flaky",
            status: "failed",
            error: "connection refused\nat dial tcp 10.0.0.1:443",
          }),
        )}
        totalTasks={1}
        isRunning={false}
        selectedTaskName={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand flaky" }));
    expect(screen.getByText(/at dial tcp 10\.0\.0\.1:443/)).toBeTruthy();
  });

  it("keeps a card's expanded state across streaming updates (no remount)", () => {
    const running = () =>
      statesOf(
        taskState({ taskName: "settled" }),
        taskState({ taskName: "live", status: "running", messagesCount: 1 }),
      );
    const { rerender } = render(
      <WorkflowTaskThread
        taskStates={running()}
        totalTasks={2}
        isRunning
        selectedTaskName={null}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand settled" }));
    expect(
      screen
        .getByRole("button", { name: "Collapse settled" })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    // A fresh map (as the store produces per event append) with only the
    // live task changed must not reset the settled card's local state.
    rerender(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({ taskName: "settled" }),
          taskState({ taskName: "live", status: "running", messagesCount: 2 }),
        )}
        totalTasks={2}
        isRunning
        selectedTaskName={null}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "Collapse settled" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("renders a fan-out as overlapping running cards in first-started order (D-T02-1)", () => {
    // The concurrency shape of the fan-out fixture (four branches live at
    // once after prepare settled): the flat model shows parallelism as
    // multiple simultaneously-running cards under an honest progress line.
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({ taskName: "prepare", status: "completed" }),
          taskState({ taskName: "fetch-us", status: "running" }),
          taskState({ taskName: "fetch-eu", status: "running" }),
          taskState({ taskName: "fetch-apac", status: "running" }),
          taskState({ taskName: "fetch-latam", status: "running" }),
        )}
        totalTasks={6}
        isRunning
        selectedTaskName={null}
      />,
    );

    const cards = screen.getAllByRole("button", { pressed: false });
    const expectedOrder = [
      "prepare",
      "fetch-us",
      "fetch-eu",
      "fetch-apac",
      "fetch-latam",
    ];
    expect(cards).toHaveLength(expectedOrder.length);
    expectedOrder.forEach((name, i) => {
      expect(cards[i].textContent?.startsWith(name)).toBe(true);
    });
    expect(screen.getByText("1 of 6 tasks")).toBeTruthy();
    expect(screen.getByText("4 active")).toBeTruthy();
  });

  it("reveals a card selected from outside the thread (shared-selection scroll)", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    const states = statesOf(
      taskState({ taskName: "a" }),
      taskState({ taskName: "b" }),
    );
    const { rerender } = render(
      <WorkflowTaskThread
        taskStates={states}
        totalTasks={2}
        isRunning={false}
        selectedTaskName={null}
      />,
    );
    scrollIntoView.mockClear();

    // Selection arriving via props (graph node, Usage row, gate
    // auto-select) — the newly selected card reveals itself.
    rerender(
      <WorkflowTaskThread
        taskStates={states}
        totalTasks={2}
        isRunning={false}
        selectedTaskName="b"
      />,
    );
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  });

  it("mounts the jump-to-latest affordance (hidden while following)", () => {
    const { container } = render(
      <WorkflowTaskThread
        taskStates={statesOf(taskState({ taskName: "a" }))}
        totalTasks={1}
        isRunning
        selectedTaskName={null}
      />,
    );
    // Following is the initial auto-scroll state, so the button is mounted
    // but aria-hidden (it fades in only once the user scrolls up) — query
    // by attribute, not by role, since it is out of the a11y tree.
    const button = container.querySelector('[aria-label="Jump to latest"]');
    expect(button).toBeTruthy();
    expect(button?.getAttribute("aria-hidden")).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// In-thread HITL (S10)
// ---------------------------------------------------------------------------

function makeHitl(overrides: Partial<WorkflowThreadHitl> = {}): WorkflowThreadHitl {
  return {
    submitApproval: vi.fn(),
    approvalSubmittingToolCallIds: new Set<string>(),
    approvalErrorsByToolCallId: new Map<string, Error>(),
    submitFileDecision: vi.fn(),
    fileDecisionSubmittingKeys: new Set<string>(),
    fileDecisionErrorsByKey: new Map<string, Error>(),
    ...overrides,
  };
}

function pendingApproval(
  childId: string,
  toolCallId: string,
  toolName = "delete_repository",
): WorkflowPendingApproval {
  return create(WorkflowPendingApprovalSchema, {
    childAgentExecutionId: childId,
    approval: {
      toolCallId,
      toolName,
      message: `Run ${toolName}?`,
      argsPreview: '{"target": "acme/repo"}',
      requestedAt: "2026-07-16T00:00:00Z",
    },
  });
}

function pendingFileReview(
  childId: string,
  changeSetIds: string[] = ["cs-1"],
): WorkflowPendingFileReview {
  return create(WorkflowPendingFileReviewSchema, {
    childAgentExecutionId: childId,
    changeSetId: changeSetIds,
  });
}

/** A gating AGENT_CALL task bound to its child execution. */
function gatedAgentCall(taskName: string, childId: string): DerivedTaskState {
  return taskState({
    taskName,
    taskKind: WorkflowTaskKind.agent_call,
    status: "waiting_approval",
    durationMs: 0,
    childExecutionId: childId,
    agentSlug: "helper",
  });
}

/** The card root element for a task (header row's parent). */
function cardRootOf(taskName: string): HTMLElement {
  const headerButton = screen.getByRole("button", {
    name: new RegExp(`^${taskName}`),
  });
  return headerButton.parentElement!.parentElement! as HTMLElement;
}

describe("WorkflowTaskThread — in-thread HITL (S10)", () => {
  it("renders the canonical ApprovalCard on the gating card, visible WITHOUT expanding, and routes the decision through the workflow-level submit", () => {
    const hitl = makeHitl();
    render(
      <WorkflowTaskThread
        taskStates={statesOf(gatedAgentCall("call-helper", "aex_1"))}
        totalTasks={1}
        isRunning
        selectedTaskName={null}
        hitl={hitl}
        pendingApprovals={[pendingApproval("aex_1", "tc-1")]}
      />,
    );

    // The decision surface is present while the card is COLLAPSED (D-T02-12).
    const chevron = screen.getByRole("button", { name: "Expand call-helper" });
    expect(chevron.getAttribute("aria-expanded")).toBe("false");
    const card = screen.getByRole("alert", {
      name: "Approval required for delete_repository",
    });
    expect(card).toBeTruthy();

    fireEvent.click(within(card).getByRole("button", { name: "Approve" }));
    expect(hitl.submitApproval).toHaveBeenCalledWith(
      "tc-1",
      ApprovalAction.APPROVE,
      undefined,
    );
  });

  it("scopes each gate to its owning card when parallel children gate at once", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          gatedAgentCall("call-a", "aex_a"),
          gatedAgentCall("call-b", "aex_b"),
        )}
        totalTasks={2}
        isRunning
        selectedTaskName={null}
        hitl={makeHitl()}
        pendingApprovals={[
          pendingApproval("aex_a", "tc-a", "tool_for_a"),
          pendingApproval("aex_b", "tc-b", "tool_for_b"),
        ]}
      />,
    );

    expect(
      within(cardRootOf("call-a")).getByRole("alert", {
        name: "Approval required for tool_for_a",
      }),
    ).toBeTruthy();
    expect(
      within(cardRootOf("call-b")).getByRole("alert", {
        name: "Approval required for tool_for_b",
      }),
    ).toBeTruthy();
    expect(
      within(cardRootOf("call-a")).queryByRole("alert", {
        name: "Approval required for tool_for_b",
      }),
    ).toBeNull();
  });

  it("hands the card's file-review references to WorkflowFileReviewList filtered to its child, decisions on the workflow path", () => {
    const hitl = makeHitl();
    render(
      <WorkflowTaskThread
        taskStates={statesOf(gatedAgentCall("call-helper", "aex_1"))}
        totalTasks={1}
        isRunning
        selectedTaskName={null}
        hitl={hitl}
        pendingFileReviews={[
          pendingFileReview("aex_1", ["cs-1"]),
          // Another child's reference must NOT reach this card's list.
          pendingFileReview("aex_other", ["cs-9"]),
        ]}
      />,
    );

    const stub = screen.getByTestId("file-review-list-stub");
    expect(within(stub).getByText("decide-files-aex_1")).toBeTruthy();
    expect(within(stub).queryByText("decide-files-aex_other")).toBeNull();

    fireEvent.click(within(stub).getByText("decide-files-aex_1"));
    expect(hitl.submitFileDecision).toHaveBeenCalledWith("aex_1", "cs-1", 1);
  });

  it("renders a task-level gate as the Open review affordance (select, not toggle)", () => {
    const onTaskSelect = vi.fn();
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({
            taskName: "review-gate",
            taskKind: WorkflowTaskKind.human_input,
            status: "waiting_approval",
            durationMs: 0,
          }),
        )}
        totalTasks={1}
        isRunning
        selectedTaskName="review-gate"
        onTaskSelect={onTaskSelect}
        hitl={makeHitl()}
      />,
    );

    expect(screen.getByText("Review required to continue this run.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open review" }));
    // Even though the card is ALREADY selected, the affordance re-selects
    // (never deselects): re-opening a closed panel must always work.
    expect(onTaskSelect).toHaveBeenCalledWith("review-gate");
  });

  it("offers the child transcript when an agent-call gates with no surfaced snapshot gates (the cloud refetch window / the OSS steady state)", () => {
    const onOpenAgentExecution = vi.fn();
    render(
      <WorkflowTaskThread
        taskStates={statesOf(gatedAgentCall("call-helper", "aex_1"))}
        totalTasks={1}
        isRunning
        selectedTaskName={null}
        onOpenAgentExecution={onOpenAgentExecution}
        hitl={makeHitl()}
        pendingApprovals={[]}
        pendingFileReviews={[]}
      />,
    );

    expect(
      screen.getByText(/The called agent is waiting for an approval/),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open transcript" }));
    expect(onOpenAgentExecution).toHaveBeenCalledWith("aex_1", "call-helper");
  });

  it("stays read-only when hitl is omitted (DD-011), even with gates surfaced", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          gatedAgentCall("call-helper", "aex_1"),
          taskState({
            taskName: "review-gate",
            taskKind: WorkflowTaskKind.human_input,
            status: "waiting_approval",
            durationMs: 0,
          }),
        )}
        totalTasks={2}
        isRunning
        selectedTaskName={null}
        pendingApprovals={[pendingApproval("aex_1", "tc-1")]}
      />,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open review" })).toBeNull();
    expect(screen.queryByText(/waiting for an approval/)).toBeNull();
  });

  it("surfaces a gate's failed decision in-card, keyed to its toolCallId", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(gatedAgentCall("call-helper", "aex_1"))}
        totalTasks={1}
        isRunning
        selectedTaskName={null}
        hitl={makeHitl({
          approvalErrorsByToolCallId: new Map([
            ["tc-1", new Error("boom-42: gate submit failed")],
          ]),
        })}
        pendingApprovals={[pendingApproval("aex_1", "tc-1")]}
      />,
    );

    expect(screen.getByText(/boom-42: gate submit failed/)).toBeTruthy();
  });

  it("re-renders only the gating card when gate state churns (sibling memo probe)", () => {
    const taskStates = statesOf(
      // Distinctive metrics make the settled card's formatMetaChips calls
      // uniquely identifiable in the probe's call log.
      taskState({ taskName: "settled", durationMs: 7_777 }),
      gatedAgentCall("call-helper", "aex_1"),
    );
    const approvals = [pendingApproval("aex_1", "tc-1")];

    const { rerender } = render(
      <WorkflowTaskThread
        taskStates={taskStates}
        totalTasks={2}
        isRunning
        selectedTaskName={null}
        hitl={makeHitl()}
        pendingApprovals={approvals}
      />,
    );

    const probe = vi.mocked(formatMetaChips);
    probe.mockClear();

    // A decision goes in flight: the actions hook re-materializes the bundle
    // (fresh submitting Set) — exactly the churn streaming decisions cause.
    rerender(
      <WorkflowTaskThread
        taskStates={taskStates}
        totalTasks={2}
        isRunning
        selectedTaskName={null}
        hitl={makeHitl({ approvalSubmittingToolCallIds: new Set(["tc-1"]) })}
        pendingApprovals={approvals}
      />,
    );

    const renderedDurations = probe.mock.calls.map((c) => c[0]?.durationMs);
    // The gating card re-rendered (its spinner state moved)…
    expect(renderedDurations).toContain(0);
    // …but the settled sibling bailed (DD-009/DD-010).
    expect(renderedDurations).not.toContain(7_777);
  });
});
