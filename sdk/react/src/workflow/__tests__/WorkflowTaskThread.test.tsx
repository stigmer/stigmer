// Behavior tests for the WorkflowTaskThread organism: progress header,
// per-variant card previews, the expand gesture (T06: headers expand or are
// plain rows — selection died with the Inspect drill-down), the inline
// AGENT_CALL transcript body (T07), empty states (DD-006), and the
// in-thread HITL section (S10/T06 — the in-card human_input review gate).
//
// GUARDRAIL (S5 rationale): the entire file renders WITHOUT a StigmerProvider.
// Any component reaching for a client hook (the child's agentExecution.*
// submit path) would throw — so a passing render plus the hitl spies
// receiving decisions proves in-card gates route through the WORKFLOW-level
// wiring only. (WorkflowAgentCallTranscript streams its child itself and
// therefore NEEDS the provider — it is stubbed at the module seam here; its
// own suite covers the real transcript rendering, viewport gating, and RPC
// routing. The review gate's inline-payload path is provider-free by design
// — useReviewPayload touches the client only for artifact-backed payloads —
// so the human_input tests exercise the REAL gate.)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  ApprovalRequestedPayloadSchema,
  ApprovalResolvedPayloadSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";
import type { WorkflowAgentCallTranscriptProps } from "../WorkflowAgentCallTranscript";
import { formatMetaChips } from "../format-utils";
import { WorkflowTaskThread, type WorkflowThreadHitl } from "../thread/WorkflowTaskThread";

// Streams its child (needs the provider this guardrail file deliberately
// omits) — stubbed to prove the card-side seam: which child it is bound
// to, whether the hitl bundle reached it, and the pop-out wiring. The real
// component's behavior lives in WorkflowAgentCallTranscript.test.tsx.
vi.mock("../WorkflowAgentCallTranscript", () => ({
  WorkflowAgentCallTranscript: vi.fn(
    ({
      childExecutionId,
      agentSlug,
      hitl,
      onNavigateToAgentExecution,
    }: WorkflowAgentCallTranscriptProps) => (
      <div
        data-testid="agent-call-transcript-probe"
        data-child-id={childExecutionId}
        data-agent-slug={agentSlug ?? ""}
        data-interactive={hitl ? "true" : "false"}
      >
        {onNavigateToAgentExecution && (
          <button
            type="button"
            onClick={() => onNavigateToAgentExecution(childExecutionId)}
          >
            probe-pop-out-{childExecutionId}
          </button>
        )}
      </div>
    ),
  ),
}));
import { WorkflowAgentCallTranscript } from "../WorkflowAgentCallTranscript";

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

  it("renders the child's inline transcript as an AGENT_CALL card's body — no button, no I/O summary (T07)", () => {
    const onNavigateToAgentExecution = vi.fn();
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
        onNavigateToAgentExecution={onNavigateToAgentExecution}
        taskSnapshotsByName={
          new Map([
            [
              "call-writer",
              {
                taskName: "call-writer",
                // The old summary body's source — must NOT render (T07):
                // the transcript IS the body.
                output: { agent_execution_id: "aex_child_1", final_text: "done" },
                artifactIds: [],
              } as unknown as WorkflowTask,
            ],
          ])
        }
      />,
    );

    // The card body IS the child transcript, bound to the right child…
    const probe = screen.getByTestId("agent-call-transcript-probe");
    expect(probe.getAttribute("data-child-id")).toBe("aex_child_1");
    expect(probe.getAttribute("data-agent-slug")).toBe("blog-writer");
    // …with no expand chevron, no launcher button, and none of the old
    // id/final_text summary Struct.
    expect(screen.queryByRole("button", { name: "Expand call-writer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open transcript" })).toBeNull();
    expect(screen.queryByText("Output")).toBeNull();
    expect(screen.queryByText(/final_text|done/)).toBeNull();

    // The deep-dive pop-out routes through the host's navigation.
    fireEvent.click(screen.getByText("probe-pop-out-aex_child_1"));
    expect(onNavigateToAgentExecution).toHaveBeenCalledWith("aex_child_1");
  });

  it("falls back to the generic error body for an AGENT_CALL that failed before spawning a child (T07)", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({
            taskName: "call-broken",
            taskKind: WorkflowTaskKind.agent_call,
            status: "failed",
            childExecutionId: "", // never spawned — agent resolution failed
            error: "agent not found: org/missing-agent\nresolution trace",
          }),
        )}
        totalTasks={1}
        isRunning={false}
      />,
    );

    // No child → no transcript to render…
    expect(screen.queryByTestId("agent-call-transcript-probe")).toBeNull();
    // …but the failure must still surface in full (the correctness case).
    expect(screen.getByText(/resolution trace/)).toBeTruthy();
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

describe("WorkflowTaskThread — in-thread HITL (S10/T07)", () => {
  it("hands the hitl bundle to a GATING agent-call card's transcript — the child's gates decide inside it (T07)", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(gatedAgentCall("call-helper", "aex_1"))}
        totalTasks={1}
        isRunning
        hitl={makeHitl()}
      />,
    );

    // No separate HITL section, no "waiting for approval" interstitial —
    // the transcript IS the decision surface, and it became interactive.
    const probe = screen.getByTestId("agent-call-transcript-probe");
    expect(probe.getAttribute("data-child-id")).toBe("aex_1");
    expect(probe.getAttribute("data-interactive")).toBe("true");
    expect(screen.queryByText(/waiting for an approval/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Expand call-helper" }),
    ).toBeNull();
  });

  it("keeps a NON-gating agent-call transcript read-only (the hitl scoping)", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          taskState({
            taskName: "call-writer",
            taskKind: WorkflowTaskKind.agent_call,
            status: "running",
            childExecutionId: "aex_2",
          }),
        )}
        totalTasks={1}
        isRunning
        hitl={makeHitl()}
      />,
    );

    // The thread scopes the bundle to waiting_approval cards only (DD-010),
    // so a merely-running child's transcript stays read-only.
    expect(
      screen
        .getByTestId("agent-call-transcript-probe")
        .getAttribute("data-interactive"),
    ).toBe("false");
  });

  it("binds each parallel gating child to its own card's transcript", () => {
    const { container } = render(
      <WorkflowTaskThread
        taskStates={statesOf(
          gatedAgentCall("call-a", "aex_a"),
          gatedAgentCall("call-b", "aex_b"),
        )}
        totalTasks={2}
        isRunning
        hitl={makeHitl()}
      />,
    );

    const probeIn = (taskName: string) =>
      within(cardRootOf(container, taskName)).getByTestId(
        "agent-call-transcript-probe",
      );
    expect(probeIn("call-a").getAttribute("data-child-id")).toBe("aex_a");
    expect(probeIn("call-b").getAttribute("data-child-id")).toBe("aex_b");
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

  it("stays read-only when hitl is omitted (DD-011), even while gating", () => {
    render(
      <WorkflowTaskThread
        taskStates={statesOf(
          gatedAgentCall("call-helper", "aex_1"),
          gatedHumanInput("review-gate"),
        )}
        totalTasks={2}
        isRunning
      />,
    );

    expect(
      screen
        .getByTestId("agent-call-transcript-probe")
        .getAttribute("data-interactive"),
    ).toBe("false");
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("re-renders only the gating card when gate state churns (sibling memo probe)", () => {
    const taskStates = statesOf(
      // Distinctive metrics make the settled card's formatMetaChips calls
      // uniquely identifiable in the probe's call log.
      taskState({ taskName: "settled", durationMs: 7_777 }),
      gatedAgentCall("call-helper", "aex_1"),
    );

    const { rerender } = render(
      <WorkflowTaskThread
        taskStates={taskStates}
        totalTasks={2}
        isRunning
        hitl={makeHitl()}
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
      />,
    );

    const renderedDurations = probe.mock.calls.map((c) => c[0]?.durationMs);
    // The gating card re-rendered (its spinner state moved)…
    expect(renderedDurations).toContain(0);
    // …but the settled sibling bailed (DD-009/DD-010).
    expect(renderedDurations).not.toContain(7_777);
  });

  it("hands the churned hitl bundle through to the gating transcript (T07)", () => {
    const taskStates = statesOf(gatedAgentCall("call-helper", "aex_1"));
    const { rerender } = render(
      <WorkflowTaskThread
        taskStates={taskStates}
        totalTasks={1}
        isRunning
        hitl={makeHitl()}
      />,
    );

    const transcriptProbe = vi.mocked(WorkflowAgentCallTranscript);
    transcriptProbe.mockClear();
    const churned = makeHitl({
      approvalSubmittingToolCallIds: new Set(["tc-1"]),
    });
    rerender(
      <WorkflowTaskThread
        taskStates={taskStates}
        totalTasks={1}
        isRunning
        hitl={churned}
      />,
    );

    // The in-flight Set must reach the transcript so the gate's spinner
    // shows inside it — the bundle is passed through by reference.
    const latest = transcriptProbe.mock.calls.at(-1)![0];
    expect(latest.hitl?.approvalSubmittingToolCallIds).toBe(
      churned.approvalSubmittingToolCallIds,
    );
  });
});
