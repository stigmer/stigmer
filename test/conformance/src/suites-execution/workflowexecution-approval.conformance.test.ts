// Conformance suite for WorkflowExecution human_input HITL (Class B).
// Domain: agentic / workflowexecution — the submitWorkflowTaskApproval RPC and
// the approval gate a workflow `human_input` task goes through.
//
// This is the workflow analogue of the AgentExecution tool-approval suite, but a
// genuinely different machine, so it is a separate file (DD-011):
//   - AgentExecution gates at the *execution* level (EXECUTION_WAITING_FOR_APPROVAL)
//     and resolves a DB-backed pending_approvals projection via submitApproval.
//   - WorkflowExecution has no execution-level waiting phase. A `human_input` task
//     gates at the *task* level (WORKFLOW_TASK_WAITING_APPROVAL) while the
//     execution phase stays EXECUTION_IN_PROGRESS, and submitWorkflowTaskApproval
//     resolves it by sending a Temporal signal (human_input_{task_name}). The
//     handler returns the execution unchanged; status advances asynchronously, so
//     the suite polls get() (task-level via awaitTaskWaitingApproval / awaitTaskStatus).
//
// Fully hermetic: a human_input task needs only Temporal + the TS runner (both
// provisioned by local-go-execution) — no LLM, no MCP, no child execution. The
// canonical fixture (support/workflows.ts) is `awaitApproval` (human_input) ->
// `afterApproval` (set_vars); the downstream set_vars completing is the proof the
// gate resumed.
//
// Asserted contract (server-owned + deterministic; sourced from
// submit_workflow_task_approval.go and confirmed empirically):
// - The gate is task-level: `awaitApproval` reaches WORKFLOW_TASK_WAITING_APPROVAL
//   with task_type WORKFLOW_TASK_APPROVAL while the execution stays IN_PROGRESS.
// - submitWorkflowTaskApproval{execution_id, task_name, outcome, form_data?,
//   reviewer?, comment?} resolves the gate; the named human_input task and the
//   downstream task complete and the execution reaches EXECUTION_COMPLETED.
// - A *defined custom* outcome that is not "approve" (here "deny") is a data
//   outcome: it resolves the gate and the execution still COMPLETES. (Only the
//   implicit, no-outcomes binary form fails on "deny"; with outcomes declared,
//   the value is data — matching the Go integration HITL suite's finding.)
// - An outcome with a `then` routes the workflow to the named task (the runner's
//   __flow_directive__ jump): submitting "revise" drives `reviseTask` to
//   COMPLETED. This proves the submitted *outcome value* drives behavior through
//   observable task statuses — preferred over reading the task.output projection.
// - timeout + on_timeout=HUMAN_INPUT_TIMEOUT_FAIL fails the execution on its own,
//   with no decision submitted.
// - Negatives carry the handler's codes: empty execution_id / task_name / outcome
//   -> InvalidArgument; missing execution -> NotFound; unknown task_name ->
//   InvalidArgument; a real but non-human_input task -> InvalidArgument; a submit
//   on a non-signalable (terminal) execution -> FailedPrecondition. (This tightens
//   beyond the Go integration tests, which only assert that an error is returned.)
//
// Deliberately NOT asserted (DD-011): idempotency of a re-submit. Unlike the
// agent DB-projection gate, this gate resolves via a fire-and-forget Temporal
// signal the handler does not dedupe, so a re-submit is timing-dependent (it
// either races into FailedPrecondition once terminal, or sends a duplicate signal
// a resolved gate ignores) — not a clean black-box guarantee. The task.output
// (outcome / form_data / reviewer) is likewise left unasserted; outcome-honoring
// is proven behaviorally via routing instead of coupling the contract to that
// runner-produced projection.
import { Code } from "@connectrpc/connect";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  ExecutionPhase,
  WorkflowTaskStatus,
  WorkflowTaskType,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import {
  awaitPhase,
  awaitTaskStatus,
  awaitTaskWaitingApproval,
  awaitTerminal,
  makeWorkflowExecution,
  taskByName,
} from "../support/workflowexecutions";
import {
  HUMAN_INPUT_AFTER_TASK_NAME,
  HUMAN_INPUT_TASK_NAME,
  type HumanInputWorkflowOptions,
  makeHumanInputWorkflow,
  makeWaitWorkflow,
} from "../support/workflows";
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

// Provision a human_input Workflow; returns its wfl_ id. Options forward to the
// fixture (custom outcomes, routing targets, timeout policy).
async function provisionHumanInputWorkflow(
  org: string,
  opts: Omit<HumanInputWorkflowOptions, "org" | "name"> = {},
): Promise<string> {
  const workflow = await clients.workflowCommand.create(
    makeHumanInputWorkflow({ org, name: uniqueName("wf-hitl"), ...opts }),
  );
  fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));
  return workflow.metadata!.id;
}

// Create an execution against a human_input workflow and await its approval gate.
// Returns the gated execution and its id.
async function runToGate(
  org: string,
  workflowId: string,
): Promise<{ executionId: string; gated: WorkflowExecution }> {
  const execution = await clients.workflowExecutionCommand.create(
    makeWorkflowExecution({ org, name: uniqueName("wfx-hitl"), workflowId }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: executionId }));

  const gated = await awaitTaskWaitingApproval(clients, executionId, HUMAN_INPUT_TASK_NAME);
  return { executionId, gated };
}

describe("WorkflowExecution submitWorkflowTaskApproval — gate & resolution", () => {
  it("gates at the task level (WAITING_APPROVAL / APPROVAL) while the execution stays IN_PROGRESS", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionHumanInputWorkflow(org);
    const { executionId, gated } = await runToGate(org, workflowId);

    const task = taskByName(gated, HUMAN_INPUT_TASK_NAME);
    expect(task?.status, "the human_input task waits for approval").toBe(
      WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL,
    );
    expect(task?.taskType, "a human_input task surfaces as an APPROVAL task").toBe(
      WorkflowTaskType.WORKFLOW_TASK_APPROVAL,
    );
    // The key contract: there is no execution-level waiting phase — the gate is
    // expressed entirely at the task level.
    expect(gated.status?.phase, "the execution itself stays IN_PROGRESS at the gate").toBe(
      ExecutionPhase.EXECUTION_IN_PROGRESS,
    );

    // Settle so the run terminates cleanly.
    await clients.workflowExecutionCommand.submitWorkflowTaskApproval({
      executionId,
      taskName: HUMAN_INPUT_TASK_NAME,
      outcome: "approve",
      reviewer: "conformance",
    });
    await awaitTerminal(clients, executionId);
  });

  it("approve resolves the gate; the execution completes and the downstream task runs", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionHumanInputWorkflow(org);
    const { executionId } = await runToGate(org, workflowId);

    // reviewer + comment are accepted (audit-trail fields with no read surface);
    // their acceptance is observed by the run completing.
    await clients.workflowExecutionCommand.submitWorkflowTaskApproval({
      executionId,
      taskName: HUMAN_INPUT_TASK_NAME,
      outcome: "approve",
      reviewer: "conformance",
      comment: "looks good",
    });

    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `approved execution should COMPLETE; reached ${ExecutionPhase[final.status?.phase ?? 0]}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    expect(taskByName(final, HUMAN_INPUT_TASK_NAME)?.status, "the gate task completes").toBe(
      WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
    );
    expect(taskByName(final, HUMAN_INPUT_AFTER_TASK_NAME)?.status, "the downstream task runs after resume").toBe(
      WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
    );
  });

  it("a non-approve custom outcome (deny) is data: the gate resolves and the execution still completes", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionHumanInputWorkflow(org);
    const { executionId } = await runToGate(org, workflowId);

    await clients.workflowExecutionCommand.submitWorkflowTaskApproval({
      executionId,
      taskName: HUMAN_INPUT_TASK_NAME,
      outcome: "deny",
      reviewer: "conformance",
    });

    // "deny" is a declared outcome, so it is recorded as data and the workflow
    // continues — it does NOT fail the execution (the proto's "deny fails" note
    // describes only the implicit no-outcomes binary form; see DD-011).
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "a declared deny outcome still COMPLETES the run").toBe(
      ExecutionPhase.EXECUTION_COMPLETED,
    );
  });

  it("an outcome's `then` routes the workflow to the named task", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionHumanInputWorkflow(org, {
      outcomes: [{ name: "approve" }, { name: "deny" }, { name: "revise", then: "reviseTask" }],
      routedTasks: ["reviseTask"],
    });
    const { executionId } = await runToGate(org, workflowId);

    await clients.workflowExecutionCommand.submitWorkflowTaskApproval({
      executionId,
      taskName: HUMAN_INPUT_TASK_NAME,
      outcome: "revise",
      reviewer: "conformance",
    });

    // Reaching reviseTask COMPLETED proves the submitted outcome drove the jump:
    // a different outcome would have continued to the in-order afterApproval task.
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "the routed run completes").toBe(ExecutionPhase.EXECUTION_COMPLETED);
    expect(taskByName(final, "reviseTask")?.status, "the routed-to task runs").toBe(
      WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED,
    );
  });
});

describe("WorkflowExecution submitWorkflowTaskApproval — timeout policy", () => {
  it("on_timeout=FAIL fails the execution when no decision arrives", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionHumanInputWorkflow(org, {
      timeout: 5,
      onTimeout: "HUMAN_INPUT_TIMEOUT_FAIL",
    });

    const execution = await clients.workflowExecutionCommand.create(
      makeWorkflowExecution({ org, name: uniqueName("wfx-timeout"), workflowId }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: executionId }));

    // No submit: the gate's timeout elapses and the FAIL policy fails the run.
    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `timed-out gate should FAIL; reached ${ExecutionPhase[final.status?.phase ?? 0]}`,
    ).toBe(ExecutionPhase.EXECUTION_FAILED);
  });

  // The APPROVE/DENY pins below close the stigmer/stigmer#779 gap: the
  // persisted enum-name policies used to reach the runner unrecognized and
  // silently behave as FAIL, so only the FAIL pin above ever passed — and it
  // passed by accident (it would have passed for any garbage policy string).

  it("on_timeout=APPROVE completes the run when no decision arrives", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionHumanInputWorkflow(org, {
      timeout: 5,
      onTimeout: "HUMAN_INPUT_TIMEOUT_APPROVE",
    });

    const execution = await clients.workflowExecutionCommand.create(
      makeWorkflowExecution({ org, name: uniqueName("wfx-timeout-approve"), workflowId }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: executionId }));

    // No submit: the timeout auto-approves and the run continues downstream.
    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `auto-approved gate should COMPLETE; reached ${ExecutionPhase[final.status?.phase ?? 0]}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    expect(
      taskByName(final, HUMAN_INPUT_AFTER_TASK_NAME)?.status,
      "the downstream task runs after auto-approval",
    ).toBe(WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED);
  });

  it("on_timeout=DENY resolves to the last declared outcome and completes", async () => {
    const { org } = await target.provisionTenancy();
    // Default fixture outcomes are declared binary approve/deny — per the
    // HumanInputTaskConfig.outcomes contract, timeout auto-deny resolves to
    // the LAST declared outcome ("deny", a data outcome that completes).
    const workflowId = await provisionHumanInputWorkflow(org, {
      timeout: 5,
      onTimeout: "HUMAN_INPUT_TIMEOUT_DENY",
    });

    const execution = await clients.workflowExecutionCommand.create(
      makeWorkflowExecution({ org, name: uniqueName("wfx-timeout-deny"), workflowId }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: executionId }));

    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `auto-denied gate with a declared deny outcome should COMPLETE; reached ${ExecutionPhase[final.status?.phase ?? 0]}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });

  it("on_timeout=APPROVE maps to the FIRST declared outcome and routes its `then`", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionHumanInputWorkflow(org, {
      outcomes: [{ name: "proceed", then: "fastPath" }, { name: "reject" }],
      routedTasks: ["fastPath"],
      timeout: 5,
      onTimeout: "HUMAN_INPUT_TIMEOUT_APPROVE",
    });

    const execution = await clients.workflowExecutionCommand.create(
      makeWorkflowExecution({ org, name: uniqueName("wfx-timeout-route"), workflowId }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: executionId }));

    // No submit: auto-approval resolves to "proceed" (first outcome), whose
    // `then` must route to fastPath — proving downstream sees the declared
    // outcome name, not the orchestrator's internal "approve".
    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `routed auto-approval should COMPLETE; reached ${ExecutionPhase[final.status?.phase ?? 0]}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    expect(
      taskByName(final, "fastPath")?.status,
      "the first outcome's `then` target runs",
    ).toBe(WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED);
  });

  it("on_timeout=ESCALATE resolves to the escalate outcome and routes its `then`", async () => {
    const { org } = await target.provisionTenancy();
    // The escalate outcome-by-name contract (stigmer/stigmer#781): the policy
    // requires an outcome NAMED "escalate" with `then` set; on timeout the
    // gate resolves to that outcome — regardless of its position in the list
    // (deliberately placed in the middle here, where neither the first-outcome
    // APPROVE mapping nor the last-outcome DENY mapping could reach it).
    const workflowId = await provisionHumanInputWorkflow(org, {
      outcomes: [
        { name: "proceed" },
        { name: "escalate", then: "escalationPath" },
        { name: "reject" },
      ],
      routedTasks: ["escalationPath"],
      timeout: 5,
      onTimeout: "HUMAN_INPUT_TIMEOUT_ESCALATE",
    });

    const execution = await clients.workflowExecutionCommand.create(
      makeWorkflowExecution({ org, name: uniqueName("wfx-timeout-escalate"), workflowId }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: executionId }));

    // No submit: the timeout escalates and the escalation branch runs.
    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `escalated gate should COMPLETE via the escalation branch; reached ${ExecutionPhase[final.status?.phase ?? 0]}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    expect(
      taskByName(final, "escalationPath")?.status,
      "the escalate outcome's `then` target runs",
    ).toBe(WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED);
  });
});

describe("WorkflowExecution submitWorkflowTaskApproval — negatives", () => {
  it("rejects an empty execution_id with InvalidArgument", () =>
    expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.submitWorkflowTaskApproval({
          executionId: "",
          taskName: HUMAN_INPUT_TASK_NAME,
          outcome: "approve",
        }),
      Code.InvalidArgument,
      "empty execution_id",
    ));

  it("rejects an empty task_name with InvalidArgument", () =>
    expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.submitWorkflowTaskApproval({
          executionId: "wex_whatever",
          taskName: "",
          outcome: "approve",
        }),
      Code.InvalidArgument,
      "empty task_name",
    ));

  it("rejects an empty outcome with InvalidArgument", () =>
    expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.submitWorkflowTaskApproval({
          executionId: "wex_whatever",
          taskName: HUMAN_INPUT_TASK_NAME,
          outcome: "",
        }),
      Code.InvalidArgument,
      "empty outcome",
    ));

  it("returns NotFound for a missing execution", () =>
    expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.submitWorkflowTaskApproval({
          executionId: "wex_doesnotexist",
          taskName: HUMAN_INPUT_TASK_NAME,
          outcome: "approve",
        }),
      Code.NotFound,
      "missing execution",
    ));

  it("returns InvalidArgument for an unknown task_name on a gated execution", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionHumanInputWorkflow(org);
    const { executionId } = await runToGate(org, workflowId);

    await expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.submitWorkflowTaskApproval({
          executionId,
          taskName: "noSuchTask",
          outcome: "approve",
        }),
      Code.InvalidArgument,
      "unknown task_name",
    );

    // Settle the real gate so the run terminates cleanly.
    await clients.workflowExecutionCommand.submitWorkflowTaskApproval({
      executionId,
      taskName: HUMAN_INPUT_TASK_NAME,
      outcome: "approve",
      reviewer: "conformance",
    });
    await awaitTerminal(clients, executionId);
  });

  it("returns InvalidArgument for a real but non-human_input task", async () => {
    const { org } = await target.provisionTenancy();
    // A running wait execution exposes `waitTask` (type CUSTOM) in status.tasks
    // while the execution is signalable (IN_PROGRESS) — the lever to hit the
    // handler's "task is not a human_input task" branch without an approval gate.
    const workflowId = await clients.workflowCommand
      .create(makeWaitWorkflow({ org, name: uniqueName("wf-wait"), waitSeconds: 30 }))
      .then((w) => {
        fixtures.defer(() => clients.workflowCommand.delete({ value: w.metadata!.id }));
        return w.metadata!.id;
      });
    const execution = await clients.workflowExecutionCommand.create(
      makeWorkflowExecution({ org, name: uniqueName("wfx-wait"), workflowId }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: executionId }));

    await awaitPhase(clients, executionId, ExecutionPhase.EXECUTION_IN_PROGRESS);
    await awaitTaskStatus(clients, executionId, "waitTask", WorkflowTaskStatus.WORKFLOW_TASK_IN_PROGRESS);

    await expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.submitWorkflowTaskApproval({
          executionId,
          taskName: "waitTask",
          outcome: "approve",
        }),
      Code.InvalidArgument,
      "wait task is not a human_input task",
    );

    // Stop the timer.
    await clients.workflowExecutionCommand.cancel({ id: executionId });
  });

  it("returns FailedPrecondition for a submit on a terminal execution", async () => {
    const { org } = await target.provisionTenancy();
    const workflowId = await provisionHumanInputWorkflow(org);
    const { executionId } = await runToGate(org, workflowId);

    // Drive the run to COMPLETED, then submit against the now-terminal execution.
    await clients.workflowExecutionCommand.submitWorkflowTaskApproval({
      executionId,
      taskName: HUMAN_INPUT_TASK_NAME,
      outcome: "approve",
      reviewer: "conformance",
    });
    await awaitTerminal(clients, executionId);

    await expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.submitWorkflowTaskApproval({
          executionId,
          taskName: HUMAN_INPUT_TASK_NAME,
          outcome: "approve",
        }),
      Code.FailedPrecondition,
      "submit on terminal execution",
    );
  });
});
