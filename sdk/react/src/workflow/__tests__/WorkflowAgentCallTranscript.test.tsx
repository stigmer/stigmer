import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import {
  AgentRunSchema,
  AgentRunStatusSchema,
  type AgentRun,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  ApprovalAction,
  DiffCompleteness,
  RunPhase,
  FileChangeKind,
  FileChangeSetStatus,
  FileDecisionAction,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
  type FileChangeSet,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/filereview_pb";
import { FileContentSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/message_pb";
import type { Stigmer } from "@stigmer/sdk";

vi.mock("../../run/useLiveAgentRun", () => ({
  useLiveAgentRun: vi.fn(),
}));
// The thread is the run domain's heaviest organism; the transcript's
// contract with it is props-shaped, so a probe recording them suffices.
// The FileReviewDock renders REAL — its decision routing is under test.
// useInViewport runs REAL over the stubbed IntersectionObserver below, so
// the viewport gate is exercised end-to-end (ref attachment included).
vi.mock("../../run/MessageThread", () => ({
  MessageThread: vi.fn(() => <div data-testid="message-thread-probe" />),
}));

import { useLiveAgentRun } from "../../run/useLiveAgentRun";
import { MessageThread } from "../../run/MessageThread";
import { StigmerContext } from "../../context";
import { useWorkflowRunActions } from "../useWorkflowRunActions";
import {
  WorkflowAgentCallTranscript,
  type WorkflowAgentRunHitl,
} from "../WorkflowAgentCallTranscript";

const mockUseLiveAgentExecution = vi.mocked(useLiveAgentRun);
const mockMessageThread = vi.mocked(MessageThread);

// ---------------------------------------------------------------------------
// IntersectionObserver stub (the useAutoScroll.test pattern) — drives the
// real useInViewport inside the component.
// ---------------------------------------------------------------------------

let ioCallback: IntersectionObserverCallback;
let ioDisconnect: ReturnType<typeof vi.fn>;

function fireIO(isIntersecting: boolean) {
  act(() => {
    ioCallback(
      [{ isIntersecting } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    );
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function executionFixture(
  id: string,
  phase: RunPhase,
  fileChangeSets: readonly FileChangeSet[] = [],
): AgentRun {
  const exec = create(AgentRunSchema);
  exec.metadata = create(ApiResourceMetadataSchema, { id });
  exec.status = create(AgentRunStatusSchema, {
    phase,
    fileChangeSets: [...fileChangeSets],
  });
  return exec;
}

/** An AWAITING_REVIEW set with one reviewable change (the dock's happy path). */
function pendingChangeSet(id: string): FileChangeSet {
  return create(FileChangeSetSchema, {
    id,
    status: FileChangeSetStatus.AWAITING_REVIEW,
    aggregateDigest: `agg-${id}`,
    diffCompleteness: DiffCompleteness.COMPLETE,
    changes: [
      create(CapturedFileChangeSchema, {
        id: `${id}:notes.md`,
        pathBefore: "notes.md",
        pathAfter: "notes.md",
        kind: FileChangeKind.ADD,
        before: create(FileContentSchema, { body: { case: "inline", value: "" } }),
        after: create(FileContentSchema, { body: { case: "inline", value: "# Notes\n" } }),
        fileDigest: "d-notes",
        diffComplete: true,
      }),
    ],
  });
}

/** A hitl bundle of spies — the unit-level stand-in for the viewer's wiring. */
function hitlStub(): WorkflowAgentRunHitl & {
  submitApproval: ReturnType<typeof vi.fn>;
  submitFileDecision: ReturnType<typeof vi.fn>;
} {
  return {
    submitApproval: vi.fn(),
    approvalSubmittingToolCallIds: new Set<string>(),
    approvalErrorsByToolCallId: new Map<string, Error>(),
    submitFileDecision: vi.fn(),
    fileDecisionSubmittingKeys: new Set<string>(),
    fileDecisionErrorsByKey: new Map<string, Error>(),
  };
}

/** The hook's healthy resting shape; spread overrides per scenario. */
function hookState(
  overrides: Partial<ReturnType<typeof useLiveAgentRun>> = {},
): ReturnType<typeof useLiveAgentRun> {
  return {
    run: null,
    phase: RunPhase.RUN_PHASE_UNSPECIFIED,
    isLoading: false,
    isStreaming: false,
    isReconnecting: false,
    error: null,
    reconnect: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  ioDisconnect = vi.fn();
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn((cb: IntersectionObserverCallback) => {
      ioCallback = cb;
      return {
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: ioDisconnect,
        takeRecords: vi.fn(() => []),
        root: null,
        rootMargin: "",
        thresholds: [0],
      };
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Rendering & states
// ---------------------------------------------------------------------------

describe("WorkflowAgentCallTranscript", () => {
  it("renders the child transcript with the streamed execution", () => {
    const running = executionFixture("aex_1", RunPhase.RUN_IN_PROGRESS);
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        run: running,
        phase: RunPhase.RUN_IN_PROGRESS,
        isStreaming: true,
      }),
    );

    render(
      <WorkflowAgentCallTranscript childRunId="aex_1" agentSlug="analyst" />,
    );

    expect(screen.getByTestId("message-thread-probe")).toBeTruthy();
    const threadProps = mockMessageThread.mock.calls[0][0];
    expect(threadProps.activeStreamRun).toBe(running);
    expect(
      screen.getByRole("group", { name: "Transcript of agent analyst" }),
    ).toBeTruthy();
  });

  it("is bounded: the root carries the height cap, never full-height", () => {
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        run: executionFixture("aex_1", RunPhase.RUN_COMPLETED),
        phase: RunPhase.RUN_COMPLETED,
      }),
    );

    render(<WorkflowAgentCallTranscript childRunId="aex_1" />);

    const root = screen.getByRole("group", { name: "Agent transcript" });
    expect(root.className).toContain("stg:max-h-[60vh]");
    expect(root.className).not.toContain("stg:h-full");
  });

  it("is read-only without hitl: no thread handlers, no records, no dock", () => {
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        run: executionFixture(
          "aex_1",
          RunPhase.RUN_IN_PROGRESS,
          [pendingChangeSet("cs-1")],
        ),
        phase: RunPhase.RUN_IN_PROGRESS,
        isStreaming: true,
      }),
    );

    render(<WorkflowAgentCallTranscript childRunId="aex_1" />);

    const threadProps = mockMessageThread.mock.calls[0][0];
    expect(threadProps.onApprovalSubmit).toBeUndefined();
    expect(threadProps.submittingApprovalIds).toBeUndefined();
    expect(threadProps.showFileReviewRecords).toBe(false);
    expect(
      document.querySelector('[data-cursor-target="file-review-dock"]'),
    ).toBeNull();
  });

  it("shows a Reconnecting affordance during a transient stream drop", () => {
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        run: executionFixture("aex_3", RunPhase.RUN_IN_PROGRESS),
        phase: RunPhase.RUN_IN_PROGRESS,
        isReconnecting: true,
      }),
    );

    render(<WorkflowAgentCallTranscript childRunId="aex_3" />);

    expect(screen.getByText("Reconnecting…")).toBeTruthy();
    // The last snapshot stays visible through the drop.
    expect(screen.getByTestId("message-thread-probe")).toBeTruthy();
  });

  it("shows the loading skeleton before the first snapshot", () => {
    mockUseLiveAgentExecution.mockReturnValue(hookState({ isLoading: true }));

    render(<WorkflowAgentCallTranscript childRunId="aex_4" />);

    expect(screen.getByText("Loading conversation")).toBeTruthy();
    expect(screen.queryByTestId("message-thread-probe")).toBeNull();
  });

  it("surfaces an error with a Retry wired to reconnect()", () => {
    const reconnect = vi.fn();
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({ error: new Error("stream exhausted retries"), reconnect }),
    );

    render(<WorkflowAgentCallTranscript childRunId="aex_5" />);

    expect(screen.getByRole("alert").textContent).toContain(
      "stream exhausted retries",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it("renders an honest not-found notice when the execution no longer exists", () => {
    mockUseLiveAgentExecution.mockReturnValue(hookState());

    render(<WorkflowAgentCallTranscript childRunId="aex_6" />);

    expect(
      screen.getByText("This agent run is no longer available."),
    ).toBeTruthy();
    expect(screen.queryByTestId("message-thread-probe")).toBeNull();
  });

  it("fires the standalone pop-out with the child execution id", () => {
    const navigate = vi.fn();
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        run: executionFixture("aex_7", RunPhase.RUN_COMPLETED),
        phase: RunPhase.RUN_COMPLETED,
      }),
    );

    render(
      <WorkflowAgentCallTranscript
        childRunId="aex_7"
        onNavigateToAgentRun={navigate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open standalone/ }));
    expect(navigate).toHaveBeenCalledWith("aex_7");
  });

  it("omits the chrome bar entirely when there is nothing to show", () => {
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        run: executionFixture("aex_8", RunPhase.RUN_COMPLETED),
        phase: RunPhase.RUN_COMPLETED,
      }),
    );

    render(<WorkflowAgentCallTranscript childRunId="aex_8" />);

    expect(screen.queryByRole("button", { name: /Open standalone/ })).toBeNull();
    expect(screen.queryByText("Reconnecting…")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Viewport-gated streaming
// ---------------------------------------------------------------------------

describe("WorkflowAgentCallTranscript — viewport gate", () => {
  it("passes live: false while off-screen and live: true once visible", () => {
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        run: executionFixture("aex_1", RunPhase.RUN_IN_PROGRESS),
        phase: RunPhase.RUN_IN_PROGRESS,
      }),
    );

    render(<WorkflowAgentCallTranscript childRunId="aex_1" />);

    // Before the observer's first callback the card is presumed off-screen:
    // the snapshot fetch runs (the id is always passed) but live is false.
    let lastCall = mockUseLiveAgentExecution.mock.calls.at(-1)!;
    expect(lastCall[0]).toBe("aex_1");
    expect(lastCall[1]).toEqual({ live: false });

    // Scrolled into the (pre-warmed) viewport → the stream may open.
    fireIO(true);
    lastCall = mockUseLiveAgentExecution.mock.calls.at(-1)!;
    expect(lastCall[1]).toEqual({ live: true });

    // Scrolled away → the stream pauses (the hook keeps the last snapshot;
    // its no-rewind behavior is unit-tested in useLiveAgentRun).
    fireIO(false);
    lastCall = mockUseLiveAgentExecution.mock.calls.at(-1)!;
    expect(lastCall[1]).toEqual({ live: false });
  });

  it("disconnects its observer on unmount", () => {
    mockUseLiveAgentExecution.mockReturnValue(hookState());

    const { unmount } = render(
      <WorkflowAgentCallTranscript childRunId="aex_1" />,
    );
    unmount();
    expect(ioDisconnect).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// In-place HITL (migrated from the document tab this replaces)
// ---------------------------------------------------------------------------

describe("WorkflowAgentCallTranscript — HITL wiring", () => {
  it("threads the workflow approval handlers into the MessageThread", () => {
    const hitl = hitlStub();
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        run: executionFixture("aex_1", RunPhase.RUN_IN_PROGRESS),
        phase: RunPhase.RUN_IN_PROGRESS,
        isStreaming: true,
      }),
    );

    render(<WorkflowAgentCallTranscript childRunId="aex_1" hitl={hitl} />);

    // Identity, not equivalence: the thread must submit through the SAME
    // workflow-level handler every other surface uses, so in-flight and
    // error state can never fork.
    const threadProps = mockMessageThread.mock.calls[0][0];
    expect(threadProps.onApprovalSubmit).toBe(hitl.submitApproval);
    expect(threadProps.submittingApprovalIds).toBe(hitl.approvalSubmittingToolCallIds);
    expect(threadProps.approvalErrors).toBe(hitl.approvalErrorsByToolCallId);
    expect(threadProps.showFileReviewRecords).toBe(true);
  });

  it("docks the child's live AWAITING_REVIEW set and routes the decision with the child id bound", () => {
    const hitl = hitlStub();
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        run: executionFixture(
          "aex_1",
          RunPhase.RUN_IN_PROGRESS,
          [pendingChangeSet("cs-1")],
        ),
        phase: RunPhase.RUN_IN_PROGRESS,
        isStreaming: true,
      }),
    );

    render(<WorkflowAgentCallTranscript childRunId="aex_1" hitl={hitl} />);

    expect(
      screen.getByRole("region", { name: "File changes awaiting review" }),
    ).toBeTruthy();

    fireEvent.click(
      document.querySelector<HTMLButtonElement>(
        '[data-cursor-target="file-review-approve"]',
      )!,
    );
    expect(hitl.submitFileDecision).toHaveBeenCalledWith(
      "aex_1",
      "cs-1",
      FileDecisionAction.APPROVE,
      expect.objectContaining({ expectedDigest: "agg-cs-1" }),
    );
  });

  it("never docks on a terminal execution — unreviewed sets are history, not decisions", () => {
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        run: executionFixture(
          "aex_1",
          RunPhase.RUN_FAILED,
          [pendingChangeSet("cs-1")],
        ),
        phase: RunPhase.RUN_FAILED,
      }),
    );

    render(
      <WorkflowAgentCallTranscript childRunId="aex_1" hitl={hitlStub()} />,
    );

    expect(
      document.querySelector('[data-cursor-target="file-review-dock"]'),
    ).toBeNull();
  });

  it("excludes settled and empty sets from the dock", () => {
    const settled = create(FileChangeSetSchema, {
      id: "cs-settled",
      status: FileChangeSetStatus.DECIDED,
      changes: [
        create(CapturedFileChangeSchema, { id: "cs-settled:a", pathAfter: "a" }),
      ],
    });
    const empty = create(FileChangeSetSchema, {
      id: "cs-empty",
      status: FileChangeSetStatus.AWAITING_REVIEW,
      changes: [],
    });
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        run: executionFixture(
          "aex_1",
          RunPhase.RUN_IN_PROGRESS,
          [settled, empty],
        ),
        phase: RunPhase.RUN_IN_PROGRESS,
        isStreaming: true,
      }),
    );

    render(
      <WorkflowAgentCallTranscript childRunId="aex_1" hitl={hitlStub()} />,
    );

    expect(
      document.querySelector('[data-cursor-target="file-review-dock"]'),
    ).toBeNull();
  });

  it("holds React.memo across parent re-renders with a stable hitl ref, and re-renders on in-flight churn", () => {
    const hitl = hitlStub();
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        run: executionFixture("aex_1", RunPhase.RUN_IN_PROGRESS),
        phase: RunPhase.RUN_IN_PROGRESS,
        isStreaming: true,
      }),
    );

    const props = { childRunId: "aex_1", hitl } as const;
    const { rerender } = render(<WorkflowAgentCallTranscript {...props} />);
    const rendersAfterMount = mockMessageThread.mock.calls.length;

    // Same refs (the viewer's memoized bundle) → memo bails, no thread
    // render. This is what keeps unrelated viewer churn out of every
    // mounted transcript.
    rerender(<WorkflowAgentCallTranscript {...props} />);
    expect(mockMessageThread.mock.calls.length).toBe(rendersAfterMount);

    // A gate going in-flight produces a NEW submitting set → the transcript
    // (and only then) re-renders, delivering the set to the thread.
    const submitting: WorkflowAgentRunHitl = {
      ...hitl,
      approvalSubmittingToolCallIds: new Set(["tc-1"]),
    };
    rerender(<WorkflowAgentCallTranscript {...props} hitl={submitting} />);
    expect(mockMessageThread.mock.calls.length).toBeGreaterThan(rendersAfterMount);
    const latest = mockMessageThread.mock.calls.at(-1)![0];
    expect(latest.submittingApprovalIds).toBe(submitting.approvalSubmittingToolCallIds);
  });

  it("keeps the dock below the thread, outside the scroll container", () => {
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        run: executionFixture(
          "aex_1",
          RunPhase.RUN_IN_PROGRESS,
          [pendingChangeSet("cs-1")],
        ),
        phase: RunPhase.RUN_IN_PROGRESS,
        isStreaming: true,
      }),
    );

    render(
      <WorkflowAgentCallTranscript childRunId="aex_1" hitl={hitlStub()} />,
    );

    const thread = screen.getByTestId("message-thread-probe");
    const dock = document.querySelector('[data-cursor-target="file-review-dock"]')!;
    expect(dock.contains(thread)).toBe(false);
    expect(
      thread.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Routing guardrail: decisions go through the WORKFLOW RPCs
// ---------------------------------------------------------------------------

/**
 * Integration-shaped guardrail: the transcript driven by a REAL
 * `useWorkflowRunActions` instance must reach the workflow-scoped RPCs
 * (`workflowRun.submitApproval` / `submitFileDecision`) and never the
 * child's own `agentRun.*` submit path. The two are server-equivalent
 * but check different authorization (workflow vs. runner-spawned child) —
 * a refactor that silently reintroduces the child path is a permission bug.
 */
describe("WorkflowAgentCallTranscript — workflow-RPC routing", () => {
  const wfSubmitApproval = vi.fn();
  const wfSubmitFileDecision = vi.fn();
  const agentSubmitApproval = vi.fn();
  const agentSubmitFileDecision = vi.fn();

  function makeMockClient(): Stigmer {
    return {
      workflowRun: {
        submitApproval: wfSubmitApproval,
        submitFileDecision: wfSubmitFileDecision,
      },
      agentRun: {
        submitApproval: agentSubmitApproval,
        submitFileDecision: agentSubmitFileDecision,
      },
    } as unknown as Stigmer;
  }

  /** Renders the transcript exactly as the viewer wires it: hitl from the hook. */
  function Harness({ children: _unused }: { children?: ReactNode }) {
    const actions = useWorkflowRunActions("wex-1");
    return (
      <WorkflowAgentCallTranscript childRunId="aex_1" hitl={actions} />
    );
  }

  beforeEach(() => {
    wfSubmitApproval.mockResolvedValue({} as never);
    wfSubmitFileDecision.mockResolvedValue({} as never);
  });

  it("routes approvals (incl. SKIP and APPROVE_ALL) and file decisions through workflowRun.*, never agentRun.*", async () => {
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        run: executionFixture(
          "aex_1",
          RunPhase.RUN_IN_PROGRESS,
          [pendingChangeSet("cs-1")],
        ),
        phase: RunPhase.RUN_IN_PROGRESS,
        isStreaming: true,
      }),
    );

    render(
      <StigmerContext.Provider value={makeMockClient()}>
        <Harness />
      </StigmerContext.Provider>,
    );

    // Tool approvals: drive the thread's captured handler for every action
    // the shared ApprovalCard can emit — the workflow RPC forwards the exact
    // (toolCallId, action) pair, so none may be inert or misrouted.
    const threadProps = mockMessageThread.mock.calls.at(-1)![0];
    for (const action of [
      ApprovalAction.APPROVE,
      ApprovalAction.SKIP,
      ApprovalAction.APPROVE_ALL,
    ]) {
      await act(async () => {
        await threadProps.onApprovalSubmit!("tc-1", action, "why");
      });
    }
    expect(wfSubmitApproval).toHaveBeenCalledTimes(3);
    expect(wfSubmitApproval.mock.calls.map((c) => c[0])).toEqual([
      expect.objectContaining({ runId: "wex-1", toolCallId: "tc-1", action: ApprovalAction.APPROVE }),
      expect.objectContaining({ runId: "wex-1", toolCallId: "tc-1", action: ApprovalAction.SKIP }),
      expect.objectContaining({ runId: "wex-1", toolCallId: "tc-1", action: ApprovalAction.APPROVE_ALL }),
    ]);

    // File decision from the dock: workflow RPC, child id routed in the input.
    await act(async () => {
      fireEvent.click(
        document.querySelector<HTMLButtonElement>(
          '[data-cursor-target="file-review-approve"]',
        )!,
      );
    });
    expect(wfSubmitFileDecision).toHaveBeenCalledTimes(1);
    expect(wfSubmitFileDecision.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        runId: "wex-1",
        childAgentRunId: "aex_1",
        changeSetId: "cs-1",
        expectedDigest: "agg-cs-1",
      }),
    );

    // The guardrail itself.
    expect(agentSubmitApproval).not.toHaveBeenCalled();
    expect(agentSubmitFileDecision).not.toHaveBeenCalled();
  });

  it("delivers a failed submit to the thread as a keyed in-card error, and a retry clears it", async () => {
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        run: executionFixture("aex_1", RunPhase.RUN_IN_PROGRESS),
        phase: RunPhase.RUN_IN_PROGRESS,
        isStreaming: true,
      }),
    );
    wfSubmitApproval.mockRejectedValueOnce(
      new Error("no pending approval for tool call"),
    );

    render(
      <StigmerContext.Provider value={makeMockClient()}>
        <Harness />
      </StigmerContext.Provider>,
    );

    const threadProps = mockMessageThread.mock.calls.at(-1)![0];
    await act(async () => {
      await threadProps.onApprovalSubmit!("tc-1", ApprovalAction.APPROVE);
    });

    const failedProps = mockMessageThread.mock.calls.at(-1)![0];
    expect(failedProps.approvalErrors?.get("tc-1")?.message).toBe(
      "no pending approval for tool call",
    );
    expect(failedProps.submittingApprovalIds?.has("tc-1")).toBe(false);

    await act(async () => {
      await failedProps.onApprovalSubmit!("tc-1", ApprovalAction.APPROVE);
    });
    const retriedProps = mockMessageThread.mock.calls.at(-1)![0];
    expect(retriedProps.approvalErrors?.has("tc-1")).toBe(false);
    expect(wfSubmitApproval).toHaveBeenCalledTimes(2);
    expect(agentSubmitApproval).not.toHaveBeenCalled();
  });
});
