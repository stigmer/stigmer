// Unit arms for the WorkflowRun poll and read helpers the execution suites
// gate on. What they pin is the failure each helper reports, since a red
// execution arm is read through it:
// - a poll that times out names the run, the label it waited for and the last
//   phase it saw;
// - awaitPhase labels the wait with the phase it awaits;
// - awaitTaskStatus and awaitParentPendingApproval fail fast, naming the
//   terminal phase, when the run ends before the task or the gate appears,
//   and return the run when it does appear;
// - approvalResolutionsOf asks the event log for the run's approval_resolved
//   events of one task and keeps only their payloads.
// Pure: a stubbed query client answering hand-built runs, no target.
// Domain: conformance support (execution engine).
import { create } from "@bufbuild/protobuf";
import { type WorkflowRun, WorkflowRunSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/api_pb";
import { RunPhase, WorkflowTaskStatus } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import { WorkflowEventType, WorkflowRunEventSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/event_pb";
import { GetEventLogResponseSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";
import { describe, expect, it, vi } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import {
  approvalResolutionsOf,
  awaitParentPendingApproval,
  awaitPhase,
  awaitTaskStatus,
  pollExecution,
} from "../workflowruns";

// A poll that gives up at once: one get, then the deadline has passed.
const FAST = { timeoutMs: 1, pollMs: 1 } as const;

function run(phase: RunPhase, extra: { taskName?: string; taskStatus?: WorkflowTaskStatus; pending?: number } = {}): WorkflowRun {
  return create(WorkflowRunSchema, {
    metadata: { id: "wex_unit" },
    status: {
      phase,
      tasks: extra.taskName !== undefined ? [{ taskName: extra.taskName, status: extra.taskStatus }] : [],
      pendingApprovals: Array.from({ length: extra.pending ?? 0 }, (_, i) => ({ childAgentRunId: `aex_child_${i}` })),
    },
  });
}

// A query client whose get answers `answer` every time.
function queryReturning(answer: WorkflowRun) {
  const get = vi.fn(async () => answer);
  const clients = { workflowExecutionQuery: { get } } as unknown as ConformanceClients;
  return { clients, get };
}

describe("pollExecution", () => {
  it("times out naming the run, the label and the last phase it saw", async () => {
    const { clients, get } = queryReturning(run(RunPhase.RUN_IN_PROGRESS));
    await expect(pollExecution(clients, "wex_unit", () => false, { ...FAST, label: "the unit predicate" })).rejects.toThrow(
      "execution wex_unit did not satisfy the unit predicate within 1ms (last phase: RUN_IN_PROGRESS)",
    );
    expect(get).toHaveBeenCalledWith({ value: "wex_unit" });
  });

  it("reads an absent phase as RUN_PHASE_UNSPECIFIED and an absent label as the predicate", async () => {
    const { clients } = queryReturning(create(WorkflowRunSchema, {}));
    await expect(pollExecution(clients, "wex_unit", () => false, FAST)).rejects.toThrow(
      "did not satisfy the predicate within 1ms (last phase: RUN_PHASE_UNSPECIFIED)",
    );
  });
});

describe("awaitPhase", () => {
  it("returns the run once it reaches the phase", async () => {
    const completed = run(RunPhase.RUN_COMPLETED);
    const { clients } = queryReturning(completed);
    await expect(awaitPhase(clients, "wex_unit", RunPhase.RUN_COMPLETED, FAST)).resolves.toBe(completed);
  });

  it("labels its timeout with the phase it awaited", async () => {
    const { clients } = queryReturning(run(RunPhase.RUN_PENDING));
    await expect(awaitPhase(clients, "wex_unit", RunPhase.RUN_COMPLETED, FAST)).rejects.toThrow(
      "did not satisfy phase RUN_COMPLETED within 1ms (last phase: RUN_PENDING)",
    );
  });
});

describe("awaitTaskStatus", () => {
  it("returns the run when the task reaches the status", async () => {
    const waiting = run(RunPhase.RUN_IN_PROGRESS, {
      taskName: "gate",
      taskStatus: WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL,
    });
    const { clients } = queryReturning(waiting);
    await expect(
      awaitTaskStatus(clients, "wex_unit", "gate", WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL, FAST),
    ).resolves.toBe(waiting);
  });

  it("fails fast naming the terminal phase and the task's status when the run ends first", async () => {
    const { clients } = queryReturning(
      run(RunPhase.RUN_FAILED, { taskName: "gate", taskStatus: WorkflowTaskStatus.WORKFLOW_TASK_FAILED }),
    );
    await expect(
      awaitTaskStatus(clients, "wex_unit", "gate", WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL, FAST),
    ).rejects.toThrow(
      "execution wex_unit reached terminal phase RUN_FAILED before task gate reached " +
        "WORKFLOW_TASK_WAITING_APPROVAL (task status: WORKFLOW_TASK_FAILED)",
    );
  });

  it("reports an absent task as absent", async () => {
    const { clients } = queryReturning(run(RunPhase.RUN_COMPLETED));
    await expect(
      awaitTaskStatus(clients, "wex_unit", "gate", WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL, FAST),
    ).rejects.toThrow("reached terminal phase RUN_COMPLETED before task gate reached WORKFLOW_TASK_WAITING_APPROVAL (task status: absent)");
  });
});

describe("awaitParentPendingApproval", () => {
  it("returns the run once a child approval surfaces at the workflow level", async () => {
    const gated = run(RunPhase.RUN_IN_PROGRESS, { pending: 1 });
    const { clients } = queryReturning(gated);
    await expect(awaitParentPendingApproval(clients, "wex_unit", FAST)).resolves.toBe(gated);
  });

  it("fails fast naming the terminal phase when the run ends without surfacing one", async () => {
    const { clients } = queryReturning(run(RunPhase.RUN_COMPLETED));
    await expect(awaitParentPendingApproval(clients, "wex_unit", FAST)).rejects.toThrow(
      "execution wex_unit reached terminal phase RUN_COMPLETED before surfacing a child agent approval in status.pending_approvals",
    );
  });
});

describe("approvalResolutionsOf", () => {
  it("asks the event log for one task's approval_resolved events and returns only their payloads", async () => {
    const getEventLog = vi.fn(async () =>
      create(GetEventLogResponseSchema, {
        events: [
          create(WorkflowRunEventSchema, {
            payload: { case: "approvalResolved", value: { resolvedBy: "usr_first", comment: "ok" } },
          }),
          create(WorkflowRunEventSchema, { payload: { case: "runStarted", value: {} } }),
          create(WorkflowRunEventSchema, {
            payload: { case: "approvalResolved", value: { resolvedBy: "usr_second" } },
          }),
        ],
      }),
    );
    const clients = { workflowExecutionQuery: { getEventLog } } as unknown as ConformanceClients;

    const resolutions = await approvalResolutionsOf(clients, "wex_unit", "gate");

    expect(getEventLog).toHaveBeenCalledWith({
      runId: "wex_unit",
      eventTypes: [WorkflowEventType.approval_resolved],
      taskName: "gate",
    });
    expect(resolutions.map((r) => [r.resolvedBy, r.comment])).toEqual([
      ["usr_first", "ok"],
      ["usr_second", ""],
    ]);
  });
});
