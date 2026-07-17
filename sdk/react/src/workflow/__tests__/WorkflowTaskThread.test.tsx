// Behavior tests for the WorkflowTaskThread organism: progress header,
// per-variant card previews, the expand gesture (T06: headers expand or are
// plain rows — selection died with the Inspect drill-down), the AGENT_CALL
// transcript affordance (D-T02-2), empty states (DD-006), and the in-thread
// HITL section (S10/T06 — including the in-card human_input review gate).
//
// GUARDRAIL (S5 rationale): the entire file renders WITHOUT a StigmerProvider.
// Any component reaching for a client hook (the child's agentExecution.*
// submit path) would throw — so a passing render plus the hitl spies
// receiving decisions proves in-card gates route through the WORKFLOW-level
// wiring only. (WorkflowFileReviewList streams its child itself and therefore
// NEEDS the provider — it is stubbed at the module seam here; its own suite
// covers the real child-derived rendering. The review gate's inline-payload
// path is provider-free by design — useReviewPayload touches the client only
// for artifact-backed payloads — so the human_input tests exercise the REAL
// gate.)

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
  WorkflowTask,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
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
    inputSummary: null,
    outputSummary: null,
    approvalRequest: null,
    approvalResolution: null,
    ...overrides,
  };
}

function statesOf(...states: DerivedTaskState[]): ReadonlyMap<string, DerivedTaskState> {
  return new Map(states.map((s) => [s.taskName, s]));
}

/**
 * All card root elements, in thread order. Since T06 a preview-kind card's
 * header is a plain layout row (no role) — the shell's `data-cursor-target`
 * is the stable, gesture-independent handle on a card.
 */
function cardRoots(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      '[data-cursor-target="workflow-task-row"]',
    ),
  );
}

/** The card root whose header names the task. */
function cardRootOf(container: HTMLElement, taskName: string): HTMLElement {
  const root = cardRoots(container).find((el) =>
    el.textContent?.includes(taskName),
  );
  if (!root) throw new Error(`no card rendered for task "${taskName}"`);
  return root;
}

describe("WorkflowTaskThread", () => {
  it("renders the streaming empty state while running with no tasks yet", () => {
    render(
      <WorkflowTaskThread taskStates={new Map()} totalTasks={0} isRunning />,
    );
    expect(screen.getByText("Waiting for the first task to start…")).toBeTruthy();
  });

  it("renders the terminal empty state for event-less finished executions", () => {
    render(
      <WorkflowTaskThread
        taskStates={new Map()}
        totalTasks={0}
        isRunning={false}
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
      />,
    );
    expect(screen.getByText("1 of 5 tasks")).toBeTruthy();
    expect(screen.getByText("1 active")).toBeTruthy();
  });

  it("renders one card per task in map order with kind labels", () => {
    const { container } = render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({ taskName: "fetch-data" }),
          taskState({ taskName: "notify", taskKind: WorkflowTaskKind.notification }),
        )}
        totalTasks={2}
        isRunning={false}
      />,
    );
    const cards = cardRoots(container);
    expect(cards[0].textContent).toContain("fetch-data");
    expect(cards[0].textContent).toContain("HTTP Call");
    expect(cards[1].textContent).toContain("notify");
    expect(cards[1].textContent).toContain("Notification");
  });

  it("previews the live agent on a running AGENT_CALL card", () => {
    const { container } = render(
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
      />,
    );
    const card = cardRootOf(container, "call-writer");
    expect(card.textContent).toContain("blog-writer");
    expect(card.textContent).toContain("running web_search");
    expect(card.textContent).toContain("7 msgs · 3 tools");
  });

  it("previews the first error line on a failed card and shows the attempt count", () => {
    const { container } = render(
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
      />,
    );
    const card = cardRootOf(container, "flaky");
    // The header previews only the first line; the always-visible body of
    // this preview-kind card carries the rest (asserted in its own test).
    expect(within(card).getAllByText(/connection refused/).length).toBeGreaterThan(0);
    expect(card.textContent).toContain("attempt 3");
  });

  it("previews waiting approval regardless of variant", () => {
    const { container } = render(
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
      />,
    );
    expect(cardRootOf(container, "review-gate").textContent).toContain(
      "Awaiting approval",
    );
  });

  it("renders no selection or Inspect affordance — the card IS the surface (T06)", () => {
    const { container } = render(
      <WorkflowTaskThread
        taskStates={statesOf(taskState({ taskName: "fetch-data" }))}
        totalTasks={1}
        isRunning={false}
      />,
    );
    // A preview-kind card renders NO interactive header at all: no
    // aria-pressed select gesture, no magnifier — nothing to click but the
    // body's own affordances.
    expect(screen.queryByRole("button")).toBeNull();
    expect(container.querySelector("[aria-pressed]")).toBeNull();
  });

  it("renders an always-visible preview body for an AGENT_CALL (no chevron, T04) and opens the transcript", () => {
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
        onOpenAgentExecution={onOpenAgentExecution}
      />,
    );

    // Preview-kind cards carry no expand chevron — the body is always
    // visible (the session preview-card model).
    expect(screen.queryByRole("button", { name: "Expand call-writer" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open transcript" }));
    expect(onOpenAgentExecution).toHaveBeenCalledWith("aex_child_1", "call-writer");
  });

  it("renders the task's output in the always-visible body from the snapshot (T04)", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({
            taskName: "check_order",
            taskKind: WorkflowTaskKind.validate,
            status: "completed",
            outputSummary: { valid: true },
          }),
        )}
        totalTasks={1}
        isRunning={false}
        taskSnapshotsByName={
          new Map([
            [
              "check_order",
              {
                taskName: "check_order",
                output: { valid: true, errors: [], data: { total: 120 } },
                artifactIds: [],
              } as unknown as WorkflowTask,
            ],
          ])
        }
      />,
    );

    // The collapsed line names the verdict; the body renders the FULL
    // snapshot output without any expand gesture.
    expect(screen.getByText("valid")).toBeTruthy();
    expect(screen.getByText("Output")).toBeTruthy();
    expect(screen.getByText("Valid")).toBeTruthy(); // humanized key
    // Full-snapshot data — no truncation banner.
    expect(screen.queryByText(/truncated summary/)).toBeNull();
  });

  it("falls back to the truncated event summary with an honesty banner when no snapshot is available (T04)", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({
            taskName: "total",
            taskKind: WorkflowTaskKind.transform,
            status: "completed",
            outputSummary: { result: 42 },
          }),
        )}
        totalTasks={1}
        isRunning={false}
      />,
    );

    expect(screen.getByText("Output")).toBeTruthy();
    expect(screen.getByText(/truncated summary/)).toBeTruthy();
    expect(screen.getByText("Result")).toBeTruthy(); // humanized key
  });

  it("shows the task input in a summary-kind card's chevron detail (T04)", () => {
    // `wait` is one of the few kinds still in summary disclosure after the
    // T05 coverage expansion — the chevron-detail input path lives there.
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({
            taskName: "brief_pause",
            taskKind: WorkflowTaskKind.wait,
            status: "completed",
            inputSummary: { duration: "10s" },
          }),
        )}
        totalTasks={1}
        isRunning={false}
      />,
    );

    // Summary-kind cards expand from the header itself (the session card's
    // own gesture — T06); the detail carries the input.
    const header = screen.getByRole("button", { name: /^brief_pause/ });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(header);
    expect(screen.getByText("Input")).toBeTruthy();
    expect(screen.getByText("10s")).toBeTruthy();
  });

  it("shows the full error in the always-visible body of a failed preview-kind card (T05)", () => {
    // http_call is a preview kind since T05 — a failure needs no expand
    // gesture: the header carries the first line, the body the full error.
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
      />,
    );
    expect(screen.queryByRole("button", { name: "Expand flaky" })).toBeNull();
    expect(screen.getByText(/at dial tcp 10\.0\.0\.1:443/)).toBeTruthy();
  });

  it("shows the full error in a summary-kind card's expanded body", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({
            taskName: "flaky",
            taskKind: WorkflowTaskKind.wait,
            status: "failed",
            error: "connection refused\nat dial tcp 10.0.0.1:443",
          }),
        )}
        totalTasks={1}
        isRunning={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^flaky/ }));
    expect(screen.getByText(/at dial tcp 10\.0\.0\.1:443/)).toBeTruthy();
  });

  it("keeps a card's expanded state across streaming updates (no remount)", () => {
    const running = () =>
      statesOf(
        taskState({ taskName: "settled", taskKind: WorkflowTaskKind.wait }),
        taskState({ taskName: "live", status: "running", messagesCount: 1 }),
      );
    const { rerender } = render(
      <WorkflowTaskThread
        taskStates={running()}
        totalTasks={2}
        isRunning
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^settled/ }));
    expect(
      screen
        .getByRole("button", { name: /^settled/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    // A fresh map (as the store produces per event append) with only the
    // live task changed must not reset the settled card's local state.
    rerender(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({ taskName: "settled", taskKind: WorkflowTaskKind.wait }),
          taskState({ taskName: "live", status: "running", messagesCount: 2 }),
        )}
        totalTasks={2}
        isRunning
      />,
    );
    expect(
      screen
        .getByRole("button", { name: /^settled/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("a streaming append re-renders only the changed card — snapshot-map bodies never invalidate siblings (T04 perf probe)", () => {
    // Both cards are I/O-bearing preview kinds with always-visible bodies
    // fed from the SAME snapshot map. The formatMetaChips spy fires once
    // per card render, so its call log is the per-card render probe.
    const snapshots = new Map<string, WorkflowTask>([
      [
        "settled-check",
        {
          taskName: "settled-check",
          output: { valid: true },
          artifactIds: [],
        } as unknown as WorkflowTask,
      ],
    ]);
    const mkStates = (liveTokens: bigint) =>
      statesOf(
        taskState({
          taskName: "settled-check",
          taskKind: WorkflowTaskKind.validate,
          status: "completed",
          // Distinctive duration → uniquely identifiable in the call log.
          durationMs: 7_777,
        }),
        taskState({
          taskName: "live-llm",
          taskKind: WorkflowTaskKind.llm_call,
          status: "running",
          durationMs: 0,
          tokensUsed: liveTokens,
        }),
      );

    const { rerender } = render(
      <WorkflowTaskThread
        taskStates={mkStates(100n)}
        totalTasks={2}
        isRunning
        taskSnapshotsByName={snapshots}
      />,
    );

    const probe = vi.mocked(formatMetaChips);
    probe.mockClear();
    // A fresh map (as the store produces per event append) touching ONLY
    // the live task. The settled card's item keeps identity (structural
    // sharing), its snapshot lookup is unchanged, so its memo must bail.
    rerender(
      <WorkflowTaskThread
        taskStates={mkStates(200n)}
        totalTasks={2}
        isRunning
        taskSnapshotsByName={snapshots}
      />,
    );

    const renderedDurations = probe.mock.calls.map((c) => c[0]?.durationMs);
    // The live card re-rendered (its token count moved)…
    expect(renderedDurations).toContain(0);
    // …but the settled preview-body card bailed (DD-009/DD-010).
    expect(renderedDurations).not.toContain(7_777);
  });

  it("renders a fan-out as overlapping running cards in first-started order (D-T02-1)", () => {
    // The concurrency shape of the fan-out fixture (four branches live at
    // once after prepare settled): the flat model shows parallelism as
    // multiple simultaneously-running cards under an honest progress line.
    const { container } = render(
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
      />,
    );

    const cards = cardRoots(container);
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

  it("mounts the jump-to-latest affordance (hidden while following)", () => {
    const { container } = render(
      <WorkflowTaskThread
        taskStates={statesOf(taskState({ taskName: "a" }))}
        totalTasks={1}
        isRunning
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
    submitTaskApproval: vi.fn(),
    taskApprovalSubmittingTaskNames: new Set<string>(),
    taskApprovalErrorsByTaskName: new Map<string, Error>(),
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

/**
 * A gating human_input task carrying its captured `approval_requested`
 * payload — the shape the store derives once the gate's event arrives.
 */
function gatedHumanInput(
  taskName: string,
  overrides: Partial<DerivedTaskState> = {},
): DerivedTaskState {
  return taskState({
    taskName,
    taskKind: WorkflowTaskKind.human_input,
    status: "waiting_approval",
    durationMs: 0,
    approvalRequest: create(ApprovalRequestedPayloadSchema, {
      prompt: "Ship the release?",
      outcomes: [
        { name: "ship", label: "Ship It" },
        { name: "hold", label: "Hold" },
      ],
    }),
    ...overrides,
  });
}

describe("WorkflowTaskThread — in-thread HITL (S10)", () => {
  it("renders the canonical ApprovalCard on the gating card, visible WITHOUT expanding, and routes the decision through the workflow-level submit", () => {
    const hitl = makeHitl();
    render(
      <WorkflowTaskThread
        taskStates={statesOf(gatedAgentCall("call-helper", "aex_1"))}
        totalTasks={1}
        isRunning
        hitl={hitl}
        pendingApprovals={[pendingApproval("aex_1", "tc-1")]}
      />,
    );

    // The decision surface is present with no expand gesture at all —
    // agent_call is a preview-kind card and carries no chevron (T04).
    expect(
      screen.queryByRole("button", { name: "Expand call-helper" }),
    ).toBeNull();
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
    const { container } = render(
      <WorkflowTaskThread
        taskStates={statesOf(
          gatedAgentCall("call-a", "aex_a"),
          gatedAgentCall("call-b", "aex_b"),
        )}
        totalTasks={2}
        isRunning
        hitl={makeHitl()}
        pendingApprovals={[
          pendingApproval("aex_a", "tc-a", "tool_for_a"),
          pendingApproval("aex_b", "tc-b", "tool_for_b"),
        ]}
      />,
    );

    expect(
      within(cardRootOf(container, "call-a")).getByRole("alert", {
        name: "Approval required for tool_for_a",
      }),
    ).toBeTruthy();
    expect(
      within(cardRootOf(container, "call-b")).getByRole("alert", {
        name: "Approval required for tool_for_b",
      }),
    ).toBeTruthy();
    expect(
      within(cardRootOf(container, "call-a")).queryByRole("alert", {
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

  it("renders the FULL review gate on a pending human_input card and routes the decision through the workflow-level submit (T06)", () => {
    const hitl = makeHitl();
    render(
      <WorkflowTaskThread
        taskStates={statesOf(gatedHumanInput("review-gate"))}
        totalTasks={1}
        isRunning
        hitl={hitl}
      />,
    );

    // The real decision surface — prompt, configured outcomes — right on
    // the card, no drill-down gesture in between.
    const form = screen.getByRole("form", {
      name: "Approval decision for review-gate",
    });
    expect(within(form).getByText("Ship the release?")).toBeTruthy();

    fireEvent.click(within(form).getByRole("button", { name: "Ship It" }));
    expect(hitl.submitTaskApproval).toHaveBeenCalledWith(
      "review-gate",
      "ship",
      undefined,
      undefined,
    );
  });

  it("degrades to an honest waiting notice when the gate's request payload was never captured (snapshot fallback path)", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({
            taskName: "review-gate",
            taskKind: WorkflowTaskKind.human_input,
            status: "waiting_approval",
            durationMs: 0,
            // No approvalRequest: an event-less mount (terminal snapshot
            // fallback) cannot present review material it does not have.
          }),
        )}
        totalTasks={1}
        isRunning
        hitl={makeHitl()}
      />,
    );

    expect(screen.getByText("Review required to continue this run.")).toBeTruthy();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("reports a resolved gate's decision read-only in the card body — never a second decision surface (T06)", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          gatedHumanInput("review-gate", {
            status: "completed",
            durationMs: 900,
            approvalResolution: create(ApprovalResolvedPayloadSchema, {
              resolvedBy: "alice",
              comment: "LGTM",
              waitDurationMs: 30_000n,
            }),
          }),
        )}
        totalTasks={1}
        isRunning={false}
        hitl={makeHitl()}
        taskSnapshotsByName={
          new Map([
            [
              "review-gate",
              {
                taskName: "review-gate",
                // The canonical decision record: the runner persists the
                // reviewer's response as the task output.
                output: { outcome: "ship", reviewer: "alice", comment: "LGTM" },
                artifactIds: [],
              } as unknown as WorkflowTask,
            ],
          ])
        }
      />,
    );

    // The decision report renders the chosen outcome's configured label…
    expect(screen.getByText("Ship It")).toBeTruthy();
    expect(screen.getByText(/alice/)).toBeTruthy();
    // …and no decision-collecting form is offered again.
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("offers the child transcript when an agent-call gates with no surfaced snapshot gates (the cloud refetch window / the OSS steady state)", () => {
    const onOpenAgentExecution = vi.fn();
    render(
      <WorkflowTaskThread
        taskStates={statesOf(gatedAgentCall("call-helper", "aex_1"))}
        totalTasks={1}
        isRunning
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
          gatedHumanInput("review-gate"),
        )}
        totalTasks={2}
        isRunning
        pendingApprovals={[pendingApproval("aex_1", "tc-1")]}
      />,
    );

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("form")).toBeNull();
    expect(screen.queryByText(/waiting for an approval/)).toBeNull();
  });

  it("surfaces a gate's failed decision in-card, keyed to its toolCallId", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(gatedAgentCall("call-helper", "aex_1"))}
        totalTasks={1}
        isRunning
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
