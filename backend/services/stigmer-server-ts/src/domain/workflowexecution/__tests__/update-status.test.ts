/**
 * Pins the updateStatus merge engine against Go's update_status_test.go
 * case-for-case: the flag-gated per-child pending_approvals /
 * pending_file_reviews merge (the parallel-children no-clobber
 * regression), mergePendingByChild's pure contract, and the
 * phase-transition-only statusAudit bump (the recents-ordering contract
 * shared with the cloud handler).
 *
 * Plus the DD-001 mechanism pins Go cannot have (its updateStatus is
 * load-then-save): updateStatus persists through the store's atomic
 * updateResource — proven by a counting store (a saveResource write here
 * would be the lost-update regression) and by a concurrent
 * different-children race through the REAL sqlite store, where
 * load-then-save would drop one child's gate.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { clone, create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromMs, timestampMs } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { WorkflowExecutionUpdateStatusInputSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import type { WorkflowExecutionUpdateStatusInput } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../boot/logger.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import type { Store } from "../../../store/interface.js";

import { StreamBroker } from "../stream-broker.js";
import {
  applyUpdateStatusMerge,
  mergePendingByChild,
  updateStatus,
} from "../update-status.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

function wfApproval(childId: string, toolCallId: string) {
  return {
    approval: { toolCallId, toolName: "deploy_code" },
    childAgentExecutionId: childId,
  };
}

function wfFileReview(childId: string, ...changeSetIds: string[]) {
  return {
    childAgentExecutionId: childId,
    changeSetId: changeSetIds,
  };
}

/**
 * Applies the merge to a clone of the existing execution and returns the
 * merged result (Go executeMerge, over the exported merge body).
 */
function executeMerge(
  existing: WorkflowExecution,
  inputInit: MessageInitShape<typeof WorkflowExecutionUpdateStatusInputSchema>,
): WorkflowExecution {
  const input: WorkflowExecutionUpdateStatusInput = create(
    WorkflowExecutionUpdateStatusInputSchema,
    inputInit,
  );
  const merged = clone(WorkflowExecutionSchema, existing);
  applyUpdateStatusMerge(merged, input);
  return merged;
}

function makeExecution(
  statusInit: MessageInitShape<typeof WorkflowExecutionSchema>["status"],
): WorkflowExecution {
  return create(WorkflowExecutionSchema, {
    metadata: { id: "wfx_test", name: "wfx_test" },
    status: statusInit,
  });
}

describe("pending_approvals per-child merge (update_status_test.go)", () => {
  const makeExisting = () =>
    makeExecution({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      pendingApprovals: [wfApproval("aex_abc", "tc_123")],
    });

  it("flag false preserves existing approvals", () => {
    const result = executeMerge(makeExisting(), {
      executionId: "wfx_test",
      status: { phase: ExecutionPhase.EXECUTION_IN_PROGRESS },
      updatePendingApprovals: false,
    });
    expect(result.status?.pendingApprovals).toHaveLength(1);
    expect(result.status?.pendingApprovals[0].approval?.toolCallId).toBe(
      "tc_123",
    );
  });

  it("flag absent preserves existing approvals", () => {
    const result = executeMerge(makeExisting(), {
      executionId: "wfx_test",
      status: { phase: ExecutionPhase.EXECUTION_IN_PROGRESS },
    });
    expect(result.status?.pendingApprovals).toHaveLength(1);
  });

  it("scoped write replaces only that child's approvals", () => {
    const result = executeMerge(makeExisting(), {
      executionId: "wfx_test",
      status: { pendingApprovals: [wfApproval("aex_abc", "tc_456")] },
      updatePendingApprovals: true,
      pendingUpdateChildAgentExecutionId: "aex_abc",
    });
    expect(result.status?.pendingApprovals).toHaveLength(1);
    expect(result.status?.pendingApprovals[0].approval?.toolCallId).toBe(
      "tc_456",
    );
  });

  it("scoped empty list clears only that child", () => {
    const result = executeMerge(makeExisting(), {
      executionId: "wfx_test",
      status: { pendingApprovals: [] },
      updatePendingApprovals: true,
      pendingUpdateChildAgentExecutionId: "aex_abc",
    });
    expect(result.status?.pendingApprovals).toHaveLength(0);
  });

  // The core regression: two parallel children must not clobber each other.
  it("parallel children not clobbered on set", () => {
    const existing = makeExecution({
      pendingApprovals: [wfApproval("aex_A", "tc_A"), wfApproval("aex_B", "tc_B")],
    });
    const result = executeMerge(existing, {
      executionId: "wfx_test",
      status: { pendingApprovals: [wfApproval("aex_B", "tc_B2")] },
      updatePendingApprovals: true,
      pendingUpdateChildAgentExecutionId: "aex_B",
    });
    expect(result.status?.pendingApprovals).toHaveLength(2);
    const byChild = new Map(
      result.status?.pendingApprovals.map((entry) => [
        entry.childAgentExecutionId,
        entry.approval?.toolCallId,
      ]),
    );
    expect(byChild.get("aex_A"), "child A preserved").toBe("tc_A");
    expect(byChild.get("aex_B"), "child B replaced").toBe("tc_B2");
  });

  it("scoped clear preserves siblings", () => {
    const existing = makeExecution({
      pendingApprovals: [wfApproval("aex_A", "tc_A"), wfApproval("aex_B", "tc_B")],
    });
    const result = executeMerge(existing, {
      executionId: "wfx_test",
      status: { pendingApprovals: [] },
      updatePendingApprovals: true,
      pendingUpdateChildAgentExecutionId: "aex_B",
    });
    expect(result.status?.pendingApprovals).toHaveLength(1);
    expect(result.status?.pendingApprovals[0].childAgentExecutionId).toBe(
      "aex_A",
    );
  });

  it("concurrent event emission does not clobber approvals", () => {
    const result = executeMerge(makeExisting(), {
      executionId: "wfx_test",
      status: {
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        tasks: [{ taskName: "some_task" }],
      },
    });
    expect(
      result.status?.pendingApprovals,
      "event emission must not clear active approvals",
    ).toHaveLength(1);
    expect(result.status?.tasks).toHaveLength(1);
    expect(result.status?.tasks[0].taskName).toBe("some_task");
  });
});

describe("pending_file_reviews per-child merge (update_status_test.go)", () => {
  const makeExisting = () =>
    makeExecution({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      pendingFileReviews: [wfFileReview("aex_abc", "fcs_1")],
    });

  it("flag false preserves existing file reviews", () => {
    const result = executeMerge(makeExisting(), {
      executionId: "wfx_test",
      status: { phase: ExecutionPhase.EXECUTION_IN_PROGRESS },
    });
    expect(result.status?.pendingFileReviews).toHaveLength(1);
  });

  it("scoped write replaces only that child's file reviews", () => {
    const result = executeMerge(makeExisting(), {
      executionId: "wfx_test",
      status: {
        pendingFileReviews: [wfFileReview("aex_abc", "fcs_2", "fcs_3")],
      },
      updatePendingFileReviews: true,
      pendingUpdateChildAgentExecutionId: "aex_abc",
    });
    expect(result.status?.pendingFileReviews).toHaveLength(1);
    expect(result.status?.pendingFileReviews[0].changeSetId).toEqual([
      "fcs_2",
      "fcs_3",
    ]);
  });

  it("parallel children not clobbered", () => {
    const existing = makeExecution({
      pendingFileReviews: [
        wfFileReview("aex_A", "fcs_A"),
        wfFileReview("aex_B", "fcs_B"),
      ],
    });
    const result = executeMerge(existing, {
      executionId: "wfx_test",
      status: { pendingFileReviews: [wfFileReview("aex_B", "fcs_B2")] },
      updatePendingFileReviews: true,
      pendingUpdateChildAgentExecutionId: "aex_B",
    });
    expect(result.status?.pendingFileReviews).toHaveLength(2);
  });

  it("scoped empty list clears only that child", () => {
    const existing = makeExecution({
      pendingFileReviews: [
        wfFileReview("aex_A", "fcs_A"),
        wfFileReview("aex_B", "fcs_B"),
      ],
    });
    const result = executeMerge(existing, {
      executionId: "wfx_test",
      status: { pendingFileReviews: [] },
      updatePendingFileReviews: true,
      pendingUpdateChildAgentExecutionId: "aex_A",
    });
    expect(result.status?.pendingFileReviews).toHaveLength(1);
    expect(result.status?.pendingFileReviews[0].childAgentExecutionId).toBe(
      "aex_B",
    );
  });

  it("approvals and file reviews are independent", () => {
    const existing = makeExecution({
      pendingApprovals: [wfApproval("aex_abc", "tc_1")],
      pendingFileReviews: [wfFileReview("aex_abc", "fcs_1")],
    });
    const result = executeMerge(existing, {
      executionId: "wfx_test",
      status: { pendingFileReviews: [] },
      updatePendingFileReviews: true,
      pendingUpdateChildAgentExecutionId: "aex_abc",
    });
    expect(
      result.status?.pendingApprovals,
      "approvals untouched by a file-review-only write",
    ).toHaveLength(1);
    expect(result.status?.pendingFileReviews).toHaveLength(0);
  });
});

describe("mergePendingByChild (pure contract)", () => {
  const childOf = (entry: string) => entry;

  it("replaces scoped child, preserves siblings", () => {
    expect(mergePendingByChild(["A", "B"], ["B"], childOf, "B")).toEqual([
      "A",
      "B",
    ]);
  });
  it("empty incoming clears scoped child", () => {
    expect(mergePendingByChild(["A", "B"], [], childOf, "B")).toEqual(["A"]);
  });
  it("adds new child", () => {
    expect(mergePendingByChild(["A"], ["C"], childOf, "C")).toEqual([
      "A",
      "C",
    ]);
  });
  it("empty existing", () => {
    expect(mergePendingByChild([], ["A"], childOf, "A")).toEqual(["A"]);
  });
});

describe("statusAudit bump only on phase transitions (recents-ordering contract)", () => {
  const initialMs = Date.UTC(2026, 0, 2, 3, 4, 5);
  const makeExisting = () =>
    makeExecution({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      audit: {
        statusAudit: {
          updatedAt: timestampFromMs(initialMs),
          event: "created",
        },
      },
    });

  it("heartbeat with the same phase does not bump", () => {
    const result = executeMerge(makeExisting(), {
      executionId: "wfx_test",
      status: {
        phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
        tasks: [{ taskName: "step-1" }],
      },
    });
    expect(timestampMs(result.status!.audit!.statusAudit!.updatedAt!)).toBe(
      initialMs,
    );
    expect(result.status?.audit?.statusAudit?.event).toBe("created");
  });

  it("unspecified phase does not bump", () => {
    const result = executeMerge(makeExisting(), {
      executionId: "wfx_test",
      status: { tasks: [{ taskName: "step-1" }] },
    });
    expect(timestampMs(result.status!.audit!.statusAudit!.updatedAt!)).toBe(
      initialMs,
    );
  });

  it("phase transition bumps with the current time", () => {
    const beforeMs = Date.now() - 1000;
    const result = executeMerge(makeExisting(), {
      executionId: "wfx_test",
      status: { phase: ExecutionPhase.EXECUTION_COMPLETED },
    });
    const bumped = result.status?.audit?.statusAudit?.updatedAt;
    expect(bumped).toBeDefined();
    expect(timestampMs(bumped!)).toBeGreaterThan(beforeMs);
    expect(result.status?.audit?.statusAudit?.event).toBe("updated");
  });

  it("phase transition initializes a missing audit chain", () => {
    const existing = makeExecution({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
    });
    const result = executeMerge(existing, {
      executionId: "wfx_test",
      status: { phase: ExecutionPhase.EXECUTION_FAILED },
    });
    expect(result.status?.audit?.statusAudit?.updatedAt).toBeDefined();
  });
});

describe("presence-guarded field merges (BuildNewStateWithStatus)", () => {
  it("merges only the provided fields; zero counters mean no update", () => {
    const existing = makeExecution({
      phase: ExecutionPhase.EXECUTION_IN_PROGRESS,
      startedAt: "2026-05-23T10:00:00Z",
      totalCostMicros: 500n,
      totalInputTokens: 10n,
      error: "prior error",
    });
    const result = executeMerge(existing, {
      executionId: "wfx_test",
      status: {
        completedAt: "2026-05-23T10:05:00Z",
        totalCostMicros: 900n,
        // totalInputTokens omitted (0) — must NOT reset to 0.
        temporalWorkflowId: "stigmer/workflow-execution/invoke/wfx_test",
      },
    });
    const status = result.status!;
    expect(status.phase, "unspecified phase preserved").toBe(
      ExecutionPhase.EXECUTION_IN_PROGRESS,
    );
    expect(status.startedAt, "empty started_at preserved").toBe(
      "2026-05-23T10:00:00Z",
    );
    expect(status.completedAt).toBe("2026-05-23T10:05:00Z");
    expect(status.totalCostMicros).toBe(900n);
    expect(status.totalInputTokens, "zero counter is not a reset").toBe(10n);
    expect(status.error, "empty error preserved").toBe("prior error");
    expect(status.temporalWorkflowId).toBe(
      "stigmer/workflow-execution/invoke/wfx_test",
    );
  });
});

describe("updateStatus persistence mechanism (DD-001)", () => {
  let dir: string;
  let store: SqliteStore;
  let broker: StreamBroker;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "wfexec-updatestatus-"));
    store = SqliteStore.open(path.join(dir, "test.db"));
    broker = new StreamBroker(silentLogger);
  });

  afterAll(async () => {
    await store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  async function seed(id: string): Promise<void> {
    await store.saveResource(
      ApiResourceKind.workflow_execution,
      id,
      WorkflowExecutionSchema,
      create(WorkflowExecutionSchema, {
        metadata: { id, name: id },
        status: { phase: ExecutionPhase.EXECUTION_IN_PROGRESS },
      }),
    );
  }

  it("unknown execution answers NotFound (Go LoadExistingExecution)", async () => {
    try {
      await updateStatus(
        { store, logger: silentLogger, broker },
        create(WorkflowExecutionUpdateStatusInputSchema, {
          executionId: "wfx_missing",
          status: { phase: ExecutionPhase.EXECUTION_IN_PROGRESS },
        }),
      );
      expect.unreachable("expected NotFound");
    } catch (error) {
      expect(error).toBeInstanceOf(ConnectError);
      expect((error as ConnectError).code).toBe(Code.NotFound);
    }
  });

  it("uses the atomic updateResource, never a load-then-save (mechanism pin)", async () => {
    const calls = { updateResource: 0, saveResource: 0 };
    const countingStore = new Proxy(store, {
      get(target, property, receiver) {
        if (property === "updateResource") {
          calls.updateResource += 1;
        }
        if (property === "saveResource") {
          calls.saveResource += 1;
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as Store;

    await seed("wfx_mechanism");
    await updateStatus(
      { store: countingStore, logger: silentLogger, broker },
      create(WorkflowExecutionUpdateStatusInputSchema, {
        executionId: "wfx_mechanism",
        status: { phase: ExecutionPhase.EXECUTION_IN_PROGRESS },
      }),
    );
    expect(calls.updateResource, "the merge must run inside updateResource").toBe(1);
    expect(
      calls.saveResource,
      "a saveResource write here would reintroduce the lost-update window",
    ).toBe(0);
  });

  it("concurrent different-children updates both survive (the DD-001 race)", async () => {
    const id = "wfx_race";
    await seed(id);

    // Two children write their gates concurrently, repeatedly. With
    // load-then-save one write can clobber the other; the atomic RMW
    // must preserve both every iteration.
    for (let iteration = 0; iteration < 25; iteration++) {
      const writeFor = (child: string, toolCallId: string) =>
        updateStatus(
          { store, logger: silentLogger, broker },
          create(WorkflowExecutionUpdateStatusInputSchema, {
            executionId: id,
            status: { pendingApprovals: [wfApproval(child, toolCallId)] },
            updatePendingApprovals: true,
            pendingUpdateChildAgentExecutionId: child,
          }),
        );
      await Promise.all([
        writeFor("aex_A", `tc_A_${iteration}`),
        writeFor("aex_B", `tc_B_${iteration}`),
      ]);

      const stored = await store.getResource(
        ApiResourceKind.workflow_execution,
        id,
        WorkflowExecutionSchema,
      );
      const children = new Set(
        stored.status?.pendingApprovals.map(
          (entry) => entry.childAgentExecutionId,
        ),
      );
      expect(
        children,
        `iteration ${iteration}: both children's gates must survive`,
      ).toEqual(new Set(["aex_A", "aex_B"]));
    }
  });

  it("broadcasts the merged execution AFTER persist", async () => {
    const id = "wfx_broadcast";
    await seed(id);
    const subscription = broker.subscribe(id);
    try {
      await updateStatus(
        { store, logger: silentLogger, broker },
        create(WorkflowExecutionUpdateStatusInputSchema, {
          executionId: id,
          status: { phase: ExecutionPhase.EXECUTION_COMPLETED },
        }),
      );
      expect(subscription.queue).toHaveLength(1);
      expect(subscription.queue[0].status?.phase).toBe(
        ExecutionPhase.EXECUTION_COMPLETED,
      );
      // The broadcast frame is the PERSISTED state.
      const stored = await store.getResource(
        ApiResourceKind.workflow_execution,
        id,
        WorkflowExecutionSchema,
      );
      expect(stored.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    } finally {
      broker.unsubscribe(id, subscription);
    }
  });
});
