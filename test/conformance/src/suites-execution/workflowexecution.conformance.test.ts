// Conformance suite for the WorkflowExecution domain (Class B).
// Domain: agentic / workflowexecution — a single run of a Workflow through the
// engine (Temporal orchestrator + TS runner), driven via the raw proto stubs.
//
// Runs against the local-execution target, so Temporal is always present and
// workflowCreator is injected: create starts a real workflow. Two hermetic
// fixtures carry the whole suite — `set_vars` (completes sub-second, for
// create/complete/query/terminal-precondition cases) and `wait` (a durable
// Temporal timer, for acting on a genuinely *running* execution: IN_PROGRESS
// observation, cancel, terminate, pause/resume). Neither needs an LLM, MCP,
// key, or storage.
//
// Deliberately out of scope here (each needs machinery this slice doesn't build):
// - The engine-unavailable create-boundary. Both execution domains now share one
//   contract (issue #195, formerly the F7/F8 asymmetry): a create while the engine
//   is down fails fast with Unavailable and persists nothing — no zombie/orphaned
//   PENDING. That path is only reachable with Temporal DOWN, which this target
//   never does, so it is covered by the Go controller unit tests (and the Java
//   guard unit tests) rather than asserted here.
// - submitApproval / submitWorkflowTaskApproval (need an approval-bearing
//   human_input workflow) and sendSignal's happy path (needs a `listen` task)
//   and recover's happy path (needs a FAILED execution) — their precondition
//   contracts ARE asserted; their success paths await the human-input slice.
// - updateStatus is the runner's internal status-merge RPC, exercised implicitly
//   by every completion rather than as a user-facing contract.
import { FileDecisionAction, FileDecisionScope } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { WorkflowEventType, type WorkflowExecutionEvent } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/event_pb";
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import { assertResourceParity } from "../contract/parity";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { collectStream } from "../support/collect-stream";
import { uniqueName } from "../support/naming";
import {
  WORKFLOW_EXECUTION_API_VERSION,
  WORKFLOW_EXECUTION_KIND,
  awaitPhase,
  awaitTerminal,
  makeWorkflowExecution,
} from "../support/workflowexecutions";
import { makeWaitWorkflow, makeWorkflow } from "../support/workflows";
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

// A sub-second set_vars Workflow; returns its wfl_ id.
async function provisionWorkflow(org: string, name = uniqueName("wf")): Promise<string> {
  const workflow = await clients.workflowCommand.create(makeWorkflow({ org, name, taskVar: "hello" }));
  fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));
  return workflow.metadata!.id;
}

// A long-running wait Workflow (durable Temporal timer); returns its wfl_ id.
async function provisionWaitWorkflow(org: string, name = uniqueName("wf-wait")): Promise<string> {
  const workflow = await clients.workflowCommand.create(makeWaitWorkflow({ org, name, waitSeconds: 30 }));
  fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));
  return workflow.metadata!.id;
}

async function createExecution(org: string, workflowId: string, name = uniqueName("wfx")) {
  const execution = await clients.workflowExecutionCommand.create(
    makeWorkflowExecution({ org, name, workflowId }),
  );
  fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: execution.metadata!.id }));
  return execution;
}

describe("WorkflowExecution conformance — CRUD & identity", () => {
  it("create assigns a wex_ id, echoes the workflow ref, and starts PENDING", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWorkflow(org);
    const name = uniqueName("wfx");

    const created = await createExecution(org, workflowId, name);

    expect(created.metadata?.id, "create should assign a prefixed id").toMatch(/^wex_[0-9a-z]+$/);
    expect(created.metadata?.name).toBe(name);
    expect(created.metadata?.org).toBe(org);
    expect(created.spec?.workflowId).toBe(workflowId);
    // create persists before starting Temporal, so the returned phase is PENDING.
    expect(created.status?.phase).toBe(ExecutionPhase.EXECUTION_PENDING);
  });

  it("get round-trips the created resource (ignoring server-set fields)", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWorkflow(org);
    const created = await createExecution(org, workflowId);

    const fetched = await clients.workflowExecutionQuery.get({ value: created.metadata!.id });

    expect(fetched.metadata?.id).toBe(created.metadata?.id);
    // Status advances as the run progresses, so parity (which ignores status,
    // id, and version) is the right equivalence here.
    assertResourceParity(WorkflowExecutionSchema, created, fetched, "create vs get");
  });

  it("delete returns the resource and a subsequent get reports NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWorkflow(org);
    const created = await clients.workflowExecutionCommand.create(
      makeWorkflowExecution({ org, name: uniqueName("wfx"), workflowId }),
    );
    const { id } = created.metadata!;

    const deleted = await clients.workflowExecutionCommand.delete({ value: id });
    expect(deleted.metadata?.id).toBe(id);

    await expectGrpcCode(() => clients.workflowExecutionQuery.get({ value: id }), Code.NotFound, "get after delete");
  });

  it("get rejects an empty id with InvalidArgument", () =>
    expectGrpcCode(() => clients.workflowExecutionQuery.get({ value: "" }), Code.InvalidArgument, "get empty id"));

  it("get of a missing id returns NotFound", () =>
    expectGrpcCode(
      () => clients.workflowExecutionQuery.get({ value: "wex_doesnotexist" }),
      Code.NotFound,
      "get missing id",
    ));
});

describe("WorkflowExecution conformance — completion", () => {
  it("a completed run populates started_at, completed_at, tasks, and temporal_workflow_id", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWorkflow(org);
    const created = await createExecution(org, workflowId);

    const final = await awaitTerminal(clients, created.metadata!.id);

    expect(final.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    // These are written by the runner via updateStatus as the run progresses.
    expect(final.status?.startedAt, "started_at is set when the run begins").toBeDefined();
    expect(final.status?.completedAt, "completed_at is set on completion").toBeDefined();
    expect(final.status?.tasks.length, "the single set_vars task is recorded").toBeGreaterThanOrEqual(1);
    // Note: status.temporal_workflow_id is NOT populated on the happy path — the
    // runner (not the Go orchestrator) writes the terminal status and does not
    // surface the Temporal correlation id. Asserting it would enshrine an absent
    // value; recorded as a finding instead (DD-008 / Session 8 checkpoint).
  });
});

describe("WorkflowExecution conformance — queries", () => {
  it("list includes created executions", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWorkflow(org);
    const a = await createExecution(org, workflowId);
    const b = await createExecution(org, workflowId);

    const listed = await clients.workflowExecutionQuery.list({});
    const ids = listed.entries.map((e) => e.metadata?.id);

    expect(ids).toContain(a.metadata?.id);
    expect(ids).toContain(b.metadata?.id);
  });

  it("listByWorkflow returns only the executions for the given workflow", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWorkflow(org);
    const otherWorkflowId = await provisionWorkflow(org);
    const one = await createExecution(org, workflowId);
    const two = await createExecution(org, workflowId);
    const other = await createExecution(org, otherWorkflowId);

    const listed = await clients.workflowExecutionQuery.listByWorkflow({ workflowId });
    const ids = listed.entries.map((e) => e.metadata?.id);

    expect(ids).toContain(one.metadata?.id);
    expect(ids).toContain(two.metadata?.id);
    expect(ids).not.toContain(other.metadata?.id);
  });

  it("listByWorkflow returns an empty list for an unknown workflow", async () => {
    const listed = await clients.workflowExecutionQuery.listByWorkflow({ workflowId: "wfl_doesnotexist" });
    expect(listed.entries).toHaveLength(0);
  });

  it("listByWorkflow rejects an empty workflow_id with InvalidArgument", () =>
    expectGrpcCode(
      () => clients.workflowExecutionQuery.listByWorkflow({ workflowId: "" }),
      Code.InvalidArgument,
      "listByWorkflow empty workflow_id",
    ));

  it("getEventLog rejects an empty execution_id with InvalidArgument", () =>
    expectGrpcCode(
      () => clients.workflowExecutionQuery.getEventLog({ executionId: "" }),
      Code.InvalidArgument,
      "getEventLog empty execution_id",
    ));

  it("getEventLog of an unknown execution returns an empty page (not NotFound)", async (ctx) => {
    // Single-user-posture arm: the multi-tenant edition's authorization
    // fails closed on a fabricated id (PermissionDenied, no existence leak)
    // before the handler runs — the wave-2 fabricated-id class, disclosed in
    // the parity register. Only the single-user editions reach the
    // empty-page contract.
    if (target.capabilities.multiTenant) return ctx.skip();
    // Unlike get/subscribe, getEventLog does not 404 — it returns no events.
    const log = await clients.workflowExecutionQuery.getEventLog({ executionId: "wex_doesnotexist" });
    expect(log.events).toHaveLength(0);
  });
});

describe("WorkflowExecution conformance — lifecycle (running execution)", () => {
  it("observes EXECUTION_IN_PROGRESS once the runner picks the execution up", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWaitWorkflow(org);
    const created = await createExecution(org, workflowId);

    const running = await awaitPhase(clients, created.metadata!.id, ExecutionPhase.EXECUTION_IN_PROGRESS);
    expect(running.status?.phase).toBe(ExecutionPhase.EXECUTION_IN_PROGRESS);

    // Stop the timer; cancel of a running execution is the next test's subject.
    await clients.workflowExecutionCommand.cancel({ id: created.metadata!.id });
  });

  it("cancel transitions a running execution to CANCELLED with completed_at", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWaitWorkflow(org);
    const created = await createExecution(org, workflowId);
    await awaitPhase(clients, created.metadata!.id, ExecutionPhase.EXECUTION_IN_PROGRESS);

    await clients.workflowExecutionCommand.cancel({ id: created.metadata!.id, reason: "conformance" });

    const cancelled = await awaitPhase(clients, created.metadata!.id, ExecutionPhase.EXECUTION_CANCELLED);
    expect(cancelled.status?.completedAt, "cancel records completed_at").toBeDefined();
  });

  it("terminate transitions a running execution to TERMINATED", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWaitWorkflow(org);
    const created = await createExecution(org, workflowId);
    await awaitPhase(clients, created.metadata!.id, ExecutionPhase.EXECUTION_IN_PROGRESS);

    await clients.workflowExecutionCommand.terminate({ id: created.metadata!.id, reason: "conformance" });

    const terminated = await awaitPhase(clients, created.metadata!.id, ExecutionPhase.EXECUTION_TERMINATED);
    expect(terminated.status?.phase).toBe(ExecutionPhase.EXECUTION_TERMINATED);
  });

  it("pause then resume moves a running execution PAUSED -> IN_PROGRESS", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWaitWorkflow(org);
    const created = await createExecution(org, workflowId);
    const id = created.metadata!.id;
    await awaitPhase(clients, id, ExecutionPhase.EXECUTION_IN_PROGRESS);

    await clients.workflowExecutionCommand.pause({ id, reason: "conformance" });
    await awaitPhase(clients, id, ExecutionPhase.EXECUTION_PAUSED);

    await clients.workflowExecutionCommand.resume({ id });
    await awaitPhase(clients, id, ExecutionPhase.EXECUTION_IN_PROGRESS);

    await clients.workflowExecutionCommand.cancel({ id });
  });
});

describe("WorkflowExecution conformance — lifecycle preconditions & negatives", () => {
  it("cancel of a completed execution is rejected with FailedPrecondition", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWorkflow(org);
    const created = await createExecution(org, workflowId);
    await awaitTerminal(clients, created.metadata!.id);

    await expectGrpcCode(
      () => clients.workflowExecutionCommand.cancel({ id: created.metadata!.id }),
      Code.FailedPrecondition,
      "cancel a completed execution",
    );
  });

  it("terminate of a completed execution is rejected with FailedPrecondition", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWorkflow(org);
    const created = await createExecution(org, workflowId);
    await awaitTerminal(clients, created.metadata!.id);

    await expectGrpcCode(
      () => clients.workflowExecutionCommand.terminate({ id: created.metadata!.id }),
      Code.FailedPrecondition,
      "terminate a completed execution",
    );
  });

  it("recover of a non-failed execution is rejected with FailedPrecondition", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWorkflow(org);
    const created = await createExecution(org, workflowId);
    await awaitTerminal(clients, created.metadata!.id);

    await expectGrpcCode(
      () => clients.workflowExecutionCommand.recover({ id: created.metadata!.id }),
      Code.FailedPrecondition,
      "recover a completed execution",
    );
  });

  it("cancel rejects an empty id with InvalidArgument", () =>
    expectGrpcCode(
      () => clients.workflowExecutionCommand.cancel({ id: "" }),
      Code.InvalidArgument,
      "cancel empty id",
    ));

  it("cancel of a missing execution returns NotFound", () =>
    expectGrpcCode(
      () => clients.workflowExecutionCommand.cancel({ id: "wex_doesnotexist" }),
      Code.NotFound,
      "cancel missing execution",
    ));

  it("pause of a missing execution returns NotFound", () =>
    expectGrpcCode(
      () => clients.workflowExecutionCommand.pause({ id: "wex_doesnotexist" }),
      Code.NotFound,
      "pause missing execution",
    ));

  it("sendSignal rejects an empty execution_id with InvalidArgument", () =>
    expectGrpcCode(
      () => clients.workflowExecutionCommand.sendSignal({ executionId: "", signalName: "go" }),
      Code.InvalidArgument,
      "sendSignal empty execution_id",
    ));

  it("sendSignal to a missing execution returns NotFound", () =>
    expectGrpcCode(
      () => clients.workflowExecutionCommand.sendSignal({ executionId: "wex_doesnotexist", signalName: "go" }),
      Code.NotFound,
      "sendSignal missing execution",
    ));
});

describe("WorkflowExecution conformance — create negative paths", () => {
  it("rejects a wrong api_version (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWorkflow(org);
    await expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.create({
          apiVersion: "wrong.stigmer.ai/v1",
          kind: WORKFLOW_EXECUTION_KIND,
          metadata: { name: uniqueName("wfx"), org },
          spec: { workflowId },
        }),
      Code.InvalidArgument,
      "create with wrong api_version",
    );
  });

  it("rejects a wrong kind (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWorkflow(org);
    await expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.create({
          apiVersion: WORKFLOW_EXECUTION_API_VERSION,
          kind: "NotAWorkflowExecution",
          metadata: { name: uniqueName("wfx"), org },
          spec: { workflowId },
        }),
      Code.InvalidArgument,
      "create with wrong kind",
    );
  });

  it("rejects a create with no metadata (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWorkflow(org);
    await expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.create({
          apiVersion: WORKFLOW_EXECUTION_API_VERSION,
          kind: WORKFLOW_EXECUTION_KIND,
          spec: { workflowId },
        }),
      Code.InvalidArgument,
      "create without metadata",
    );
  });

  it("rejects a create with no workflow reference (InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    // spec.workflow_id is not proto-required; the handler enforces that either
    // workflow_id or workflow_instance_id is present, with a proper code.
    await expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.create({
          apiVersion: WORKFLOW_EXECUTION_API_VERSION,
          kind: WORKFLOW_EXECUTION_KIND,
          metadata: { name: uniqueName("wfx"), org },
          spec: {},
        }),
      Code.InvalidArgument,
      "create without a workflow reference",
    );
  });

  it("rejects a create against an unknown workflow (NotFound)", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.create(
          makeWorkflowExecution({ org, name: uniqueName("wfx"), workflowId: "wfl_doesnotexist" }),
        ),
      Code.NotFound,
      "create against an unknown workflow",
    );
  });

  it("rejects a duplicate create (contract: AlreadyExists)", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWorkflow(org);
    const name = uniqueName("dup");
    await createExecution(org, workflowId, name);

    await expectGrpcCode(
      () => clients.workflowExecutionCommand.create(makeWorkflowExecution({ org, name, workflowId })),
      Code.AlreadyExists,
      "duplicate create",
    );
  });

  it("rejects a create with no name (contract: InvalidArgument)", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWorkflow(org);
    // workflow_id is valid so resolution proceeds to ResolveSlugStep, which is
    // what rejects the empty name with a typed InvalidArgument on every target.
    await expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.create({
          apiVersion: WORKFLOW_EXECUTION_API_VERSION,
          kind: WORKFLOW_EXECUTION_KIND,
          metadata: { org },
          spec: { workflowId },
        }),
      Code.InvalidArgument,
      "create without name",
    );
  });
});

// --- CW-7: the event log's cursor pagination and the streaming lanes --------
//
// A completed single-task set_vars run emits exactly FOUR events
// (execution_started, task_started, task_completed, execution_completed) —
// small enough to be cheap, rich enough to walk a real has_more/
// latest_sequence cursor with page_size 1. Streams are consumed through
// collectStream, the bounded reader that keeps the S4 idle-forever quirk
// (pinned below) from hanging the suite.

describe("WorkflowExecution conformance — event log pagination & streaming (CW-7)", () => {
  it("getEventLog walks the after_sequence cursor: page_size 1, has_more, exhaustion", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWorkflow(org);
    const created = await createExecution(org, workflowId);
    await awaitTerminal(clients, created.metadata!.id);
    const executionId = created.metadata!.id;

    // Walk the whole log one event at a time — real cursor semantics, no
    // manufactured event floods.
    const walked: WorkflowExecutionEvent[] = [];
    let afterSequence = 0n;
    for (;;) {
      const page = await clients.workflowExecutionQuery.getEventLog({
        executionId,
        afterSequence,
        pageSize: 1,
      });
      if (page.events.length === 0) break;
      expect(page.events, "page_size 1 is honored").toHaveLength(1);
      walked.push(page.events[0]!);
      // has_more reflects records beyond this page; the cursor is the
      // page's latest sequence, strictly-greater-than on the next read.
      expect(page.hasMore).toBe(walked.length < 4);
      expect(page.latestSequence).toBe(page.events[0]!.sequenceNumber);
      afterSequence = page.latestSequence;
      if (!page.hasMore) break;
    }

    // The four-event shape of a single-task run, sequences dense from 1.
    expect(walked).toHaveLength(4);
    expect(walked.map((e) => e.sequenceNumber)).toEqual([1n, 2n, 3n, 4n]);
    expect(walked[0]?.eventType).toBe(WorkflowEventType.execution_started);
    expect(walked[3]?.eventType).toBe(WorkflowEventType.execution_completed);

    // One unpaginated read returns the same log with has_more exhausted.
    const full = await clients.workflowExecutionQuery.getEventLog({ executionId });
    expect(full.events.map((e) => e.eventId)).toEqual(walked.map((e) => e.eventId));
    expect(full.hasMore).toBe(false);
    expect(full.latestSequence).toBe(4n);
  });

  it("subscribeEvents replays a terminal run's whole log and closes cleanly", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWorkflow(org);
    const created = await createExecution(org, workflowId);
    await awaitTerminal(clients, created.metadata!.id);

    // Replay-then-close: on an already-terminal execution the stream sends
    // every persisted event and ends on its own — the deterministic way to
    // prove the lane without racing a live run.
    const stream = await collectStream((signal) =>
      clients.workflowExecutionQuery.subscribeEvents(
        { executionId: created.metadata!.id },
        { signal },
      ),
    );
    expect(stream.outcome, "the server closes after draining a terminal run").toBe("closed");
    expect(stream.messages.map((e) => e.sequenceNumber)).toEqual([1n, 2n, 3n, 4n]);
    expect(stream.messages[3]?.eventType).toBe(WorkflowEventType.execution_completed);
  });

  it("subscribe sends the snapshot but never closes on an already-terminal run (the pinned S4 quirk)", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWorkflow(org);
    const created = await createExecution(org, workflowId);
    await awaitTerminal(clients, created.metadata!.id);

    // The terminal-close check fires only on broker UPDATES, never on the
    // initial snapshot — so a subscription to a finished run receives the
    // snapshot and then idles forever. Pinned deliberately (wave-2 S4): the
    // TS port must reproduce it consciously or fix it in both editions.
    const stream = await collectStream(
      (signal) =>
        clients.workflowExecutionQuery.subscribe({ executionId: created.metadata!.id }, { signal }),
      { timeoutMs: 3_000 },
    );
    expect(stream.outcome, "no server close — the bounded reader had to abort").toBe("timeout");
    expect(stream.messages).toHaveLength(1);
    expect(stream.messages[0]?.status?.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });

  it("submitFileDecision refuses an execution with no pending file reviews (FailedPrecondition)", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionWorkflow(org);
    const created = await createExecution(org, workflowId);
    await awaitTerminal(clients, created.metadata!.id);

    // The deeper file-review arms (digest mismatch, unknown change set)
    // need mock-LLM file-edit choreography and land with the execution
    // ports (#17/#20) — this pins the reachable precondition arm.
    const err = await expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.submitFileDecision({
          executionId: created.metadata!.id,
          childAgentExecutionId: "aexec_x",
          changeSetId: "cs_x",
          expectedDigest: "digest",
          scope: FileDecisionScope.CHANGE_SET,
          action: FileDecisionAction.APPROVE,
        }),
      Code.FailedPrecondition,
      "submitFileDecision on a run that never produced file reviews",
    );
    expect(err.rawMessage).toBe(
      `workflow execution ${created.metadata!.id} has no pending file reviews`,
    );
  });
});
