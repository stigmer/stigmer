// Conformance suite for AgentExecution HITL tool approval (Class B).
// Domain: agentic / agentexecution — the submitApproval RPC and the
// approval-gate lifecycle a tool-using agent run goes through.
//
// This is the first slice that exercises a real *tool*: the engine can only
// reach EXECUTION_WAITING_FOR_APPROVAL when an agent references an McpServer that
// exposes an approval-gated tool. The harness provides that surface via the
// in-process HTTP MCP fixture (harness/mcp-server.ts, the `echo` tool); the
// McpServer resource is created only — the runner connects to it live at
// execution setup and gates `echo` from the agent's tool_approval_overrides (no
// connect/discovery step is required; see DD-010). Every run is scripted on the
// mock LLM: a tool_use(echo) turn drives the agent to the gate, and a terminating
// text turn lets it finish once the gate resolves.
//
// Contract facts asserted here (sourced from submit_approval.go + the HITL
// integration tests). The suite asserts the *server-owned, deterministic*
// surface. It still does not assert the per-tool-call final status of an
// APPROVED tool (its id = a langchain run_id re-emitted by the resumed stream,
// not preserved consistently) or ToolCall.args_preview (empty for MCP-wrapped
// tools, whose args are absent from the on_tool_start event). It DOES assert the
// terminal status of a REJECTED tool: as of issue #197 the runner terminalizes a
// non-executing decision from the recorded ToolCall.approval_action
// (reconcileNonExecutingDecisions), which is decision-derived and therefore
// stable across resume regardless of run_id instability. See DD-010.
//
// Asserted contract:
// - submitApproval is on the Command controller; SubmitApprovalInput is
//   {agent_execution_id, tool_call_id, ApprovalAction action, comment}, and the
//   response is the AgentExecution with the decision recorded and
//   pending_approvals recomputed synchronously.
// - APPROVE / SKIP / REJECT each resolve the single gate (response
//   pending_approvals empty) and the execution reaches EXECUTION_COMPLETED.
//   REJECT denies the tool and continues the run — it does NOT fail the
//   execution; the rejected tool call resolves to TOOL_CALL_SKIPPED with
//   approval_action=REJECT. This is the proto contract as of issue #197 — the
//   enum doc, the native runner, and the Go integration test now all agree.
// - APPROVE_ALL resolves every co-pending gate in one decision (response
//   pending_approvals empty) and the run completes without re-gating.
// - spec.auto_approve_all bypasses the gate entirely (no submit needed).
// - pending_approvals is the read model (no list-pending RPC): each entry
//   carries tool_call_id, tool_name, and mcp_server_slug.
// - Idempotency: re-submitting the same {tool_call_id, action} before the gate
//   resolves is a benign no-op that returns the current state.
// - Negatives: UNSPECIFIED action / empty ids -> InvalidArgument (proto
//   validation); unknown tool_call_id on a gated execution -> InvalidArgument;
//   missing execution -> NotFound; submit on a terminal execution ->
//   FailedPrecondition.
import { Code } from "@connectrpc/connect";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ApprovalAction,
  ExecutionPhase,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { McpToolFixture } from "../harness/mcp-server";
import { ECHO_TOOL_NAME } from "../harness/mcp-server";
import type { MockLlmProxy, ToolUseBlock } from "../harness/mock-llm";
import { anthropicText, anthropicToolUses } from "../harness/mock-llm";
import { makeAgent } from "../support/agents";
import {
  awaitPhase,
  awaitTerminal,
  makeAgentExecution,
  requireLlmProxy,
  requireMcpFixture,
} from "../support/agentexecutions";
import { makeHttpMcpServer } from "../support/mcpservers";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
let mcp: McpToolFixture;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
  mcp = requireMcpFixture(target);
});

afterEach(async () => {
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

// Provision an agent that uses the HTTP MCP fixture with `echo` gated for
// approval. The McpServer is created only; the runner connects to it live and
// the per-agent tool_approval_override is what forces the gate. Returns both ids
// the tests need.
async function provisionGatedAgent(org: string): Promise<{ agentId: string; mcpSlug: string }> {
  const server = await clients.mcpServerCommand.create(
    makeHttpMcpServer({ org, name: uniqueName("mcp"), url: mcp.url() }),
  );
  fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: server.metadata!.id }));
  const mcpSlug = server.metadata!.slug;

  const agent = await clients.agentCommand.create(
    makeAgent({
      org,
      name: uniqueName("agent-hitl"),
      mcpServerUsages: [
        {
          slug: mcpSlug,
          toolApprovalOverrides: [{ toolName: ECHO_TOOL_NAME, requiresApproval: true }],
        },
      ],
    }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return { agentId: agent.metadata!.id, mcpSlug };
}

// Run an execution to its approval gate. Scripts the given echo tool_use blocks
// (one assistant turn) followed by a terminating text turn, creates the
// execution, and awaits EXECUTION_WAITING_FOR_APPROVAL. Returns the gated
// execution and its id.
async function runToGate(
  org: string,
  agentId: string,
  blocks: ToolUseBlock[],
  opts: { autoApproveAll?: boolean } = {},
): Promise<{ executionId: string; gated: AgentExecution }> {
  mock.enqueue(anthropicToolUses(blocks));
  mock.enqueue(anthropicText("Done."));

  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName("aex-hitl"), agentId, autoApproveAll: opts.autoApproveAll }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

  const gated = await awaitPhase(clients, executionId, ExecutionPhase.EXECUTION_WAITING_FOR_APPROVAL, {
    label: "WAITING_FOR_APPROVAL",
  });
  return { executionId, gated };
}

// A single gated echo tool_use block.
function echoBlock(toolCallId: string, text: string): ToolUseBlock {
  return { toolCallId, toolName: ECHO_TOOL_NAME, toolInput: { text } };
}

describe("AgentExecution submitApproval — gate resolution", () => {
  it("APPROVE resolves the gate and completes the execution", async () => {
    const { org } = await target.provisionTenancy();
    const { agentId } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentId, [echoBlock("call_echo_approve", "hello")]);

    const toolCallId = gated.status!.pendingApprovals[0]!.toolCallId;
    const resp = await clients.agentExecutionCommand.submitApproval({
      agentExecutionId: executionId,
      toolCallId,
      action: ApprovalAction.APPROVE,
    });
    // The single gate is fully resolved synchronously: the approved entry is gone.
    expect(resp.status?.pendingApprovals.length, "approve clears the pending gate").toBe(0);

    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `approved execution should COMPLETE; reached ${ExecutionPhase[final.status?.phase ?? 0]}`,
    ).toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });

  it("SKIP resolves the gate and completes the execution", async () => {
    const { org } = await target.provisionTenancy();
    const { agentId } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentId, [echoBlock("call_echo_skip", "hello")]);

    const toolCallId = gated.status!.pendingApprovals[0]!.toolCallId;
    const resp = await clients.agentExecutionCommand.submitApproval({
      agentExecutionId: executionId,
      toolCallId,
      action: ApprovalAction.SKIP,
    });
    expect(resp.status?.pendingApprovals.length, "skip clears the pending gate").toBe(0);

    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "skipped execution should COMPLETE").toBe(ExecutionPhase.EXECUTION_COMPLETED);
  });

  it("REJECT resolves the gate; the agent continues to completion", async () => {
    const { org } = await target.provisionTenancy();
    const { agentId } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentId, [echoBlock("call_echo_reject", "hello")]);

    const toolCallId = gated.status!.pendingApprovals[0]!.toolCallId;
    const resp = await clients.agentExecutionCommand.submitApproval({
      agentExecutionId: executionId,
      toolCallId,
      action: ApprovalAction.REJECT,
      comment: "not this time",
    });
    expect(resp.status?.pendingApprovals.length, "reject clears the pending gate").toBe(0);

    // REJECT denies the tool and continues: the objection is fed back to the LLM,
    // which adapts, and the execution COMPLETES (issue #197 — the proto enum, the
    // native runner, and this suite now agree; DD-010 updated).
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "rejected execution still COMPLETES").toBe(ExecutionPhase.EXECUTION_COMPLETED);

    // The rejected tool call is terminalized deterministically — never left stuck
    // at WAITING_APPROVAL — carrying the REJECT decision for audit. This is stable
    // across resume because it is derived from the recorded approval_action, not
    // from the resumed stream's (unstable) run_id.
    const rejectedTc = final.status?.messages
      .flatMap((m) => m.toolCalls)
      .find((tc) => tc.id === toolCallId);
    expect(rejectedTc, "the rejected echo tool call is present in the transcript").toBeDefined();
    expect(rejectedTc!.status, "rejected tool call resolves to SKIPPED, not WAITING").toBe(
      ToolCallStatus.TOOL_CALL_SKIPPED,
    );
    expect(rejectedTc!.approvalAction, "the REJECT decision is preserved for audit").toBe(
      ApprovalAction.REJECT,
    );
  });

  it("APPROVE_ALL resolves every co-pending gate in a single decision", async () => {
    const { org } = await target.provisionTenancy();
    const { agentId } = await provisionGatedAgent(org);
    // Two echo calls in one assistant turn -> two co-pending approvals.
    const { executionId, gated } = await runToGate(org, agentId, [
      echoBlock("call_echo_all_1", "one"),
      echoBlock("call_echo_all_2", "two"),
    ]);

    expect(gated.status?.pendingApprovals.length, "both echo calls are co-pending").toBe(2);

    // One APPROVE_ALL on the first resolves the whole gate — no second submit.
    const resp = await clients.agentExecutionCommand.submitApproval({
      agentExecutionId: executionId,
      toolCallId: gated.status!.pendingApprovals[0]!.toolCallId,
      action: ApprovalAction.APPROVE_ALL,
    });
    // One decision empties the read model: the co-pending entry was resolved too.
    expect(resp.status?.pendingApprovals.length, "APPROVE_ALL resolves both gates at once").toBe(0);

    // Reaching COMPLETED proves the second tool call was auto-approved (a plain
    // APPROVE would have re-gated and this would never settle).
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "APPROVE_ALL completes the execution un-gated").toBe(
      ExecutionPhase.EXECUTION_COMPLETED,
    );
  });
});

describe("AgentExecution submitApproval — spec bypass and read model", () => {
  it("auto_approve_all bypasses the gate entirely (no submit needed)", async () => {
    const { org } = await target.provisionTenancy();
    const { agentId } = await provisionGatedAgent(org);

    // Same gated agent, but the execution arms auto_approve_all: the gate never
    // engages even though `echo` has requiresApproval=true.
    mock.enqueue(anthropicToolUses([echoBlock("call_echo_bypass", "hello")]));
    mock.enqueue(anthropicText("Done."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-bypass"), agentId, autoApproveAll: true }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "auto_approve_all completes without a gate").toBe(
      ExecutionPhase.EXECUTION_COMPLETED,
    );
  });

  it("exposes pending-approval details (tool_call_id, tool_name, mcp_server_slug)", async () => {
    const { org } = await target.provisionTenancy();
    const { agentId, mcpSlug } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentId, [echoBlock("call_echo_details", "peek")]);

    expect(gated.status?.pendingApprovals.length, "exactly one pending approval").toBe(1);
    const pending = gated.status!.pendingApprovals[0]!;
    expect(pending.toolCallId, "pending approval carries the tool call id").toBeTruthy();
    expect(pending.toolName, "pending approval names the tool").toBe(ECHO_TOOL_NAME);
    expect(pending.mcpServerSlug, "pending approval carries the server slug").toBe(mcpSlug);

    // Settle so the run terminates cleanly.
    await clients.agentExecutionCommand.submitApproval({
      agentExecutionId: executionId,
      toolCallId: pending.toolCallId,
      action: ApprovalAction.APPROVE,
    });
    await awaitTerminal(clients, executionId);
  });

  it("is idempotent: re-submitting the same decision before the gate resolves is benign", async () => {
    const { org } = await target.provisionTenancy();
    const { agentId } = await provisionGatedAgent(org);
    // Two co-pending calls: approving only the first leaves the gate open (the
    // second is still pending), so no resume races the second submit — making the
    // idempotent re-submit deterministic.
    const { executionId, gated } = await runToGate(org, agentId, [
      echoBlock("call_idem_1", "one"),
      echoBlock("call_idem_2", "two"),
    ]);
    const [firstId, secondId] = gated.status!.pendingApprovals.map((p) => p.toolCallId);

    const approveFirst = () =>
      clients.agentExecutionCommand.submitApproval({
        agentExecutionId: executionId,
        toolCallId: firstId,
        action: ApprovalAction.APPROVE,
      });
    const firstResp = await approveFirst();
    // One of two co-pending gates resolved: the other is still pending.
    expect(firstResp.status?.pendingApprovals.length, "one gate remains after first approve").toBe(1);

    // Same {tool_call_id, action} again while the gate is still open: a no-op
    // that returns the current state (still one pending), not an error.
    const secondResp = await approveFirst();
    expect(secondResp.status?.pendingApprovals.length, "idempotent re-submit is a no-op").toBe(1);
    expect(secondResp.status?.pendingApprovals[0]?.toolCallId, "the remaining gate is unchanged").toBe(secondId);

    // Resolve the rest of the gate and confirm the run still completes.
    await clients.agentExecutionCommand.submitApproval({
      agentExecutionId: executionId,
      toolCallId: secondId,
      action: ApprovalAction.APPROVE,
    });
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "execution completes after idempotent + final approval").toBe(
      ExecutionPhase.EXECUTION_COMPLETED,
    );
  });
});

describe("AgentExecution submitApproval — negatives", () => {
  it("rejects an UNSPECIFIED action with InvalidArgument", async () => {
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.submitApproval({
          agentExecutionId: "aex_whatever",
          toolCallId: "call_x",
          action: ApprovalAction.UNSPECIFIED,
        }),
      Code.InvalidArgument,
      "UNSPECIFIED action",
    );
  });

  it("rejects an empty agent_execution_id with InvalidArgument", async () => {
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.submitApproval({
          agentExecutionId: "",
          toolCallId: "call_x",
          action: ApprovalAction.APPROVE,
        }),
      Code.InvalidArgument,
      "empty agent_execution_id",
    );
  });

  it("rejects an empty tool_call_id with InvalidArgument", async () => {
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.submitApproval({
          agentExecutionId: "aex_whatever",
          toolCallId: "",
          action: ApprovalAction.APPROVE,
        }),
      Code.InvalidArgument,
      "empty tool_call_id",
    );
  });

  it("returns NotFound for a missing execution", async () => {
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.submitApproval({
          agentExecutionId: "aex_does_not_exist_000000",
          toolCallId: "call_x",
          action: ApprovalAction.APPROVE,
        }),
      Code.NotFound,
      "missing execution",
    );
  });

  it("returns InvalidArgument for an unknown tool_call_id on a gated execution", async () => {
    const { org } = await target.provisionTenancy();
    const { agentId } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentId, [echoBlock("call_echo_unknown", "hello")]);

    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.submitApproval({
          agentExecutionId: executionId,
          toolCallId: "call_not_a_real_id",
          action: ApprovalAction.APPROVE,
        }),
      Code.InvalidArgument,
      "unknown tool_call_id",
    );

    // Settle the real gate so the run terminates cleanly.
    await clients.agentExecutionCommand.submitApproval({
      agentExecutionId: executionId,
      toolCallId: gated.status!.pendingApprovals[0]!.toolCallId,
      action: ApprovalAction.APPROVE,
    });
    await awaitTerminal(clients, executionId);
  });

  it("returns FailedPrecondition for a submit on a terminal execution", async () => {
    const { org } = await target.provisionTenancy();
    const { agentId } = await provisionGatedAgent(org);

    // Drive a run to COMPLETED via the bypass, then submit against it.
    mock.enqueue(anthropicToolUses([echoBlock("call_echo_terminal", "hello")]));
    mock.enqueue(anthropicText("Done."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-terminal"), agentId, autoApproveAll: true }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));
    await awaitTerminal(clients, executionId);

    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.submitApproval({
          agentExecutionId: executionId,
          toolCallId: "call_echo_terminal",
          action: ApprovalAction.APPROVE,
        }),
      Code.FailedPrecondition,
      "submit on terminal execution",
    );
  });
});
