// WorkflowExecution conformance — the ENGINELESS surface (Class A): the
// create-time engine gate and every read RPC's zero-record/validation
// contract.
// Domain: conformance suites.
//
// This target runs no Temporal, so no execution record can ever exist here
// — the create pipeline's EnsureEngineAvailable step (step 4, deliberately
// BEFORE any side effect) refuses with Unavailable, which is itself the
// first pin: the acknowledged boundary the Class B suite explicitly scopes
// out (its target always has an engine). Everything else asserts what the
// read surfaces truthfully answer when NOTHING has ever run:
//
//   - getExecutionSummary's zero shape, including the success_rate -1
//     sentinel ("no terminal runs yet" — distinguishable from a real 0%),
//     the ALWAYS-present zero cost summary, and avg_duration's deliberate
//     absence (an average over nothing is not 0).
//   - listPendingApprovals' empty page.
//   - getEventLog's asymmetry: empty id refuses InvalidArgument, but an
//     UNKNOWN id answers an empty page — NOT NotFound (no existence check
//     by design; the Class B suite pins the same arm engine-side).
//   - The subscribe lanes' error arms, driven through the bounded
//     collectStream consumer: empty id InvalidArgument; unknown id
//     NotFound (subscribeEvents and subscribe both check existence before
//     streaming — the opposite of getEventLog).
//   - submitFileDecision's engineless negatives: proto-validation arms and
//     the unknown-execution NotFound. The deeper arms (digest mismatch,
//     unknown change set) need a live file review and land with the
//     execution-domain ports (#17/#20 — disclosed in the wave-2 PR).
//
// The populated arms of every one of these RPCs are Class B and live in
// suites-execution/.
import { Code } from "@connectrpc/connect";
import { FileDecisionAction, FileDecisionScope } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { collectStream } from "../support/collect-stream";
import { uniqueName } from "../support/naming";
import { makeWorkflow } from "../support/workflows";
import { makeWorkflowExecution } from "../support/workflowexecutions";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

describe("WorkflowExecution conformance — the engine gate (Class A)", () => {
  it("create refuses Unavailable before any side effect when no engine is connected", async () => {
    const { org } = await target.provisionTenancy();
    // A real workflow: the engine gate sits AFTER reference validation, so
    // the refusal proves the gate specifically, not an earlier miss.
    const workflow = await clients.workflowCommand.create(
      makeWorkflow({ org, name: uniqueName("gate-flow") }),
    );
    fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));

    const err = await expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.create(
          makeWorkflowExecution({
            org,
            name: uniqueName("gate-exec"),
            workflowId: workflow.metadata!.id,
          }),
        ),
      Code.Unavailable,
      "create with no execution engine behind the server",
    );
    // The user-facing copy both domains share — a transient-shaped message
    // because the engine may legitimately still be connecting at boot.
    expect(err.rawMessage).toBe(
      "The execution engine is temporarily unavailable. Please try again shortly.",
    );
  });
});

describe("WorkflowExecution conformance — zero-record read surfaces (Class A)", () => {
  it("getExecutionSummary answers the pinned zero shape", async () => {
    const { org } = await target.provisionTenancy();
    const summary = await clients.workflowExecutionQuery.getExecutionSummary({ org });

    expect(summary.activeCount).toBe(0);
    expect(summary.phaseCounts).toEqual({});
    expect(summary.totalCount).toBe(0);
    // -1 is the "no terminal runs yet" sentinel — deliberately not 0,
    // which would read as a real 0% success rate.
    expect(summary.successRate).toBe(-1);
    // The cost summary is ALWAYS present, zero-valued — consumers never
    // null-check it.
    expect(summary.totalCost).toBeDefined();
    expect(summary.totalCost?.totalCostUsd ?? 0).toBe(0);
    // An average over nothing is absence, not 0.
    expect(summary.avgDuration).toBeUndefined();
    expect(summary.topFailingWorkflows).toHaveLength(0);
    expect(summary.costByWorkflow).toHaveLength(0);
  });

  it("listPendingApprovals answers the empty page", async () => {
    const { org } = await target.provisionTenancy();
    const approvals = await clients.workflowExecutionQuery.listPendingApprovals({ org });
    expect(approvals.entries).toHaveLength(0);
    expect(approvals.totalCount).toBe(0);
  });

  it("getEventLog: empty id refuses; an UNKNOWN id answers an empty page, not NotFound", async () => {
    // Code only: the proto validation layer fires before the handler's own
    // required-id check, so the message is the interceptor's, not a pin.
    await expectGrpcCode(
      () => clients.workflowExecutionQuery.getEventLog({ executionId: "" }),
      Code.InvalidArgument,
      "getEventLog without an execution id",
    );

    // No existence check by design: the event log of a never-seen id is
    // truthfully empty, and has_more/latest_sequence are zero-valued.
    const page = await clients.workflowExecutionQuery.getEventLog({
      executionId: "wfe_01conformancemissing",
    });
    expect(page.events).toHaveLength(0);
    expect(page.hasMore).toBe(false);
    expect(page.latestSequence).toBe(0n);
  });

  it("the subscribe lanes refuse empty ids (InvalidArgument) and unknown ids (NotFound)", async () => {
    // Unlike getEventLog, both streaming lanes CHECK existence before
    // streaming — a long-lived subscription to a typo'd id must fail
    // loudly, not idle forever on an empty poll loop.
    await expectGrpcCode(
      () =>
        collectStream((signal) =>
          clients.workflowExecutionQuery.subscribe({ executionId: "" }, { signal }),
        ),
      Code.InvalidArgument,
      "subscribe with an empty id",
    );
    await expectGrpcCode(
      () =>
        collectStream((signal) =>
          clients.workflowExecutionQuery.subscribe(
            { executionId: "wfe_01conformancemissing" },
            { signal },
          ),
        ),
      Code.NotFound,
      "subscribe to an unknown execution",
    );
    await expectGrpcCode(
      () =>
        collectStream((signal) =>
          clients.workflowExecutionQuery.subscribeEvents({ executionId: "" }, { signal }),
        ),
      Code.InvalidArgument,
      "subscribeEvents with an empty id",
    );
    await expectGrpcCode(
      () =>
        collectStream((signal) =>
          clients.workflowExecutionQuery.subscribeEvents(
            { executionId: "wfe_01conformancemissing" },
            { signal },
          ),
        ),
      Code.NotFound,
      "subscribeEvents on an unknown execution",
    );
  });
});

describe("WorkflowExecution conformance — submitFileDecision negatives (Class A)", () => {
  it("rejects structurally invalid inputs before any load (InvalidArgument)", async () => {
    // Proto-validation arms: min_len on the ids/digest, defined-and-nonzero
    // on the enums — all fire before the execution load, so a fake id is
    // never touched.
    await expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.submitFileDecision({
          executionId: "",
          childAgentExecutionId: "aexec_x",
          changeSetId: "cs_x",
          expectedDigest: "digest",
          scope: FileDecisionScope.CHANGE_SET,
          action: FileDecisionAction.APPROVE,
        }),
      Code.InvalidArgument,
      "submitFileDecision without a workflow execution id",
    );
    await expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.submitFileDecision({
          executionId: "wfe_x",
          childAgentExecutionId: "aexec_x",
          changeSetId: "cs_x",
          expectedDigest: "digest",
          scope: FileDecisionScope.UNSPECIFIED,
          action: FileDecisionAction.APPROVE,
        }),
      Code.InvalidArgument,
      "submitFileDecision with an unspecified scope",
    );
    await expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.submitFileDecision({
          executionId: "wfe_x",
          childAgentExecutionId: "aexec_x",
          changeSetId: "cs_x",
          expectedDigest: "",
          scope: FileDecisionScope.CHANGE_SET,
          action: FileDecisionAction.REJECT,
        }),
      Code.InvalidArgument,
      "submitFileDecision without the digest guard",
    );
  });

  it("an unknown execution answers NotFound", async () => {
    await expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.submitFileDecision({
          executionId: "wfe_01conformancemissing",
          childAgentExecutionId: "aexec_x",
          changeSetId: "cs_x",
          expectedDigest: "digest",
          scope: FileDecisionScope.CHANGE_SET,
          action: FileDecisionAction.APPROVE,
        }),
      Code.NotFound,
      "submitFileDecision on a nonexistent workflow execution",
    );
  });
});
