import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";

vi.mock("../../hooks", () => ({
  useStigmer: vi.fn(),
}));

import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { FileContentSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import {
  CapturedFileChangeSchema,
  FileReviewBaselineCapturedSchema,
  FileReviewCandidateCapturedSchema,
  FileReviewEventSchema,
  FileReviewEventStreamSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/filereview_pb";
import {
  ExecutionPhase,
  FileChangeKind,
  FileReviewEventType,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { WorkflowTaskSchema, type WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowTaskStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { WorkflowTaskKind } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/enum_pb";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store";
import { useStigmer } from "../../hooks";
import {
  agentCallChildrenSignature,
  enumerateAgentCallChildren,
  useWorkflowExecutionFileChanges,
} from "../useWorkflowExecutionFileChanges";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function taskState(
  taskName: string,
  overrides?: Partial<DerivedTaskState>,
): DerivedTaskState {
  return {
    taskName,
    taskKind: WorkflowTaskKind.agent_call,
    status: "completed",
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
    approvalRequest: null,
    approvalResolution: null,
    ...overrides,
  };
}

function statesMap(
  ...states: readonly DerivedTaskState[]
): ReadonlyMap<string, DerivedTaskState> {
  return new Map(states.map((s) => [s.taskName, s]));
}

function taskSnapshot(opts: {
  taskName: string;
  agentExecutionId?: string;
  status?: WorkflowTaskStatus;
  startedAt?: string;
}): WorkflowTask {
  return create(WorkflowTaskSchema, {
    taskName: opts.taskName,
    status: opts.status ?? WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
    startedAt: opts.startedAt ?? "",
    metadata: opts.agentExecutionId
      ? { agent_execution_id: opts.agentExecutionId }
      : {},
  });
}

/**
 * A terminal child whose changes live ONLY in the durable file-review ledger
 * (its live projection is empty) — proving the rollup works from a one-shot
 * `get()` response, not just a live stream projection.
 */
function terminalChildWithLedger(
  id: string,
  path: string,
  before: string,
  after: string,
): AgentExecution {
  const exec = create(AgentExecutionSchema);
  exec.metadata = create(ApiResourceMetadataSchema, { id });
  exec.status = create(AgentExecutionStatusSchema);
  exec.status.phase = ExecutionPhase.EXECUTION_COMPLETED;
  exec.status.fileChangeSets = [];
  const changeSetId = `${id}:0`;
  exec.status.fileReviewEventStream = create(FileReviewEventStreamSchema, {
    executionId: id,
    events: [
      create(FileReviewEventSchema, {
        changeSetId,
        eventType: FileReviewEventType.BASELINE_CAPTURED,
        payload: {
          case: "baselineCaptured",
          value: create(FileReviewBaselineCapturedSchema, { changeSetId }),
        },
      }),
      create(FileReviewEventSchema, {
        changeSetId,
        eventType: FileReviewEventType.CANDIDATE_CAPTURED,
        payload: {
          case: "candidateCaptured",
          value: create(FileReviewCandidateCapturedSchema, {
            changeSetId,
            changes: [
              create(CapturedFileChangeSchema, {
                id: `${id}:fc`,
                pathBefore: path,
                pathAfter: path,
                kind: FileChangeKind.MODIFY,
                before: create(FileContentSchema, { body: { case: "inline", value: before } }),
                after: create(FileContentSchema, { body: { case: "inline", value: after } }),
                diffComplete: true,
              }),
            ],
          }),
        },
      }),
    ],
  });
  return exec;
}

// ---------------------------------------------------------------------------
// enumerateAgentCallChildren
// ---------------------------------------------------------------------------

describe("enumerateAgentCallChildren", () => {
  it("enumerates event-derived children in map insertion order (task chronology) with settled flags", () => {
    const children = enumerateAgentCallChildren(
      statesMap(
        taskState("t1", { childExecutionId: "aex_1", status: "completed" }),
        taskState("t2", { childExecutionId: "aex_2", status: "running" }),
      ),
      undefined,
    );
    expect(children).toEqual([
      { taskName: "t1", childExecutionId: "aex_1", settled: true },
      { taskName: "t2", childExecutionId: "aex_2", settled: false },
    ]);
  });

  it("skips tasks without a child id and dedupes repeated child ids", () => {
    const children = enumerateAgentCallChildren(
      statesMap(
        taskState("http-task", { childExecutionId: "" }),
        taskState("t1", { childExecutionId: "aex_1" }),
        taskState("t1-retry", { childExecutionId: "aex_1" }),
      ),
      undefined,
    );
    expect(children.map((c) => c.childExecutionId)).toEqual(["aex_1"]);
  });

  it("fills gaps from snapshot metadata (the load-bearing fallback), ordered by startedAt", () => {
    // The viewer's fallback task states hardcode childExecutionId: "" when
    // event persistence failed — the snapshot is then the ONLY source.
    const children = enumerateAgentCallChildren(
      statesMap(
        taskState("t-events", { childExecutionId: "aex_events" }),
        taskState("t-late", { childExecutionId: "" }),
        taskState("t-early", { childExecutionId: "" }),
      ),
      [
        taskSnapshot({ taskName: "t-late", agentExecutionId: "aex_late", startedAt: "2026-07-15T10:05:00Z" }),
        taskSnapshot({ taskName: "t-early", agentExecutionId: "aex_early", startedAt: "2026-07-15T10:01:00Z" }),
      ],
    );
    expect(children.map((c) => c.childExecutionId)).toEqual([
      "aex_events",
      "aex_early",
      "aex_late",
    ]);
  });

  it("maps snapshot settled-ness from the task status", () => {
    const children = enumerateAgentCallChildren(
      new Map(),
      [
        taskSnapshot({ taskName: "t1", agentExecutionId: "aex_1", status: WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED }),
        taskSnapshot({ taskName: "t2", agentExecutionId: "aex_2", status: WorkflowTaskStatus.WORKFLOW_TASK_IN_PROGRESS }),
      ],
    );
    expect(children.find((c) => c.childExecutionId === "aex_1")?.settled).toBe(true);
    expect(children.find((c) => c.childExecutionId === "aex_2")?.settled).toBe(false);
  });

  it("never double-adds a task known to events, even when its snapshot also carries the id", () => {
    const children = enumerateAgentCallChildren(
      statesMap(taskState("t1", { childExecutionId: "aex_1", status: "running" })),
      [taskSnapshot({ taskName: "t1", agentExecutionId: "aex_1" })],
    );
    expect(children).toHaveLength(1);
    // The event-derived (live) settled-ness wins — not the stale snapshot's.
    expect(children[0].settled).toBe(false);
  });

  it("excludes snapshot tasks without agent_execution_id metadata (non-agent-call tasks)", () => {
    const children = enumerateAgentCallChildren(new Map(), [
      taskSnapshot({ taskName: "http-task" }),
      taskSnapshot({ taskName: "agent-task", agentExecutionId: "aex_1" }),
    ]);
    expect(children.map((c) => c.taskName)).toEqual(["agent-task"]);
  });
});

describe("agentCallChildrenSignature", () => {
  it("is equal for equal enumerations and changes when a child settles", () => {
    const running = enumerateAgentCallChildren(
      statesMap(taskState("t1", { childExecutionId: "aex_1", status: "running" })),
      undefined,
    );
    const runningAgain = enumerateAgentCallChildren(
      statesMap(taskState("t1", { childExecutionId: "aex_1", status: "running" })),
      undefined,
    );
    const settled = enumerateAgentCallChildren(
      statesMap(taskState("t1", { childExecutionId: "aex_1", status: "completed" })),
      undefined,
    );
    expect(agentCallChildrenSignature(running)).toBe(
      agentCallChildrenSignature(runningAgain),
    );
    expect(agentCallChildrenSignature(running)).not.toBe(
      agentCallChildrenSignature(settled),
    );
  });
});

// ---------------------------------------------------------------------------
// useWorkflowExecutionFileChanges — fetch policy + derivation
// ---------------------------------------------------------------------------

describe("useWorkflowExecutionFileChanges", () => {
  const mockGet = vi.fn();

  beforeEach(() => {
    mockGet.mockReset();
    (useStigmer as ReturnType<typeof vi.fn>).mockReturnValue({
      agentExecution: { get: mockGet },
    });
  });

  function renderChanges(initial: {
    executionId: string | null;
    taskStates: ReadonlyMap<string, DerivedTaskState>;
    taskSnapshots?: readonly WorkflowTask[];
  }) {
    return renderHook(
      (props: typeof initial) => useWorkflowExecutionFileChanges(props),
      { initialProps: initial },
    );
  }

  it("fetches each child once and derives net changes from the folded ledger of a get() response", async () => {
    mockGet.mockImplementation(async (id: string) =>
      terminalChildWithLedger(id, `src/${id}.ts`, "old", "new"),
    );

    const { result } = renderChanges({
      executionId: "wex_1",
      taskStates: statesMap(
        taskState("t1", { childExecutionId: "aex_1" }),
        taskState("t2", { childExecutionId: "aex_2" }),
      ),
    });

    await waitFor(() => expect(result.current.fileChangeCount).toBe(2));
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(result.current.fileChanges.map((c) => c.path)).toEqual([
      "src/aex_1.ts",
      "src/aex_2.ts",
    ]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("does not refetch when the taskStates map identity churns with the same content (signature-keyed)", async () => {
    mockGet.mockImplementation(async (id: string) =>
      terminalChildWithLedger(id, "src/a.ts", "old", "new"),
    );

    const { result, rerender } = renderChanges({
      executionId: "wex_1",
      taskStates: statesMap(taskState("t1", { childExecutionId: "aex_1" })),
    });
    await waitFor(() => expect(result.current.fileChangeCount).toBe(1));

    // A live run's event store hands out a NEW map per event — same content.
    rerender({
      executionId: "wex_1",
      taskStates: statesMap(taskState("t1", { childExecutionId: "aex_1" })),
    });
    await waitFor(() => expect(result.current.isRefetching).toBe(false));
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("refetches ONLY the child whose task settled; already-settled children stay fetched (≤2 gets per child)", async () => {
    mockGet.mockImplementation(async (id: string) =>
      terminalChildWithLedger(id, `src/${id}.ts`, "old", "new"),
    );

    const { result, rerender } = renderChanges({
      executionId: "wex_1",
      taskStates: statesMap(
        taskState("t1", { childExecutionId: "aex_1", status: "completed" }),
        taskState("t2", { childExecutionId: "aex_2", status: "running" }),
      ),
    });
    await waitFor(() => expect(result.current.fileChangeCount).toBe(2));
    expect(mockGet).toHaveBeenCalledTimes(2);

    // t2 settles: exactly one more fetch, for aex_2 only.
    rerender({
      executionId: "wex_1",
      taskStates: statesMap(
        taskState("t1", { childExecutionId: "aex_1", status: "completed" }),
        taskState("t2", { childExecutionId: "aex_2", status: "completed" }),
      ),
    });
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(3));
    expect(mockGet).toHaveBeenLastCalledWith("aex_2");
  });

  it("fetches only a newly-appearing child, never refetching settled ones", async () => {
    mockGet.mockImplementation(async (id: string) =>
      terminalChildWithLedger(id, `src/${id}.ts`, "old", "new"),
    );

    const { result, rerender } = renderChanges({
      executionId: "wex_1",
      taskStates: statesMap(
        taskState("t1", { childExecutionId: "aex_1", status: "completed" }),
      ),
    });
    await waitFor(() => expect(result.current.fileChangeCount).toBe(1));

    rerender({
      executionId: "wex_1",
      taskStates: statesMap(
        taskState("t1", { childExecutionId: "aex_1", status: "completed" }),
        taskState("t2", { childExecutionId: "aex_2", status: "completed" }),
      ),
    });
    await waitFor(() => expect(result.current.fileChangeCount).toBe(2));
    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(mockGet).toHaveBeenLastCalledWith("aex_2");
  });

  it("surfaces a child-fetch failure as error while other children's results still render", async () => {
    mockGet.mockImplementation(async (id: string) => {
      if (id === "aex_bad") throw new Error("boom");
      return terminalChildWithLedger(id, `src/${id}.ts`, "old", "new");
    });

    const { result } = renderChanges({
      executionId: "wex_1",
      taskStates: statesMap(
        taskState("t1", { childExecutionId: "aex_ok" }),
        taskState("t2", { childExecutionId: "aex_bad" }),
      ),
    });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("boom");
    expect(result.current.fileChanges.map((c) => c.path)).toEqual([
      "src/aex_ok.ts",
    ]);
  });

  it("resets on execution switch without getting stuck loading when the new run has no children", async () => {
    mockGet.mockImplementation(async (id: string) =>
      terminalChildWithLedger(id, "src/a.ts", "old", "new"),
    );

    const { result, rerender } = renderChanges({
      executionId: "wex_1",
      taskStates: statesMap(taskState("t1", { childExecutionId: "aex_1" })),
    });
    await waitFor(() => expect(result.current.fileChangeCount).toBe(1));

    // Run B has no agent-call tasks: run A's changes must not bleed over,
    // and the loading flag must not stick (the stale-isFetching defect).
    rerender({ executionId: "wex_2", taskStates: new Map() });
    await waitFor(() => {
      expect(result.current.fileChangeCount).toBe(0);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.isRefetching).toBe(false);
    });
  });
});
