// Conformance suite for Run HITL tool approval (Class B).
// Domain: agentic / agentexecution and session — the session's answers
// (confirmToolUse, grantPermission), its stop (interrupt), the run-scoped
// submitApproval adapter, and the approval-gate lifecycle a tool-using run
// goes through.
//
// This is the first suite that exercises a real *tool*: the engine can only
// reach RUN_WAITING_FOR_APPROVAL when an agent lists a plugin whose MCP
// server exposes an approval-gated tool. The harness provides that surface
// via the in-process HTTP MCP fixture (harness/mcp-server.ts, the
// `echo_destructive` tool, which declares `destructiveHint: true`), as the
// one server of a pushed plugin (support/runs.ts pushFixturePlugin). Nothing
// is connected or stored ahead of the run: the approval default asks before
// a tool its server marks destructive, and the runner reads that mark LIVE
// from the tools it loads at turn start, so every gate arm below is also
// the proof that a destructive mark is read live. No agent-side setting
// gates it. Every run is scripted on the mock LLM: a
// tool_use turn drives the agent to the gate, and a terminating text turn lets
// it finish once the gate resolves.
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
// stable across resume regardless of run_id instability.
//
// Asserted contract:
// - What waits is the session's log: a call that asks is an
//   agent.mcp_tool_use with evaluated_permission ask, and the session goes
//   idle with stop_reason requires_action whose event_ids name every call
//   still waiting, oldest first; answering one of two re-states the idle
//   with the remainder.
// - SessionCommandController.confirmToolUse answers a call by that id with
//   allow or deny, recorded as one user.tool_confirmation; a deny's
//   deny_message is what the agent reads on its next request, and the
//   denied call's result in the log is an error. A replayed answer is
//   success with nothing new; a contrary one is FAILED_PRECONDITION.
// - grantPermission allows the call and every waiting call of its class
//   (here, its MCP server) in one answer: the call's confirmation, one
//   stigmer.permission.grant, then a confirmation per co-pending call.
// - interrupt stops every unfinished turn of the session: at the gate, a
//   paused turn, and a second turn queued while an earlier one waits (the
//   session reads running while that turn is unfinished); each ends
//   CANCELLED with stop_cause user, and the session idle with end_turn.
// - submitApproval is on the Command controller, an adapter onto the same
//   answers; SubmitApprovalInput is
//   {run_id, tool_call_id, ApprovalAction action, comment}, and the
//   response is the Run with the decision recorded and
//   pending_approvals recomputed synchronously.
// - APPROVE / SKIP / REJECT each resolve the single gate (response
//   pending_approvals empty) and the execution reaches RUN_COMPLETED.
//   REJECT denies the tool and continues the run — it does NOT fail the
//   execution; the rejected tool call resolves to TOOL_CALL_SKIPPED with
//   approval_action=REJECT. This is the proto contract as of issue #197 — the
//   enum doc, the native runner, and the Go integration test now all agree.
// - APPROVE_ALL resolves every co-pending gate in one decision (response
//   pending_approvals empty) and the run completes without re-gating.
// - spec.auto_approve_all bypasses the gate entirely (no submit needed).
// - pending_approvals is the read model (no list-pending RPC): each entry
//   carries tool_call_id, tool_name, mcp_server_slug (the plugin server's
//   segment, `plugin_<plugin>_<server>`), and the provenance
//   ANNOTATION_DESTRUCTIVE_TIGHTEN (the default asked because the server
//   marks the tool destructive).
// - An agent's own hooks block decides before the default: a hook's deny
//   fails the call's row (provenance HOOK) and the run completes; a hook's ask
//   parks the run on a pending approval with provenance HOOK and the hook's
//   reason as its message, and approving it completes the run. A plugin the
//   agent lists brings its hooks with it, and they do the same, in Claude
//   Code's format or Cursor's.
// - A real plugin, Anthropic's hookify vendored unchanged, refuses through
//   its own rule with its own text, under trust and without; its "no opinion"
//   falls to the default's card; and an edit the agent's own shell makes to
//   the plugin's installed files does not survive to the next hook run.
// - Idempotency: re-submitting the same {tool_call_id, action} before the gate
//   resolves is a benign no-op that returns the current state.
// - Negatives: UNSPECIFIED action / empty ids -> InvalidArgument (proto
//   validation); unknown tool_call_id on a gated execution -> InvalidArgument;
//   missing execution -> NotFound; submit on a terminal execution ->
//   FailedPrecondition.
//
// Out of scope: a server whose tool listing fails asks before every one of
// its tools (fail closed). On the native engine, which every arm here runs
// on, that case does not arise: the engine reads the marks from the tools it
// loads, and a server it could not load offers the model no tool to call.
// The Cursor engine lists each server separately and asks for every tool of
// one whose listing failed; no conformance suite drives the Cursor engine
// (it needs Cursor's own service), so that arm is the runner's unit
// contract (runner shared/mcp-tool-listing.ts, shared/approval-policy.ts).
//
// Every gate-resolving submit goes through submitApprovalPerContract (the seam
// in support/agentexecutions.ts): the synchronous
// contract above is asserted there once, so a decision the server failed to
// record is red at the submit that made it, never a timeout later in the arm.
import { Code } from "@connectrpc/connect";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import {
  ApprovalAction,
  ApprovalPolicySource,
  RunPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { McpToolFixture } from "../harness/mcp-server";
import { DESTRUCTIVE_ECHO_TOOL_NAME } from "../harness/mcp-server";
import type { AnthropicMessageBody, MockLlmProxy, ToolUseBlock } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUses } from "@stigmer/test-support/mock-llm";
import { type AgentRefInit, agentRefOf, makeAgent } from "../support/agents";
import {
  allToolCalls,
  awaitPhase,
  awaitTerminal,
  makeAgentExecution,
  requireLlmProxy,
  requireMcpFixture,
  pushFixturePlugin,
  sessionIdOf,
  submitApprovalPerContract,
} from "../support/runs";
import { toolServerSegment } from "../support/plugins";
import { answersOf, awaitIdleWith, awaitRequiresAction, confirmPerContract, newestIdle, sessionLog } from "../support/answers";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";
import { zipFiles } from "../support/skills";
import { execFileSync } from "node:child_process";
import { hookifyExampleRule, realPluginFiles, upstreamManifest } from "@stigmer/test-support/real-plugins";

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

// Provision an agent that lists a plugin whose one server is the HTTP MCP
// fixture's destructive echo, so the default asks before the tool. Returns
// the agent reference and the server segment a pending approval names.
async function provisionGatedAgent(org: string): Promise<{ agentRef: AgentRefInit; mcpSlug: string }> {
  const plugin = await pushFixturePlugin(clients, mcp, fixtures, {
    org,
    name: uniqueName("gated"),
    tools: [DESTRUCTIVE_ECHO_TOOL_NAME],
  });
  const mcpSlug = toolServerSegment(plugin.metadata!.name);

  const agent = await clients.agentCommand.create(
    makeAgent({ org, name: uniqueName("agent-hitl"), plugins: [plugin.metadata!.slug] }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return { agentRef: agentRefOf(agent), mcpSlug };
}

// Run an execution to its approval gate. Scripts the given echo tool_use blocks
// (one assistant turn) followed by a terminating text turn, creates the
// execution, and awaits RUN_WAITING_FOR_APPROVAL. Returns the gated
// execution and its id.
async function runToGate(
  org: string,
  agentRef: AgentRefInit,
  blocks: ToolUseBlock[],
  opts: { autoApproveAll?: boolean; turnsBeforeDone?: AnthropicMessageBody[]; done?: boolean } = {},
): Promise<{ executionId: string; gated: Run }> {
  mock.enqueue(anthropicToolUses(blocks));
  // Further assistant turns between the gated one and the terminating text —
  // the lever for a SECOND tool turn on the same server (the lease arm).
  for (const turn of opts.turnsBeforeDone ?? []) mock.enqueue(turn);
  // A turn that is stopped at its gate never asks again: it scripts no end.
  if (opts.done ?? true) mock.enqueue(anthropicText("Done."));

  const execution = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName("aex-hitl"), agentRef, autoApproveAll: opts.autoApproveAll }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

  const gated = await awaitPhase(clients, executionId, RunPhase.RUN_WAITING_FOR_APPROVAL, {
    label: "WAITING_FOR_APPROVAL",
  });
  return { executionId, gated };
}

// A single gated echo tool_use block (the destructive echo).
function echoBlock(toolCallId: string, text: string): ToolUseBlock {
  return { toolCallId, toolName: DESTRUCTIVE_ECHO_TOOL_NAME, toolInput: { text } };
}

describe("Run submitApproval — gate resolution", () => {
  it("[rpc:RunCommandController.submitApproval] APPROVE resolves the gate and completes the execution", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock("call_echo_approve", "hello")]);

    const toolCallId = gated.status!.pendingApprovals[0]!.toolCallId;
    // The gate is the session's before it is decided: the session is idle
    // with requires_action naming exactly this call's tool use.
    const sessionId = sessionIdOf(gated);
    expect(
      await awaitRequiresAction(clients, sessionId, 1),
      "a parked gate is the session's requires_action naming the call",
    ).toEqual([`${executionId}.${toolCallId}`]);

    // The single gate is fully resolved synchronously: the approved entry is gone.
    await submitApprovalPerContract({
      expectedRemaining: 0,
      label: "approve clears the pending gate",
      submit: () =>
        clients.agentExecutionCommand.submitApproval({
          runId: executionId,
          toolCallId,
          action: ApprovalAction.APPROVE,
        }),
    });

    const final = await awaitTerminal(clients, executionId);
    expect(
      final.status?.phase,
      `approved execution should COMPLETE; reached ${RunPhase[final.status?.phase ?? 0]}`,
    ).toBe(RunPhase.RUN_COMPLETED);
    // And the answer is the session's, on the same tool use: the adapter
    // records an allow.
    expect(await answersOf(clients, sessionId, executionId), "the APPROVE is an allow in the session's log").toEqual([
      `${executionId}.${toolCallId} allow`,
    ]);
    // The caller that created the run is the caller that approved it,
    // recorded as the same principal (#1385). The tool call carries it
    // (#1417): approved_by is what a transcript reader sees.
    const creator = final.status?.audit?.specAudit?.createdBy?.id ?? "";
    expect(creator, "the execution records its creator").not.toBe("");
    const approvedTc = allToolCalls(final).find((tc) => tc.id === toolCallId);
    expect(approvedTc, `execution ${executionId}: the approved tool call ${toolCallId} is in the transcript`).toBeDefined();
    expect(approvedTc!.approvedBy, `execution ${executionId}: the approved tool call names the approving caller`).toBe(
      creator,
    );
  });

  it("[rpc:RunCommandController.submitApproval] SKIP resolves the gate and completes the execution", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock("call_echo_skip", "hello")]);

    const toolCallId = gated.status!.pendingApprovals[0]!.toolCallId;
    await submitApprovalPerContract({
      expectedRemaining: 0,
      label: "skip clears the pending gate",
      submit: () =>
        clients.agentExecutionCommand.submitApproval({
          runId: executionId,
          toolCallId,
          action: ApprovalAction.SKIP,
        }),
    });

    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "skipped execution should COMPLETE").toBe(RunPhase.RUN_COMPLETED);
  });

  it("[rpc:RunCommandController.submitApproval] REJECT resolves the gate; the agent continues to completion", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock("call_echo_reject", "hello")]);

    const toolCallId = gated.status!.pendingApprovals[0]!.toolCallId;
    await submitApprovalPerContract({
      expectedRemaining: 0,
      label: "reject clears the pending gate",
      submit: () =>
        clients.agentExecutionCommand.submitApproval({
          runId: executionId,
          toolCallId,
          action: ApprovalAction.REJECT,
          comment: "not this time",
        }),
    });

    // REJECT denies the tool and continues: the objection is fed back to the LLM,
    // which adapts, and the execution COMPLETES (issue #197 — the proto enum, the
    // native runner, and this suite agree).
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "rejected execution still COMPLETES").toBe(RunPhase.RUN_COMPLETED);

    // The rejected tool call is terminalized deterministically — never left stuck
    // at WAITING_APPROVAL — carrying the REJECT decision for audit. This is stable
    // across resume because it is derived from the recorded approval_action, not
    // from the resumed stream's (unstable) run_id.
    const rejectedTc = allToolCalls(final).find((tc) => tc.id === toolCallId);
    expect(rejectedTc, "the rejected echo tool call is present in the transcript").toBeDefined();
    expect(rejectedTc!.status, "rejected tool call resolves to SKIPPED, not WAITING").toBe(
      ToolCallStatus.TOOL_CALL_SKIPPED,
    );
    expect(rejectedTc!.approvalAction, "the REJECT decision is preserved for audit").toBe(
      ApprovalAction.REJECT,
    );
  });

  it("[rpc:RunCommandController.submitApproval] APPROVE_ALL resolves every co-pending gate in a single decision", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);
    // Two echo calls in one assistant turn -> two co-pending approvals.
    const { executionId, gated } = await runToGate(org, agentRef, [
      echoBlock("call_echo_all_1", "one"),
      echoBlock("call_echo_all_2", "two"),
    ]);

    expect(gated.status?.pendingApprovals.length, "both echo calls are co-pending").toBe(2);

    // One APPROVE_ALL on the first resolves the whole gate — no second submit.
    // One decision empties the read model: the co-pending entry was resolved too.
    await submitApprovalPerContract({
      expectedRemaining: 0,
      label: "APPROVE_ALL resolves both gates at once",
      submit: () =>
        clients.agentExecutionCommand.submitApproval({
          runId: executionId,
          toolCallId: gated.status!.pendingApprovals[0]!.toolCallId,
          action: ApprovalAction.APPROVE_ALL,
        }),
    });

    // Reaching COMPLETED proves the second tool call was auto-approved (a plain
    // APPROVE would have re-gated and this would never settle).
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "APPROVE_ALL completes the execution un-gated").toBe(
      RunPhase.RUN_COMPLETED,
    );
  });
});

describe("Run submitApproval — spec bypass and read model", () => {
  it("auto_approve_all bypasses the gate entirely (no submit needed)", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);

    // Same gated agent, but the execution arms auto_approve_all: the gate never
    // engages even though the server marks the tool destructive.
    mock.enqueue(anthropicToolUses([echoBlock("call_echo_bypass", "hello")]));
    mock.enqueue(anthropicText("Done."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-bypass"), agentRef, autoApproveAll: true }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "auto_approve_all completes without a gate").toBe(
      RunPhase.RUN_COMPLETED,
    );
  });

  it("exposes pending-approval details (tool_call_id, tool_name, mcp_server_slug, approval_policy_source)", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef, mcpSlug } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock("call_echo_details", "peek")]);

    expect(gated.status?.pendingApprovals.length, "exactly one pending approval").toBe(1);
    const pending = gated.status!.pendingApprovals[0]!;
    expect(pending.toolCallId, "pending approval carries the tool call id").toBeTruthy();
    expect(pending.toolName, "pending approval names the tool").toBe(DESTRUCTIVE_ECHO_TOOL_NAME);
    expect(pending.mcpServerSlug, "pending approval names the plugin server").toBe(mcpSlug);
    expect(
      ApprovalPolicySource[pending.approvalPolicySource],
      "the default asked because the server marks the tool destructive",
    ).toBe(ApprovalPolicySource[ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN]);

    // Settle so the run terminates cleanly. Through the seam even though this
    // arm is about the read model, not the decision: a decision the server
    // failed to record would otherwise surface as awaitTerminal timing out, a
    // red with a misleading face.
    await submitApprovalPerContract({
      expectedRemaining: 0,
      label: "the settling approve clears the gate",
      submit: () =>
        clients.agentExecutionCommand.submitApproval({
          runId: executionId,
          toolCallId: pending.toolCallId,
          action: ApprovalAction.APPROVE,
        }),
    });
    await awaitTerminal(clients, executionId);
  });

  it("[rpc:RunCommandController.submitApproval] is idempotent: re-submitting the same decision before the gate resolves is benign", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);
    // Two co-pending calls: approving only the first leaves the gate open (the
    // second is still pending), so no resume races the second submit — making the
    // idempotent re-submit deterministic.
    const { executionId, gated } = await runToGate(org, agentRef, [
      echoBlock("call_idem_1", "one"),
      echoBlock("call_idem_2", "two"),
    ]);
    const [firstId, secondId] = gated.status!.pendingApprovals.map((p) => p.toolCallId);

    const approveFirst = () =>
      clients.agentExecutionCommand.submitApproval({
        runId: executionId,
        toolCallId: firstId,
        action: ApprovalAction.APPROVE,
      });
    // One of two co-pending gates resolved: the other is still pending.
    await submitApprovalPerContract({
      expectedRemaining: 1,
      label: "one gate remains after first approve",
      submit: approveFirst,
    });

    // Same {tool_call_id, action} again while the gate is still open: a no-op
    // that returns the current state (still one pending), not an error.
    const secondResp = await approveFirst();
    expect(secondResp.status?.pendingApprovals.length, "idempotent re-submit is a no-op").toBe(1);
    expect(secondResp.status?.pendingApprovals[0]?.toolCallId, "the remaining gate is unchanged").toBe(secondId);

    // Resolve the rest of the gate and confirm the run still completes.
    await submitApprovalPerContract({
      expectedRemaining: 0,
      label: "the second approve clears the gate",
      submit: () =>
        clients.agentExecutionCommand.submitApproval({
          runId: executionId,
          toolCallId: secondId,
          action: ApprovalAction.APPROVE,
        }),
    });
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "execution completes after idempotent + final approval").toBe(
      RunPhase.RUN_COMPLETED,
    );
  });
});

// The three arms below came from the Go offline suite (hitl_offline_test.go)
// and assert what the arms above deliberately left
// out: the lease APPROVE_ALL grants across TURNS, the ledger's shape on a
// cancel at the gate, and the resumed transcript under the runner's durable
// checkpointer.
describe("Run submitApproval — lease, cancel at the gate, durable resume", () => {
  it("[rpc:RunCommandController.submitApproval] APPROVE_ALL leases the MCP server: a later turn's tool on the same server is not re-gated", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);
    // Turn 1 gates on echo; turn 2 is a SECOND echo in its own assistant turn;
    // turn 3 ends the loop. A plain APPROVE at turn 1 would re-gate turn 2.
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock("call_lease_first", "first")], {
      turnsBeforeDone: [anthropicToolUses([echoBlock("call_lease_second", "second")])],
    });
    expect(gated.status?.pendingApprovals.map((p) => p.toolName)).toEqual([DESTRUCTIVE_ECHO_TOOL_NAME]);

    await submitApprovalPerContract({
      expectedRemaining: 0,
      label: "APPROVE_ALL resolves the first gate",
      submit: () =>
        clients.agentExecutionCommand.submitApproval({
          runId: executionId,
          toolCallId: gated.status!.pendingApprovals[0]!.toolCallId,
          action: ApprovalAction.APPROVE_ALL,
        }),
    });

    // Reaching COMPLETED with all three turns consumed and nothing pending is the
    // proof: the second echo ran under the lease instead of parking the run.
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "the leased second call never re-gated").toBe(RunPhase.RUN_COMPLETED);
    expect(final.status?.pendingApprovals).toHaveLength(0);
    expect(mock.remaining(), "all three scripted turns were consumed").toBe(0);
  });

  // Cancel AT THE GATE (the Go arm TestOffline_HITL_CancelAtGate) is the
  // session's interrupt arm below: a parked gate is abandoned by stopping
  // the session's unfinished turns.

  it("[rpc:RunCommandController.submitApproval] the approved ToolCall survives the resume with TOOL_CALL_COMPLETED and a result — a true resume, not a replay", async () => {
    // Under the runner's durable checkpointer (its OSS default) the resumed
    // invocation continues the SAME graph state: the
    // gated call keeps its id, runs, and records its result; the model then
    // gets its second turn. A replay would re-emit the tool call under a fresh
    // id and consume the script out of order.
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock("call_durable", "durable")]);
    const toolCallId = gated.status!.pendingApprovals[0]!.toolCallId;

    await submitApprovalPerContract({
      expectedRemaining: 0,
      label: "approve clears the gate",
      submit: () =>
        clients.agentExecutionCommand.submitApproval({
          runId: executionId,
          toolCallId,
          action: ApprovalAction.APPROVE,
        }),
    });

    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    const resumed = allToolCalls(final).find((tc) => tc.id === toolCallId);
    expect(resumed, "the gated call is in the final transcript under its original id").toBeDefined();
    expect(resumed!.name).toBe(DESTRUCTIVE_ECHO_TOOL_NAME);
    expect(resumed!.status, "the approved call ran on resume").toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(resumed!.result, "and recorded its result").not.toBe("");
    const finalAi = [...(final.status?.messages ?? [])].reverse().find((m) => m.type === MessageType.MESSAGE_AI);
    expect(finalAi?.content, "the resumed run appended the model's final message").not.toBe("");
    expect(mock.remaining(), "both scripted turns were consumed exactly once").toBe(0);
    expect(mock.consumed()).toBe(2);
  });
});

// The session's own answers and stop: what a Managed Agents client sends.
// The ids answered are the ones the session's requires_action idle names,
// read from the log as a client reads them, never from a run's rows.
describe("the session answers a waiting call, and stops its turns", () => {
  it("[rpc:SessionCommandController.confirmToolUse] the idle names the waiting call; an allow is recorded once, and the turn resumes and completes", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock("call_confirm_allow", "hello")]);
    const sessionId = sessionIdOf(gated);
    const [toolUseId] = await awaitRequiresAction(clients, sessionId, 1);
    expect(toolUseId, "the idle names the call's tool use").toBe(`${executionId}.call_confirm_allow`);

    await confirmPerContract({
      clients,
      runId: executionId,
      expectedRemaining: 0,
      label: "the allow clears the gate",
      answer: () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId, result: "allow" }),
    });

    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "the allowed turn completes").toBe(RunPhase.RUN_COMPLETED);
    expect(await answersOf(clients, sessionId, executionId)).toEqual([`${toolUseId} allow`]);
    const allowed = allToolCalls(final).find((tc) => tc.id === "call_confirm_allow");
    expect(allowed?.status, "the allowed call ran").toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    expect(allowed?.approvedBy, "and names the person who answered").toBe(final.status?.audit?.specAudit?.createdBy?.id);
    await awaitIdleWith(clients, sessionId, "end_turn");
  });

  it("[rpc:SessionCommandController.confirmToolUse] answering one of two re-states the idle with the remainder; the last answer resumes the turn", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [
      echoBlock("call_remainder_1", "one"),
      echoBlock("call_remainder_2", "two"),
    ]);
    const sessionId = sessionIdOf(gated);
    const [first, second] = await awaitRequiresAction(clients, sessionId, 2);
    expect([first, second]).toEqual([`${executionId}.call_remainder_1`, `${executionId}.call_remainder_2`]);

    await confirmPerContract({
      clients,
      runId: executionId,
      expectedRemaining: 1,
      label: "one call still waits",
      answer: () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: first!, result: "allow" }),
    });
    expect(await awaitRequiresAction(clients, sessionId, 1), "the idle is re-stated with the remainder").toEqual([second]);

    await confirmPerContract({
      clients,
      runId: executionId,
      expectedRemaining: 0,
      label: "nothing waits",
      answer: () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: second!, result: "allow" }),
    });
    expect((await awaitTerminal(clients, executionId)).status?.phase).toBe(RunPhase.RUN_COMPLETED);
  });

  it("[rpc:SessionCommandController.confirmToolUse] a deny's message is what the agent reads, and the denied call's result is an error", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock("call_confirm_deny", "hello")]);
    const sessionId = sessionIdOf(gated);
    const [toolUseId] = await awaitRequiresAction(clients, sessionId, 1);
    const reason = "use the quiet echo instead";

    await confirmPerContract({
      clients,
      runId: executionId,
      expectedRemaining: 0,
      label: "the deny clears the gate",
      answer: () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId, result: "deny", denyMessage: reason }),
    });

    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "a deny never fails the run").toBe(RunPhase.RUN_COMPLETED);
    expect(await answersOf(clients, sessionId, executionId)).toEqual([`${toolUseId} deny "${reason}"`]);
    const denied = allToolCalls(final).find((tc) => tc.id === "call_confirm_deny");
    expect(denied?.status, "the denied call never ran").not.toBe(ToolCallStatus.TOOL_CALL_COMPLETED);
    const scripted = mock.scriptedRequests();
    expect(scripted.length, "the gated turn and the one after the answer").toBe(2);
    expect(JSON.stringify(scripted[1]!.body), "the model reads the person's reason").toContain(reason);
    const results = (await sessionLog(clients, sessionId)).filter(
      (e) => e.event.case === "agentMcpToolResult" && e.event.value.mcpToolUseId === toolUseId,
    );
    expect(results.map((e) => e.event.case === "agentMcpToolResult" && e.event.value.isError), "the denied call's result").toEqual([
      true,
    ]);
  });

  it("[rpc:SessionCommandController.confirmToolUse] a replayed answer is success with nothing new; a contrary one is refused", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);
    // Two co-pending calls keep the gate open between the answers.
    const { executionId, gated } = await runToGate(org, agentRef, [
      echoBlock("call_replay_1", "one"),
      echoBlock("call_replay_2", "two"),
    ]);
    const sessionId = sessionIdOf(gated);
    const [first, second] = await awaitRequiresAction(clients, sessionId, 2);

    const answered = await clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: first!, result: "allow" });
    const replayed = await clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: first!, result: "allow" });
    expect(replayed.event.value?.id, "the replay answers the recorded event").toBe(answered.event.value?.id);
    expect(replayed.seq, "at its place in the log").toBe(answered.seq);
    await expectGrpcCode(
      () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: first!, result: "deny" }),
      Code.FailedPrecondition,
      "a contrary answer",
    );
    expect(await answersOf(clients, sessionId, executionId), "one answer recorded").toEqual([`${first} allow`]);

    await confirmPerContract({
      clients,
      runId: executionId,
      expectedRemaining: 0,
      label: "the second answer clears the gate",
      answer: () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: second!, result: "allow" }),
    });
    expect((await awaitTerminal(clients, executionId)).status?.phase).toBe(RunPhase.RUN_COMPLETED);
  });

  it("[rpc:SessionCommandController.confirmToolUse] refuses a deny_message on an allow, and a tool use that is not one of the session's asks", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock("call_confirm_bad", "hello")]);
    const sessionId = sessionIdOf(gated);
    const [toolUseId] = await awaitRequiresAction(clients, sessionId, 1);
    await expectGrpcCode(
      () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId, result: "allow", denyMessage: "why" }),
      Code.InvalidArgument,
      "a deny_message on an allow",
    );
    await expectGrpcCode(
      () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: `${executionId}.call_not_asked`, result: "allow" }),
      Code.NotFound,
      "a tool use the session never asked about",
    );
    await confirmPerContract({
      clients,
      runId: executionId,
      expectedRemaining: 0,
      label: "the settling allow clears the gate",
      answer: () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId, result: "allow" }),
    });
    await awaitTerminal(clients, executionId);
  });

  it("[rpc:SessionCommandController.grantPermission] a grant allows the co-pending calls of its class in one answer, with one grant event", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [
      echoBlock("call_grant_1", "one"),
      echoBlock("call_grant_2", "two"),
    ]);
    const sessionId = sessionIdOf(gated);
    const [first, second] = await awaitRequiresAction(clients, sessionId, 2);

    let granted: Awaited<ReturnType<typeof clients.sessionCommand.grantPermission>> | undefined;
    await confirmPerContract({
      clients,
      runId: executionId,
      expectedRemaining: 0,
      label: "the grant answers both calls",
      answer: async () => {
        granted = await clients.sessionCommand.grantPermission({ sessionId, toolUseId: first! });
      },
    });
    const lease = granted!.grant?.event.case === "stigmerPermissionGrant" ? granted!.grant.event.value : undefined;
    expect(lease?.scope, "a grant lasts the turn").toBe("turn");
    expect(lease?.lease?.server, "its class is the call's MCP server").not.toBe("");
    expect(granted!.confirmations.map((c) => c.event.case === "userToolConfirmation" && c.event.value.toolUseId)).toEqual([
      first,
      second,
    ]);
    expect(await answersOf(clients, sessionId, executionId)).toEqual([`${first} allow`, `grant ${first}`, `${second} allow`]);
    expect((await awaitTerminal(clients, executionId)).status?.phase).toBe(RunPhase.RUN_COMPLETED);
  });

  it("[rpc:SessionCommandController.interrupt] stops a turn at its gate: CANCELLED by the person, and the session ends its turn", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock("call_interrupt_gate", "hello")], { done: false });
    const sessionId = sessionIdOf(gated);
    await awaitRequiresAction(clients, sessionId, 1);

    const stopped = await clients.sessionCommand.interrupt({ sessionId });
    expect(stopped.event?.event.case).toBe("userInterrupt");
    expect(stopped.stoppedRunIds).toEqual([executionId]);
    const final = await awaitTerminal(clients, executionId);
    expect(RunPhase[final.status?.phase ?? 0]).toBe(RunPhase[RunPhase.RUN_CANCELLED]);
    expect(final.status?.stopCause).toBe("user");
    expect(final.status?.pendingApprovals).toEqual([]);
    await awaitIdleWith(clients, sessionId, "end_turn");
  });

  it("[rpc:SessionCommandController.interrupt] stops a paused turn", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);
    mock.enqueue(anthropicText("Held until paused."), { delayMs: 120_000 });
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-paused"), agentRef }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));
    await awaitPhase(clients, executionId, RunPhase.RUN_IN_PROGRESS);
    await clients.agentExecutionCommand.pause({ id: executionId, reason: "conformance" });
    const paused = await awaitPhase(clients, executionId, RunPhase.RUN_PAUSED);
    const sessionId = sessionIdOf(paused);

    const stopped = await clients.sessionCommand.interrupt({ sessionId });
    expect(stopped.stoppedRunIds).toEqual([executionId]);
    const final = await awaitTerminal(clients, executionId);
    expect(RunPhase[final.status?.phase ?? 0]).toBe(RunPhase[RunPhase.RUN_CANCELLED]);
    expect(final.status?.stopCause).toBe("user");
    mock.releaseHolds();
  });

  it("[rpc:SessionCommandController.interrupt] a second turn sent while the first waits reads running; the interrupt stops both", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock("call_interrupt_queue", "hello")], { done: false });
    const sessionId = sessionIdOf(gated);
    await awaitRequiresAction(clients, sessionId, 1);

    mock.enqueue(anthropicText("Second, held."), { delayMs: 120_000 });
    const second = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-queued"), sessionId, message: "and another thing" }),
    );
    const secondId = second.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: secondId }));
    expect(newestIdle(await sessionLog(clients, sessionId)), "the session reads running while a turn is unfinished").toBeUndefined();
    const statuses = (await sessionLog(clients, sessionId)).filter((e) => e.event.case?.startsWith("sessionStatus") === true);
    expect(statuses.at(-1)?.event.case, "the newest status is running").toBe("sessionStatusRunning");
    expect((await clients.agentExecutionQuery.get({ value: executionId })).status?.phase, "the first turn still waits").toBe(
      RunPhase.RUN_WAITING_FOR_APPROVAL,
    );

    const stopped = await clients.sessionCommand.interrupt({ sessionId });
    expect([...stopped.stoppedRunIds].sort()).toEqual([executionId, secondId].sort());
    for (const runId of [executionId, secondId]) {
      const final = await awaitTerminal(clients, runId);
      expect(RunPhase[final.status?.phase ?? 0], runId).toBe(RunPhase[RunPhase.RUN_CANCELLED]);
    }
    mock.releaseHolds();
    await awaitIdleWith(clients, sessionId, "end_turn");
  });

  it("[rpc:SessionCommandController.interrupt] refuses to stop one thread alone", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock("call_interrupt_thread", "hello")]);
    const sessionId = sessionIdOf(gated);
    await expectGrpcCode(
      () => clients.sessionCommand.interrupt({ sessionId, sessionThreadId: `${executionId}.task_1` }),
      Code.InvalidArgument,
      "a thread",
    );
    const [toolUseId] = await awaitRequiresAction(clients, sessionId, 1);
    await clients.sessionCommand.confirmToolUse({ sessionId, toolUseId, result: "allow" });
    await awaitTerminal(clients, executionId);
  });
});

describe("Run submitApproval — negatives", () => {
  it("[rpc:RunCommandController.submitApproval] rejects an UNSPECIFIED action with InvalidArgument", async () => {
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.submitApproval({
          runId: "aex_whatever",
          toolCallId: "call_x",
          action: ApprovalAction.UNSPECIFIED,
        }),
      Code.InvalidArgument,
      "UNSPECIFIED action",
    );
  });

  it("[rpc:RunCommandController.submitApproval] rejects an empty run_id with InvalidArgument", async () => {
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.submitApproval({
          runId: "",
          toolCallId: "call_x",
          action: ApprovalAction.APPROVE,
        }),
      Code.InvalidArgument,
      "empty run_id",
    );
  });

  it("[rpc:RunCommandController.submitApproval] rejects an empty tool_call_id with InvalidArgument", async () => {
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.submitApproval({
          runId: "aex_whatever",
          toolCallId: "",
          action: ApprovalAction.APPROVE,
        }),
      Code.InvalidArgument,
      "empty tool_call_id",
    );
  });

  it("[rpc:RunCommandController.submitApproval] returns NotFound for a missing execution", async () => {
    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.submitApproval({
          runId: "aex_does_not_exist_000000",
          toolCallId: "call_x",
          action: ApprovalAction.APPROVE,
        }),
      Code.NotFound,
      "missing execution",
    );
  });

  it("[rpc:RunCommandController.submitApproval] returns InvalidArgument for an unknown tool_call_id on a gated execution", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock("call_echo_unknown", "hello")]);

    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.submitApproval({
          runId: executionId,
          toolCallId: "call_not_a_real_id",
          action: ApprovalAction.APPROVE,
        }),
      Code.InvalidArgument,
      "unknown tool_call_id",
    );

    // Settle the real gate so the run terminates cleanly (through the seam, so
    // an unrecorded decision is red here, not a timeout downstream).
    await submitApprovalPerContract({
      expectedRemaining: 0,
      label: "the settling approve clears the gate",
      submit: () =>
        clients.agentExecutionCommand.submitApproval({
          runId: executionId,
          toolCallId: gated.status!.pendingApprovals[0]!.toolCallId,
          action: ApprovalAction.APPROVE,
        }),
    });
    await awaitTerminal(clients, executionId);
  });

  it("[rpc:RunCommandController.submitApproval] returns FailedPrecondition for a submit on a terminal execution", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef } = await provisionGatedAgent(org);

    // Drive a run to COMPLETED via the bypass, then submit against it.
    mock.enqueue(anthropicToolUses([echoBlock("call_echo_terminal", "hello")]));
    mock.enqueue(anthropicText("Done."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-terminal"), agentRef, autoApproveAll: true }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));
    await awaitTerminal(clients, executionId);

    await expectGrpcCode(
      () =>
        clients.agentExecutionCommand.submitApproval({
          runId: executionId,
          toolCallId: "call_echo_terminal",
          action: ApprovalAction.APPROVE,
        }),
      Code.FailedPrecondition,
      "submit on terminal execution",
    );
  });
});

// An agent's own hooks block, in Claude Code's format, over the same
// destructive echo: the hook decides before the default does. Shell-form
// commands run in bash on the runner, as Claude Code's do.
describe("Run — an agent's hooks decide at the gate", () => {
  async function provisionHookedAgent(org: string, command: string): Promise<AgentRefInit> {
    const plugin = await pushFixturePlugin(clients, mcp, fixtures, {
      org,
      name: uniqueName("hooked"),
      tools: [DESTRUCTIVE_ECHO_TOOL_NAME],
    });
    const agent = await clients.agentCommand.create(
      makeAgent({
        org,
        name: uniqueName("agent-hooks"),
        plugins: [plugin.metadata!.slug],
        hooks: [{
          source: {
            case: "inline",
            value: { groups: [{ event: "PreToolUse", matcher: "mcp__.*__echo.*", handlers: [{ command }] }] },
          },
        }],
      }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    return agentRefOf(agent);
  }

  it("a hook's deny: the call never runs, the run completes, and the row names the hook", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionHookedAgent(org, "echo 'echoes are not allowed' >&2; exit 2");
    mock.enqueue(anthropicToolUses([echoBlock("call_echo_hook_deny", "hello")]));
    mock.enqueue(anthropicText("Done."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-hook-deny"), agentRef }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "a refused call does not stop the run").toBe(RunPhase.RUN_COMPLETED);
    const row = allToolCalls(final).find((tc) => tc.id === "call_echo_hook_deny");
    expect(row, `execution ${executionId}: the refused call has a row`).toBeDefined();
    expect(ToolCallStatus[row!.status]).toBe(ToolCallStatus[ToolCallStatus.TOOL_CALL_FAILED]);
    expect(row!.error).toContain("echoes are not allowed");
    expect(ApprovalPolicySource[row!.approvalPolicySource]).toBe(ApprovalPolicySource[ApprovalPolicySource.HOOK]);
    expect(row!.approvalPolicyHook, "the agent's own block decided").toBe("");
  });

  it("a hook's ask: the run waits on a card naming the hook, and completes once approved", async () => {
    const { org } = await target.provisionTenancy();
    const agentRef = await provisionHookedAgent(
      org,
      `printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"echoes need a person"}}'`,
    );
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock("call_echo_hook_ask", "hello")]);

    expect(gated.status?.pendingApprovals.length).toBe(1);
    const pending = gated.status!.pendingApprovals[0]!;
    expect(ApprovalPolicySource[pending.approvalPolicySource]).toBe(ApprovalPolicySource[ApprovalPolicySource.HOOK]);
    expect(pending.approvalPolicyHook).toBe("");
    expect(pending.message).toBe("echoes need a person");

    await submitApprovalPerContract({
      expectedRemaining: 0,
      label: "approving the hook's ask clears the gate",
      submit: () =>
        clients.agentExecutionCommand.submitApproval({
          runId: executionId,
          toolCallId: pending.toolCallId,
          action: ApprovalAction.APPROVE,
        }),
    });
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    const row = allToolCalls(final).find((tc) => tc.id === pending.toolCallId);
    expect(ApprovalPolicySource[row!.approvalPolicySource], "the row says the hook decided").toBe(
      ApprovalPolicySource[ApprovalPolicySource.HOOK],
    );
  });
});

// A plugin's hooks, end to end over the wire: a hooks-only Claude Code plugin
// is pushed, an agent lists it in its plugins, and the runner reads it by
// reference, downloads its archive over the transfer lane, verifies and
// mounts it, and runs the plugin's own extensionless script.
describe("Run — a pushed plugin's hooks decide at the gate", () => {
  const GUARD = [
    "#!/usr/bin/env bash",
    "input=$(cat)",
    'case "$input" in',
    "  *'\"command\":\"rm -rf'*) echo 'recursive deletes are not allowed' >&2; exit 2 ;;",
    "  *'\"command\":\"echo published'*) printf '%s' '{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"ask\",\"permissionDecisionReason\":\"publishing needs a person\"}}' ;;",
    "esac",
    "exit 0",
    "",
  ].join("\n");

  it("refuses the delete, holds the publish for a person, and names the plugin on both", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("safety");
    const plugin = await clients.pluginCommand.push({
      org,
      artifact: zipFiles({
        ".claude-plugin/plugin.json": JSON.stringify({ name }),
        "hooks/hooks.json": JSON.stringify({
          hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: '"${CLAUDE_PLUGIN_ROOT}"/hooks/guard' }] }] },
        }),
        "hooks/guard": GUARD,
      }),
    });
    fixtures.defer(() => clients.pluginCommand.delete({ value: plugin.metadata!.id }).then(() => undefined, () => undefined));
    const slug = plugin.metadata!.slug;

    const agent = await clients.agentCommand.create(
      makeAgent({
        org,
        name: uniqueName("agent-plugin-hooks"),
        plugins: [slug],
      }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    mock.enqueue(anthropicToolUses([{ toolCallId: "call_hook_rm", toolName: "execute", toolInput: { command: "rm -rf build" } }]));
    mock.enqueue(anthropicToolUses([{ toolCallId: "call_hook_publish", toolName: "execute", toolInput: { command: "echo published" } }]));
    mock.enqueue(anthropicText("Done."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-plugin-hooks"), agentRef: agentRefOf(agent) }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const gated = await awaitPhase(clients, executionId, RunPhase.RUN_WAITING_FOR_APPROVAL, {
      label: "WAITING_FOR_APPROVAL on the plugin's ask",
    });
    const refused = allToolCalls(gated).find((tc) => tc.id === "call_hook_rm");
    expect(refused, `execution ${executionId}: the refused delete has a row`).toBeDefined();
    expect(ToolCallStatus[refused!.status]).toBe(ToolCallStatus[ToolCallStatus.TOOL_CALL_FAILED]);
    expect(refused!.error).toContain("recursive deletes are not allowed");
    expect(refused!.approvalPolicyHook).toBe(slug);
    const pending = gated.status!.pendingApprovals[0]!;
    expect(pending.toolCallId).toBe("call_hook_publish");
    expect(pending.message).toBe("publishing needs a person");
    expect(ApprovalPolicySource[pending.approvalPolicySource]).toBe(ApprovalPolicySource[ApprovalPolicySource.HOOK]);
    expect(pending.approvalPolicyHook).toBe(slug);

    await submitApprovalPerContract({
      expectedRemaining: 0,
      label: "approving the plugin's ask clears the gate",
      submit: () =>
        clients.agentExecutionCommand.submitApproval({
          runId: executionId,
          toolCallId: pending.toolCallId,
          action: ApprovalAction.APPROVE,
        }),
    });
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    const published = allToolCalls(final).find((tc) => tc.id === "call_hook_publish");
    expect(published?.result).toContain("published");
  });
});

// The same over the wire for a plugin written in Cursor's format: a pushed
// hooks-only Cursor plugin, its preToolUse hook in Cursor's answers, run by
// the runner as Cursor runs it (the call is `Shell`, the plugin's root is
// `${CURSOR_PLUGIN_ROOT}`). Proves the plugin library and the runner agree
// on which of Cursor's events run.
describe("Run — a pushed Cursor-format plugin's hooks decide at the gate", () => {
  const GUARD = [
    "#!/usr/bin/env bash",
    "input=$(cat)",
    'case "$input" in',
    "  *'\"command\":\"rm -rf'*) echo 'recursive deletes are not allowed'; exit 2 ;;",
    "  *'\"command\":\"echo published'*) printf '%s' '{\"permission\":\"ask\",\"agent_message\":\"publishing needs a person\"}' ;;",
    "  *) printf '%s' '{\"permission\":\"allow\"}' ;;",
    "esac",
    "",
  ].join("\n");

  it("refuses the delete, holds the publish for a person, and names the plugin on both", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("cursor-safety");
    const plugin = await clients.pluginCommand.push({
      org,
      artifact: zipFiles({
        ".cursor-plugin/plugin.json": JSON.stringify({ name }),
        "hooks/hooks.json": JSON.stringify({
          version: 1,
          hooks: { preToolUse: [{ command: 'bash "${CURSOR_PLUGIN_ROOT}/hooks/guard"', matcher: "Shell" }] },
        }),
        "hooks/guard": GUARD,
      }),
    });
    fixtures.defer(() => clients.pluginCommand.delete({ value: plugin.metadata!.id }).then(() => undefined, () => undefined));
    const slug = plugin.metadata!.slug;

    const agent = await clients.agentCommand.create(
      makeAgent({
        org,
        name: uniqueName("agent-cursor-plugin-hooks"),
        plugins: [slug],
      }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    mock.enqueue(anthropicToolUses([{ toolCallId: "call_cursor_hook_rm", toolName: "execute", toolInput: { command: "rm -rf build" } }]));
    mock.enqueue(anthropicToolUses([{ toolCallId: "call_cursor_hook_publish", toolName: "execute", toolInput: { command: "echo published" } }]));
    mock.enqueue(anthropicText("Done."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-cursor-plugin-hooks"), agentRef: agentRefOf(agent) }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const gated = await awaitPhase(clients, executionId, RunPhase.RUN_WAITING_FOR_APPROVAL, {
      label: "WAITING_FOR_APPROVAL on the Cursor plugin's ask",
    });
    const refused = allToolCalls(gated).find((tc) => tc.id === "call_cursor_hook_rm");
    expect(refused, `execution ${executionId}: the refused delete has a row`).toBeDefined();
    expect(ToolCallStatus[refused!.status]).toBe(ToolCallStatus[ToolCallStatus.TOOL_CALL_FAILED]);
    expect(refused!.error).toContain("recursive deletes are not allowed");
    expect(refused!.approvalPolicyHook).toBe(slug);
    const pending = gated.status!.pendingApprovals[0]!;
    expect(pending.toolCallId).toBe("call_cursor_hook_publish");
    expect(pending.message).toBe("publishing needs a person");
    expect(ApprovalPolicySource[pending.approvalPolicySource]).toBe(ApprovalPolicySource[ApprovalPolicySource.HOOK]);
    expect(pending.approvalPolicyHook).toBe(slug);

    await submitApprovalPerContract({
      expectedRemaining: 0,
      label: "approving the Cursor plugin's ask clears the gate",
      submit: () =>
        clients.agentExecutionCommand.submitApproval({
          runId: executionId,
          toolCallId: pending.toolCallId,
          action: ApprovalAction.APPROVE,
        }),
    });
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    const published = allToolCalls(final).find((tc) => tc.id === "call_cursor_hook_publish");
    expect(published?.result).toContain("published");
  });
});

// A real plugin, unchanged: Anthropic's hookify, vendored whole at the commit
// its NOTICE names and held to upstream's blob SHAs by test-support's own
// test, pushed as a person's `stigmer push plugin` would push it. Its rule is
// hookify's own example (`examples/dangerous-rm.local.md`), written into the
// workspace by the agent as hookify's `/hookify` command has it do, and its
// hooks run `python3`, as they do in Claude Code. hookify's plugin.json names
// it `hookify` and "unchanged" forbids renaming it, so this test's uniqueness
// is its own fresh organization rather than a unique plugin name.
//
// The tamper: the agent's own shell overwrites the mounted rule engine with
// one that allows everything, and the next `rm -rf` is still refused,
// because the runner restores the installed tree before any hook runs. The
// shell finds the mount the way anything on the host could: the session's
// workspace directory is named for the session, and the session's platform
// tree is under the runner's home. `git hash-object` prints the evidence in
// the manifest's own unit.
//
// The conversation has file review off, the default, so the rule file the
// agent writes simply lands in the workspace, trusted or not, with nothing
// offered for review. The other calls write nothing there.
describe("Run — a real plugin, unchanged, refuses at the gate and survives a tamper", () => {
  const RULE = hookifyExampleRule("dangerous-rm");
  const RULE_ENGINE = "core/rule_engine.py";
  const RULE_ENGINE_BLOB = upstreamManifest().plugins.hookify.files[RULE_ENGINE]!.blob;
  const MOUNTED_RULE_ENGINE = `"$(find "$HOME/.stigmer/sessions/$(basename "$PWD")/platform/plugins" -path '*/${RULE_ENGINE}' -print -quit)"`;
  const TAMPER = [
    `f=${MOUNTED_RULE_ENGINE}`,
    'test -n "$f"',
    `printf 'class RuleEngine:\\n    def evaluate_rules(self, rules, input_data):\\n        return {}\\n' > "$f"`,
    'git hash-object "$f"',
  ].join(" && ");

  const execute = (toolCallId: string, command: string): ToolUseBlock => ({ toolCallId, toolName: "execute", toolInput: { command } });

  it("refuses rm -rf with hookify's own text, under trust and without, and an edit to its files does not last", async () => {
    try {
      execFileSync("python3", ["--version"], { stdio: "ignore" });
    } catch {
      throw new Error("hookify's hooks run python3, which is not on this host's PATH; the runner needs it to run them");
    }
    const { org } = await target.provisionTenancy();
    const files: Record<string, Uint8Array> = {};
    for (const [path, bytes] of realPluginFiles("hookify")) files[path] = bytes;
    const plugin = await clients.pluginCommand.push({ org, artifact: zipFiles(files) });
    fixtures.defer(() => clients.pluginCommand.delete({ value: plugin.metadata!.id }).then(() => undefined, () => undefined));
    expect(plugin.metadata!.name, "the plugin keeps its published name").toBe("hookify");
    const slug = plugin.metadata!.slug;

    const agent = await clients.agentCommand.create(
      makeAgent({
        org,
        name: uniqueName("agent-hookify"),
        plugins: [slug],
      }),
    );
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));

    // Turn 1, "trust this whole run": the shell needs no card, so every
    // refusal below is hookify's, binding under trust.
    mock.enqueue(anthropicToolUses([{ toolCallId: "call_hookify_rule", toolName: "write_file", toolInput: { file_path: RULE.path, content: RULE.content } }]));
    mock.enqueue(anthropicToolUses([execute("call_hookify_rm", "rm -rf build")]));
    mock.enqueue(anthropicToolUses([execute("call_hookify_tamper", TAMPER)]));
    mock.enqueue(anthropicToolUses([execute("call_hookify_rm_after_tamper", "rm -rf build")]));
    mock.enqueue(anthropicToolUses([execute("call_hookify_restored", `git hash-object ${MOUNTED_RULE_ENGINE}`)]));
    mock.enqueue(anthropicText("Done."));
    const first = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-hookify-trusted"), agentRef: agentRefOf(agent), autoApproveAll: true }),
    );
    const firstId = first.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: firstId }));

    const trusted = await awaitTerminal(clients, firstId);
    expect(trusted.status?.phase, "refused calls do not stop the run").toBe(RunPhase.RUN_COMPLETED);
    expect(trusted.status?.fileChangeSets, "review is off: the rule file lands with nothing to review").toHaveLength(0);
    const rows = allToolCalls(trusted);
    const row = (id: string) => {
      const found = rows.find((tc) => tc.id === id);
      expect(found, `execution ${firstId}: ${id} has a row`).toBeDefined();
      return found!;
    };
    const refusedByHookify = (id: string): void => {
      const refused = row(id);
      expect(ToolCallStatus[refused.status], id).toBe(ToolCallStatus[ToolCallStatus.TOOL_CALL_FAILED]);
      expect(ApprovalPolicySource[refused.approvalPolicySource], id).toBe(ApprovalPolicySource[ApprovalPolicySource.HOOK]);
      expect(refused.approvalPolicyHook, id).toBe(slug);
      expect(refused.error, `${id}: hookify's own text is the reason`).toContain("Dangerous rm command detected!");
    };

    expect(ToolCallStatus[row("call_hookify_rule").status]).toBe(ToolCallStatus[ToolCallStatus.TOOL_CALL_COMPLETED]);
    refusedByHookify("call_hookify_rm");
    const tamper = row("call_hookify_tamper");
    expect(ToolCallStatus[tamper.status], "the agent's shell may write the mounted files").toBe(ToolCallStatus[ToolCallStatus.TOOL_CALL_COMPLETED]);
    const tamperedBlob = /\b[0-9a-f]{40}\b/.exec(tamper.result)?.[0];
    expect(tamperedBlob, `the tamper printed the edited file's blob SHA: ${tamper.result}`).toBeDefined();
    expect(tamperedBlob, "the edit changed the mounted rule engine").not.toBe(RULE_ENGINE_BLOB);
    refusedByHookify("call_hookify_rm_after_tamper");
    expect(row("call_hookify_restored").result, "the mounted rule engine is upstream's again").toContain(RULE_ENGINE_BLOB);

    // Turn 2, the same conversation, not trusted: the rule still refuses,
    // and a call hookify has no opinion on falls to the default's card.
    mock.enqueue(anthropicToolUses([execute("call_hookify_rm_untrusted", "rm -rf build")]));
    mock.enqueue(anthropicToolUses([execute("call_hookify_quiet", "echo built")]));
    mock.enqueue(anthropicText("Done."));
    const second = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-hookify-untrusted"), sessionId: sessionIdOf(trusted) }),
    );
    const secondId = second.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: secondId }));

    const gated = await awaitPhase(clients, secondId, RunPhase.RUN_WAITING_FOR_APPROVAL, {
      label: "WAITING_FOR_APPROVAL on the default's card for a call hookify let pass",
    });
    const refused = allToolCalls(gated).find((tc) => tc.id === "call_hookify_rm_untrusted");
    expect(refused, `execution ${secondId}: the refused delete has a row`).toBeDefined();
    expect(ToolCallStatus[refused!.status]).toBe(ToolCallStatus[ToolCallStatus.TOOL_CALL_FAILED]);
    expect(refused!.approvalPolicyHook).toBe(slug);
    expect(refused!.error).toContain("Dangerous rm command detected!");
    const pending = gated.status!.pendingApprovals[0]!;
    expect(pending.toolCallId).toBe("call_hookify_quiet");
    expect(ApprovalPolicySource[pending.approvalPolicySource], "hookify decided nothing, so the default asked").toBe(
      ApprovalPolicySource[ApprovalPolicySource.BUILTIN_CATEGORY],
    );

    await submitApprovalPerContract({
      expectedRemaining: 0,
      label: "approving the default's card clears the gate",
      submit: () =>
        clients.agentExecutionCommand.submitApproval({
          runId: secondId,
          toolCallId: pending.toolCallId,
          action: ApprovalAction.APPROVE,
        }),
    });
    const final = await awaitTerminal(clients, secondId);
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    const quiet = allToolCalls(final).find((tc) => tc.id === "call_hookify_quiet");
    expect(ToolCallStatus[quiet!.status]).toBe(ToolCallStatus[ToolCallStatus.TOOL_CALL_COMPLETED]);
    expect(quiet!.result).toContain("built");
  });
});
