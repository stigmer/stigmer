// Conformance suite for WorkflowExecution child-agent approval FORWARDING (Class B).
// Domain: agentic / workflowexecution — the submitApproval RPC that forwards a
// child AgentExecution's tool-approval decision through its parent workflow.
//
// This is a genuinely different machine from the workflow `human_input` gate, so
// it is a separate file from workflowexecution-approval.conformance.test.ts
// (DD-011). The two must not be conflated:
//   - human_input (submitWorkflowTaskApproval): a *task-level* gate authored in
//     workflow YAML, resolved by a Temporal signal. Self-contained in the workflow.
//   - this forwarder (submitApproval): a workflow invokes an agent via an
//     `agent_call` task; when that *child* AgentExecution gates on a tool, the gate
//     surfaces at the parent's status.pending_approvals (carrying the
//     child_agent_execution_id), and submitApproval routes the decision down to the
//     child's AgentExecution.submitApproval. The parent owns no gate of its own — it
//     is a conduit.
//
// ## History: the forwarder was half-built in OSS by design (DD-012)
//
// The receiver/forwarder was complete in OSS from the start (submitApproval,
// the runner's call-agent orchestrator, all protos), but the upstream half —
// the `child_approval_required` signal the agent-execution workflow emits
// when it gates — was cloud-only for months: the retired Go agent-execution
// workflow never emitted it (source-confirmed), so the happy path was
// structurally unreachable against it. The OSS sender landed with the
// TypeScript server (D4 #23), by derivation exactly as DD-012 specified
// (identity-only signal + derive-from-child).
//
// Accordingly this suite splits along the workflowChildApprovalForwarding
// capability:
//   - Negatives are edition-agnostic (they never need a populated
//     pending_approvals) and run unconditionally against every target.
//   - The happy path is gated on the flag, which is true on every current
//     target (local-execution and cloud-execution both provision the
//     mock-LLM + MCP fixtures it needs). The gate stays: it is what made
//     the suite honest on the sender-less Go targets, and it keeps any
//     future sender-less target SKIPPED rather than falsely green.
//
// ## Asserted contract (sourced from submit_approval.go)
//
//   - submitApproval is on the Command controller; SubmitWorkflowApprovalInput is
//     {execution_id, tool_call_id, ApprovalAction action, comment}.
//   - Negatives carry the handler's codes (proto validation runs before the store
//     lookup): empty execution_id / empty tool_call_id / UNSPECIFIED action ->
//     InvalidArgument; missing execution -> NotFound; an execution with no pending
//     approvals -> FailedPrecondition. The no-pending guard has no separate phase
//     check, so both a *running* approval-free execution and a *terminal* one hit
//     it — two caller states pinned as distinct scenarios.
//   - Happy path (gated): a gated child surfaces at the parent's pending_approvals
//     with child_agent_execution_id + tool_call_id; submitApproval forwards the
//     decision; the child resumes and the workflow COMPLETES (proven by the
//     downstream task running).
//
// Negatives that need a *populated* pending_approvals — a tool_call_id that
// doesn't match, or a matched entry with an empty child_agent_execution_id — are
// deliberately NOT asserted here: OSS never produces that state, so they belong to
// the gated/cloud contract, not the edition-agnostic negatives.
import { Code } from "@connectrpc/connect";
import { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  ExecutionPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { McpToolFixture } from "../harness/mcp-server";
import { ECHO_TOOL_NAME } from "../harness/mcp-server";
import type { MockLlmProxy } from "../harness/mock-llm";
import { anthropicText, anthropicToolUses } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import { requireLlmProxy, requireMcpFixture } from "../support/agentexecutions";
import { makeHttpMcpServer } from "../support/mcpservers";
import { uniqueName } from "../support/naming";
import {
  awaitParentPendingApproval,
  awaitPhase,
  awaitTerminal,
  makeWorkflowExecution,
  taskByName,
} from "../support/workflowexecutions";
import {
  AGENT_CALL_AFTER_TASK_NAME,
  makeAgentCallWorkflow,
  makeWaitWorkflow,
  makeWorkflow,
} from "../support/workflows";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

// The capability is static per target, so read it once at collection time to gate
// the happy-path describe (constructing a target is side-effect-free; setup() is
// what boots processes). Reflects the same CONFORMANCE_TARGET the file-level
// beforeAll selects.
const forwarderEnabled = createTarget().capabilities.workflowChildApprovalForwarding;

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

describe("WorkflowExecution submitApproval (child-agent forwarder) — negatives", () => {
  it("rejects an empty execution_id with InvalidArgument", () =>
    expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.submitApproval({
          executionId: "",
          toolCallId: "call_x",
          action: ApprovalAction.APPROVE,
        }),
      Code.InvalidArgument,
      "empty execution_id",
    ));

  it("rejects an empty tool_call_id with InvalidArgument", () =>
    expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.submitApproval({
          executionId: "wex_whatever",
          toolCallId: "",
          action: ApprovalAction.APPROVE,
        }),
      Code.InvalidArgument,
      "empty tool_call_id",
    ));

  it("rejects an UNSPECIFIED action with InvalidArgument", () =>
    expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.submitApproval({
          executionId: "wex_whatever",
          toolCallId: "call_x",
          action: ApprovalAction.UNSPECIFIED,
        }),
      Code.InvalidArgument,
      "UNSPECIFIED action",
    ));

  it("returns NotFound for a missing execution", () =>
    expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.submitApproval({
          executionId: "wex_doesnotexist",
          toolCallId: "call_x",
          action: ApprovalAction.APPROVE,
        }),
      Code.NotFound,
      "missing execution",
    ));

  it("returns FailedPrecondition for a running execution with no pending approvals", async () => {
    const { org } = await target.provisionTenancy();
    // A running wait execution is genuinely in-flight (IN_PROGRESS) yet has no
    // approval gate — the cleanest way to hit the handler's no-pending guard
    // without depending on the cloud-only signal that would populate one.
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

    await expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.submitApproval({
          executionId,
          toolCallId: "call_x",
          action: ApprovalAction.APPROVE,
        }),
      Code.FailedPrecondition,
      "running execution with no pending approvals",
    );

    // Stop the timer.
    await clients.workflowExecutionCommand.cancel({ id: executionId });
  });

  it("returns FailedPrecondition for a submit on a terminal execution", async () => {
    const { org } = await target.provisionTenancy();
    // A set_vars execution completes sub-second; a terminal execution also has no
    // pending approvals, so it resolves through the same guard — pinned separately
    // because "you cannot approve a finished workflow" is its own contract promise.
    const workflowId = await clients.workflowCommand
      .create(makeWorkflow({ org, name: uniqueName("wf-setvars") }))
      .then((w) => {
        fixtures.defer(() => clients.workflowCommand.delete({ value: w.metadata!.id }));
        return w.metadata!.id;
      });
    const execution = await clients.workflowExecutionCommand.create(
      makeWorkflowExecution({ org, name: uniqueName("wfx-setvars"), workflowId }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: executionId }));

    await awaitTerminal(clients, executionId);

    await expectGrpcCode(
      () =>
        clients.workflowExecutionCommand.submitApproval({
          executionId,
          toolCallId: "call_x",
          action: ApprovalAction.APPROVE,
        }),
      Code.FailedPrecondition,
      "submit on terminal execution",
    );
  });
});

// Happy path — gated on workflowChildApprovalForwarding: true on every
// current target (local-execution and cloud-execution). The gate keeps any
// future sender-less target SKIPPED rather than falsely green. See DD-012.
describe.skipIf(!forwarderEnabled)(
  "WorkflowExecution submitApproval (child-agent forwarder) — forwarding round-trip",
  () => {
    let mock: MockLlmProxy;
    let mcp: McpToolFixture;

    beforeAll(() => {
      // Acquired here, not in the file-level beforeAll: when this block is skipped
      // these are never required, so a target that has the forwarder but no local
      // fixtures (cloud) does not break the unconditional negatives above.
      mock = requireLlmProxy(target);
      mcp = requireMcpFixture(target);
    });

    afterEach(() => {
      mock.reset();
    });

    it("forwards a child agent's approval; the child resumes and the workflow completes", async () => {
      const { org } = await target.provisionTenancy();

      // An agent that uses the MCP fixture with `echo` gated for approval — the
      // same recipe the AgentExecution HITL suite uses to reach a tool gate.
      const server = await clients.mcpServerCommand.create(
        makeHttpMcpServer({ org, name: uniqueName("mcp"), url: mcp.url() }),
      );
      fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));
      const agent = await clients.agentCommand.create(
        makeAgent({
          org,
          name: uniqueName("agent-child"),
          mcpServerUsages: [
            {
              slug: server.metadata!.slug,
              toolApprovalOverrides: [{ toolName: ECHO_TOOL_NAME, requiresApproval: true }],
            },
          ],
        }),
      );
      fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

      // A workflow whose agent_call invokes that agent, with a downstream set_vars
      // proving the run resumed after the forwarded approval.
      const workflow = await clients.workflowCommand.create(
        makeAgentCallWorkflow({
          org,
          name: uniqueName("wf-agentcall"),
          agentSlug: agent.metadata!.slug,
        }),
      );
      fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));

      // Script the child: one echo tool_use turn drives it to the gate; a
      // terminating text turn lets it finish once the approval is forwarded.
      mock.enqueue(
        anthropicToolUses([{ toolCallId: "call_child_echo", toolName: ECHO_TOOL_NAME, toolInput: { text: "hello" } }]),
      );
      mock.enqueue(anthropicText("Done."));

      const execution = await clients.workflowExecutionCommand.create(
        makeWorkflowExecution({ org, name: uniqueName("wfx-agentcall"), workflowId: workflow.metadata!.id }),
      );
      const executionId = execution.metadata!.id;
      fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: executionId }));

      // The child's gate surfaces at the parent, carrying the routing identity.
      const gated = await awaitParentPendingApproval(clients, executionId);
      const pending = gated.status!.pendingApprovals[0]!;
      expect(pending.childAgentExecutionId, "the parent gate carries the child execution id").toBeTruthy();
      expect(pending.approval?.toolCallId, "the parent gate carries the tool call id").toBeTruthy();
      expect(pending.approval?.toolName, "the parent gate names the gated tool").toBe(ECHO_TOOL_NAME);

      // Forward the decision through the parent; the handler routes it to the child.
      await clients.workflowExecutionCommand.submitApproval({
        executionId,
        toolCallId: pending.approval!.toolCallId,
        action: ApprovalAction.APPROVE,
      });

      // The child resumes and the workflow continues — the downstream task running
      // is the proof the forwarded approval reached the child and unblocked it.
      const final = await awaitTerminal(clients, executionId);
      expect(
        final.status?.phase,
        `forwarded approval should COMPLETE the workflow; reached ${ExecutionPhase[final.status?.phase ?? 0]}`,
      ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
      expect(
        taskByName(final, AGENT_CALL_AFTER_TASK_NAME)?.status,
        "the downstream task runs after the child resumes",
      ).toBe(WorkflowTaskStatus.WORKFLOW_TASK_COMPLETED);
    });
  },
);
