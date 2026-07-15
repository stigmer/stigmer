import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  ApprovalAction,
  DiffCompleteness,
  ExecutionPhase,
  FileChangeKind,
  FileChangeSetStatus,
  FileDecisionAction,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  CapturedFileChangeSchema,
  FileChangeSetSchema,
  type FileChangeSet,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import { FileContentSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { Stigmer } from "@stigmer/sdk";

vi.mock("../../execution/useLiveAgentExecution", () => ({
  useLiveAgentExecution: vi.fn(),
}));
// The thread is the execution domain's heaviest organism; the document's
// contract with it is props-shaped, so a probe recording them suffices.
// The FileReviewDock renders REAL — its decision routing is the S5 subject.
vi.mock("../../execution/MessageThread", () => ({
  MessageThread: vi.fn(() => <div data-testid="message-thread-probe" />),
}));

import { useLiveAgentExecution } from "../../execution/useLiveAgentExecution";
import { MessageThread } from "../../execution/MessageThread";
import { StigmerContext } from "../../context";
import { useWorkflowExecutionActions } from "../useWorkflowExecutionActions";
import {
  WorkflowAgentExecutionDocument,
  type WorkflowAgentExecutionHitl,
} from "../WorkflowAgentExecutionDocument";

const mockUseLiveAgentExecution = vi.mocked(useLiveAgentExecution);
const mockMessageThread = vi.mocked(MessageThread);

function executionFixture(
  id: string,
  phase: ExecutionPhase,
  fileChangeSets: readonly FileChangeSet[] = [],
): AgentExecution {
  const exec = create(AgentExecutionSchema);
  exec.metadata = create(ApiResourceMetadataSchema, { id });
  exec.status = create(AgentExecutionStatusSchema, {
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
function hitlStub(): WorkflowAgentExecutionHitl & {
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
  overrides: Partial<ReturnType<typeof useLiveAgentExecution>> = {},
): ReturnType<typeof useLiveAgentExecution> {
  return {
    execution: null,
    phase: ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED,
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
});

afterEach(cleanup);

describe("WorkflowAgentExecutionDocument", () => {
  it("renders a live transcript with the Live indicator while streaming", () => {
    const running = executionFixture("aex_1", ExecutionPhase.EXECUTION_IN_PROGRESS);
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        execution: running,
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        isStreaming: true,
      }),
    );

    render(
      <WorkflowAgentExecutionDocument
        childExecutionId="aex_1"
        taskName="summarize-report"
        agentSlug="analyst"
      />,
    );

    expect(mockUseLiveAgentExecution).toHaveBeenCalledWith("aex_1");
    expect(screen.getByTestId("message-thread-probe")).toBeTruthy();
    expect(screen.getByText("Live")).toBeTruthy();
    expect(screen.getByText("summarize-report")).toBeTruthy();
    expect(screen.getByText("analyst")).toBeTruthy();

    const threadProps = mockMessageThread.mock.calls[0][0];
    expect(threadProps.activeStreamExecution).toBe(running);
  });

  it("is read-only without hitl: no thread handlers, no records, no dock (DD-011)", () => {
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        execution: executionFixture(
          "aex_1",
          ExecutionPhase.EXECUTION_IN_PROGRESS,
          [pendingChangeSet("cs-1")],
        ),
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        isStreaming: true,
      }),
    );

    render(
      <WorkflowAgentExecutionDocument childExecutionId="aex_1" taskName="t" />,
    );

    // The pre-S5 contract, preserved as the omitted-prop default: a host
    // composing the document without workflow actions gets an honest
    // status-only transcript — even with a pending set on the child.
    const threadProps = mockMessageThread.mock.calls[0][0];
    expect(threadProps.onApprovalSubmit).toBeUndefined();
    expect(threadProps.submittingApprovalIds).toBeUndefined();
    expect(threadProps.showFileReviewRecords).toBe(false);
    expect(
      document.querySelector('[data-cursor-target="file-review-dock"]'),
    ).toBeNull();
  });

  it("renders a terminal transcript with the phase badge and no Live indicator", () => {
    const done = executionFixture("aex_2", ExecutionPhase.EXECUTION_COMPLETED);
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({ execution: done, phase: ExecutionPhase.EXECUTION_COMPLETED }),
    );

    render(
      <WorkflowAgentExecutionDocument childExecutionId="aex_2" taskName="t" />,
    );

    expect(screen.getByTestId("message-thread-probe")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Completed" })).toBeTruthy();
    expect(screen.queryByText("Live")).toBeNull();
  });

  it("shows a Reconnecting affordance during a transient stream drop", () => {
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        execution: executionFixture("aex_3", ExecutionPhase.EXECUTION_IN_PROGRESS),
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        isReconnecting: true,
      }),
    );

    render(
      <WorkflowAgentExecutionDocument childExecutionId="aex_3" taskName="t" />,
    );

    expect(screen.getByText("Reconnecting…")).toBeTruthy();
    // The last snapshot stays visible through the drop.
    expect(screen.getByTestId("message-thread-probe")).toBeTruthy();
  });

  it("shows the loading skeleton before the first snapshot", () => {
    mockUseLiveAgentExecution.mockReturnValue(hookState({ isLoading: true }));

    render(
      <WorkflowAgentExecutionDocument childExecutionId="aex_4" taskName="t" />,
    );

    expect(screen.getByLabelText("Loading conversation")).toBeTruthy();
    expect(screen.queryByTestId("message-thread-probe")).toBeNull();
  });

  it("surfaces an error with a Retry wired to reconnect()", () => {
    const reconnect = vi.fn();
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({ error: new Error("stream exhausted retries"), reconnect }),
    );

    render(
      <WorkflowAgentExecutionDocument childExecutionId="aex_5" taskName="t" />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "stream exhausted retries",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reconnect).toHaveBeenCalledTimes(1);
  });

  it("renders an honest not-found notice when the execution no longer exists", () => {
    mockUseLiveAgentExecution.mockReturnValue(hookState());

    render(
      <WorkflowAgentExecutionDocument childExecutionId="aex_6" taskName="t" />,
    );

    expect(
      screen.getByText("This agent execution is no longer available."),
    ).toBeTruthy();
    expect(screen.queryByTestId("message-thread-probe")).toBeNull();
  });

  it("fires the standalone pop-out with the child execution id", () => {
    const navigate = vi.fn();
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        execution: executionFixture("aex_7", ExecutionPhase.EXECUTION_COMPLETED),
        phase: ExecutionPhase.EXECUTION_COMPLETED,
      }),
    );

    render(
      <WorkflowAgentExecutionDocument
        childExecutionId="aex_7"
        taskName="t"
        onNavigateToAgentExecution={navigate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Open standalone/ }));
    expect(navigate).toHaveBeenCalledWith("aex_7");
  });

  it("omits the pop-out when the host provides no navigation", () => {
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        execution: executionFixture("aex_8", ExecutionPhase.EXECUTION_COMPLETED),
        phase: ExecutionPhase.EXECUTION_COMPLETED,
      }),
    );

    render(
      <WorkflowAgentExecutionDocument childExecutionId="aex_8" taskName="t" />,
    );

    expect(screen.queryByRole("button", { name: /Open standalone/ })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// S5 — in-place HITL (interactive transcript)
// ---------------------------------------------------------------------------

describe("WorkflowAgentExecutionDocument — HITL wiring (S5)", () => {
  it("threads the workflow approval handlers into the MessageThread", () => {
    const hitl = hitlStub();
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        execution: executionFixture("aex_1", ExecutionPhase.EXECUTION_IN_PROGRESS),
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        isStreaming: true,
      }),
    );

    render(
      <WorkflowAgentExecutionDocument
        childExecutionId="aex_1"
        taskName="t"
        hitl={hitl}
      />,
    );

    // Identity, not equivalence: the thread must submit through the SAME
    // workflow-level handler the bottom Approvals tab uses, so in-flight and
    // error state can never fork between the two surfaces.
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
        execution: executionFixture(
          "aex_1",
          ExecutionPhase.EXECUTION_IN_PROGRESS,
          [pendingChangeSet("cs-1")],
        ),
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        isStreaming: true,
      }),
    );

    render(
      <WorkflowAgentExecutionDocument
        childExecutionId="aex_1"
        taskName="t"
        hitl={hitl}
      />,
    );

    // The real dock renders (region + accessible label), pinned in the
    // document rather than in-thread.
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
        execution: executionFixture(
          "aex_1",
          ExecutionPhase.EXECUTION_FAILED,
          [pendingChangeSet("cs-1")],
        ),
        phase: ExecutionPhase.EXECUTION_FAILED,
      }),
    );

    render(
      <WorkflowAgentExecutionDocument
        childExecutionId="aex_1"
        taskName="t"
        hitl={hitlStub()}
      />,
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
        execution: executionFixture(
          "aex_1",
          ExecutionPhase.EXECUTION_IN_PROGRESS,
          [settled, empty],
        ),
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        isStreaming: true,
      }),
    );

    render(
      <WorkflowAgentExecutionDocument
        childExecutionId="aex_1"
        taskName="t"
        hitl={hitlStub()}
      />,
    );

    expect(
      document.querySelector('[data-cursor-target="file-review-dock"]'),
    ).toBeNull();
  });

  it("holds React.memo across parent re-renders with a stable hitl ref, and re-renders on in-flight churn", () => {
    const hitl = hitlStub();
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        execution: executionFixture("aex_1", ExecutionPhase.EXECUTION_IN_PROGRESS),
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        isStreaming: true,
      }),
    );

    const props = {
      childExecutionId: "aex_1",
      taskName: "t",
      hitl,
    } as const;
    const { rerender } = render(<WorkflowAgentExecutionDocument {...props} />);
    const rendersAfterMount = mockMessageThread.mock.calls.length;

    // Same refs (the viewer's memoized bundle) → memo bails, no thread render.
    // This is what keeps unrelated viewer churn (a lifecycle action's
    // isSubmitting flip) out of an open transcript (DD-010).
    rerender(<WorkflowAgentExecutionDocument {...props} />);
    expect(mockMessageThread.mock.calls.length).toBe(rendersAfterMount);

    // A gate going in-flight produces a NEW submitting set → the transcript
    // (and only then) re-renders, delivering the set to the thread.
    const submitting: WorkflowAgentExecutionHitl = {
      ...hitl,
      approvalSubmittingToolCallIds: new Set(["tc-1"]),
    };
    rerender(<WorkflowAgentExecutionDocument {...props} hitl={submitting} />);
    expect(mockMessageThread.mock.calls.length).toBeGreaterThan(rendersAfterMount);
    const latest = mockMessageThread.mock.calls.at(-1)![0];
    expect(latest.submittingApprovalIds).toBe(submitting.approvalSubmittingToolCallIds);
  });

  it("keeps the thread below the header and the dock below the thread", () => {
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        execution: executionFixture(
          "aex_1",
          ExecutionPhase.EXECUTION_IN_PROGRESS,
          [pendingChangeSet("cs-1")],
        ),
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        isStreaming: true,
      }),
    );

    render(
      <WorkflowAgentExecutionDocument
        childExecutionId="aex_1"
        taskName="t"
        hitl={hitlStub()}
      />,
    );

    // The dock is a SIBLING after the thread's wrapper (the fixed strip at
    // the document bottom), never inside the scroll container where it
    // could scroll out of view.
    const thread = screen.getByTestId("message-thread-probe");
    const dock = document.querySelector('[data-cursor-target="file-review-dock"]')!;
    expect(dock.contains(thread)).toBe(false);
    expect(
      thread.compareDocumentPosition(dock) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// S5 — routing guardrail: decisions go through the WORKFLOW RPCs
// ---------------------------------------------------------------------------

/**
 * Integration-shaped guardrail: the document driven by a REAL
 * `useWorkflowExecutionActions` instance must reach the workflow-scoped RPCs
 * (`workflowExecution.submitApproval` / `submitFileDecision`) and never the
 * child's own `agentExecution.*` submit path. The two are server-equivalent
 * but check different authorization (workflow vs. runner-spawned child) —
 * a refactor that silently reintroduces the child path is a permission bug.
 */
describe("WorkflowAgentExecutionDocument — workflow-RPC routing", () => {
  const wfSubmitApproval = vi.fn();
  const wfSubmitFileDecision = vi.fn();
  const agentSubmitApproval = vi.fn();
  const agentSubmitFileDecision = vi.fn();

  function makeMockClient(): Stigmer {
    return {
      workflowExecution: {
        submitApproval: wfSubmitApproval,
        submitFileDecision: wfSubmitFileDecision,
      },
      agentExecution: {
        submitApproval: agentSubmitApproval,
        submitFileDecision: agentSubmitFileDecision,
      },
    } as unknown as Stigmer;
  }

  /** Renders the document exactly as the viewer wires it: hitl from the hook. */
  function Harness({ children: _unused }: { children?: ReactNode }) {
    const actions = useWorkflowExecutionActions("wex-1");
    return (
      <WorkflowAgentExecutionDocument
        childExecutionId="aex_1"
        taskName="t"
        hitl={actions}
      />
    );
  }

  beforeEach(() => {
    wfSubmitApproval.mockResolvedValue({} as never);
    wfSubmitFileDecision.mockResolvedValue({} as never);
  });

  it("routes approvals (incl. SKIP and APPROVE_ALL) and file decisions through workflowExecution.*, never agentExecution.*", async () => {
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        execution: executionFixture(
          "aex_1",
          ExecutionPhase.EXECUTION_IN_PROGRESS,
          [pendingChangeSet("cs-1")],
        ),
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
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
      expect.objectContaining({ executionId: "wex-1", toolCallId: "tc-1", action: ApprovalAction.APPROVE }),
      expect.objectContaining({ executionId: "wex-1", toolCallId: "tc-1", action: ApprovalAction.SKIP }),
      expect.objectContaining({ executionId: "wex-1", toolCallId: "tc-1", action: ApprovalAction.APPROVE_ALL }),
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
        executionId: "wex-1",
        childAgentExecutionId: "aex_1",
        changeSetId: "cs-1",
        expectedDigest: "agg-cs-1",
      }),
    );

    // The guardrail itself.
    expect(agentSubmitApproval).not.toHaveBeenCalled();
    expect(agentSubmitFileDecision).not.toHaveBeenCalled();
  });

  it("delivers a failed submit to the thread as a keyed in-card error, and a retry clears it", async () => {
    // The parent-surfacing race (or any server rejection) must degrade to a
    // retryable in-card error: the keyed map records the failure, the
    // document re-renders and delivers it to the thread (which renders it
    // beside the gate — MessageThread's own tested behavior), and the
    // handler resolves rather than throwing (no error boundary, no teardown).
    mockUseLiveAgentExecution.mockReturnValue(
      hookState({
        execution: executionFixture("aex_1", ExecutionPhase.EXECUTION_IN_PROGRESS),
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
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

    // Retrying the same gate goes back through the workflow RPC and clears
    // the keyed error on success.
    await act(async () => {
      await failedProps.onApprovalSubmit!("tc-1", ApprovalAction.APPROVE);
    });
    const retriedProps = mockMessageThread.mock.calls.at(-1)![0];
    expect(retriedProps.approvalErrors?.has("tc-1")).toBe(false);
    expect(wfSubmitApproval).toHaveBeenCalledTimes(2);
    expect(agentSubmitApproval).not.toHaveBeenCalled();
  });
});
