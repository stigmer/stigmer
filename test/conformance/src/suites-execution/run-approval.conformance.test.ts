// Conformance suite for Run HITL tool approval (Class B).
// Domain: agentic / agentexecution and session — the session's answers
// (confirmToolUse, grantPermission), its stop (interrupt), and the
// approval-gate lifecycle a tool-using run goes through.
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
// A turn's transcript is the session's log, read as a client reads it
// (support/turn.ts folds it): what a call asked, how it was answered and how
// it ended are tool uses, asks, confirmations and results, never a run's
// rows.
//
// Asserted contract:
// - What waits is the session's log: a call that asks is an
//   agent.mcp_tool_use with evaluated_permission ask and a
//   stigmer.permission.asked naming why (policy_source, the plugin whose hook
//   asked, the message), and the session goes idle with stop_reason
//   requires_action whose event_ids name every call still waiting, oldest
//   first; answering one of two re-states the idle with the remainder.
// - SessionCommandController.confirmToolUse answers a call by that id with
//   allow or deny, recorded as one user.tool_confirmation; a deny's
//   deny_message is what the agent reads on its next request, and the
//   denied call's result in the log is an error. A replayed answer is
//   success with nothing new; a contrary one is FAILED_PRECONDITION.
// - grantPermission allows the call and every waiting call of its class
//   (here, its MCP server) in one answer: the call's confirmation, one
//   stigmer.permission.grant, then a confirmation per co-pending call; a
//   later call of the class in the same turn runs without asking.
// - An approved call survives the resume: it runs under its original id and
//   records its result, and the model gets its next request exactly once.
// - interrupt stops every unfinished turn of the session, at the gate or
//   paused; each ends CANCELLED with stop_cause user, and the session idle
//   with end_turn. While a turn waits, a message is refused, by sendMessage
//   and by create alike (one turn of a session at a time, stigmer#2429):
//   the call is answered first.
// - spec.auto_approve_all bypasses the gate entirely (no answer needed).
// - An agent's own hooks block decides before the default: a hook's deny
//   fails the call (its result is an error carrying the hook's reason) and
//   the run completes; a hook's ask parks the run on an ask whose
//   policy_source is hook, with the hook's reason as its message, and
//   allowing it completes the run. A plugin the agent lists brings its hooks
//   with it, and they do the same, in Claude Code's format or Cursor's, the
//   ask naming the plugin.
// - A real plugin, Anthropic's hookify vendored unchanged, refuses through
//   its own rule with its own text, under trust and without; its "no opinion"
//   falls to the default's ask; and an edit the agent's own shell makes to
//   the plugin's installed files does not survive to the next hook run.
//
// On Claude (the block at the end, where the target runs Claude turns):
// the engine's shell call waits before it runs, an allow runs exactly that
// call once on the engine resumed in a new activity, a deny and its reason
// reach the model and the call never runs, and a batch's gated call waits
// alone while the call beside it runs.
//
// Out of scope: a server whose tool listing fails asks before every one of
// its tools (fail closed). On the Stigmer harness, which every other arm here
// runs on, that case does not arise: the engine reads the marks from the tools it
// loads, and a server it could not load offers the model no tool to call.
// The rule is the runner's unit contract (runner shared/mcp-tool-listing.ts,
// shared/approval-policy.ts).
//
// Every gate-resolving answer goes through confirmPerContract
// (support/answers.ts): what the answer leaves waiting is asserted there
// once, so an answer the server failed to record is red at the answer that
// made it, never a timeout later in the arm.
import { Code } from "@connectrpc/connect";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { ToolUse, Turn } from "@stigmer/session-log";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import type { McpToolFixture } from "../harness/mcp-server";
import { DESTRUCTIVE_ECHO_TOOL_NAME, mcpToolName } from "../harness/mcp-server";
import type { AnthropicMessageBody, MockLlmProxy, ToolUseBlock } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUses } from "@stigmer/test-support/mock-llm";
import { type AgentRefInit, agentRefOf, makeAgent } from "../support/agents";
import {
  awaitPhase,
  awaitTerminal,
  makeAgentExecution,
  requireLlmProxy,
  requireMcpFixture,
  pushFixturePlugin,
  sessionIdOf,
} from "../support/runs";
import { toolServerSegment } from "../support/plugins";
import { answersOf, awaitIdleWith, awaitRequiresAction, confirmPerContract, newestIdle, sessionLog } from "../support/answers";
import { toolUseByCallId, toolUsesOf, turnById, turnOfRun } from "../support/turn";
import { uniqueName } from "../support/naming";
import { EXECUTE_CLAUDE_ACTIVITY_NAME } from "../../../../backend/libs/ts/temporal-codecs/src/activity-names/names";
import { invokeWorkflowIdFor, showWorkflow } from "../benchmark/temporal-history";
import { CLAUDE_ARM, type ArmStep, claudeTurnsOnly } from "../support/engine-arms";
import { createTarget, type TargetProfile } from "../targets";
import { zipFiles } from "../support/skills";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hookifyExampleRule, realPluginFiles, upstreamManifest } from "@stigmer/test-support/real-plugins";

// Collection-time capability read: whether this target runs Claude turns.
const { capabilities } = createTarget();

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
// the agent reference and the server segment an ask names.
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
// execution, its id and its session's id.
async function runToGate(
  org: string,
  agentRef: AgentRefInit,
  blocks: ToolUseBlock[],
  opts: { autoApproveAll?: boolean; turnsBeforeDone?: AnthropicMessageBody[]; done?: boolean } = {},
): Promise<{ executionId: string; gated: Run; sessionId: string }> {
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
  return { executionId, gated, sessionId: sessionIdOf(gated) };
}

// A single gated echo tool_use block (the destructive echo), called as the
// model calls it: by its server segment's name (harness/mcp-server.ts).
function echoBlock(mcpSlug: string, toolCallId: string, text: string): ToolUseBlock {
  return { toolCallId, toolName: mcpToolName(mcpSlug, DESTRUCTIVE_ECHO_TOOL_NAME), toolInput: { text } };
}

// The turn's tool use for the scripted call `callId`; red when the log has none.
function requireToolUse(turn: Turn, callId: string): ToolUse {
  const use = toolUseByCallId(turn, callId);
  expect(use, `turn ${turn.runId}: the call ${callId} is in the log`).toBeDefined();
  return use!;
}

// The turn's one waiting call: the log's only ask.
function requireOneAsk(turn: Turn): ToolUse {
  expect(turn.asks.map((ask) => ask.id), `turn ${turn.runId}: exactly one call waits`).toHaveLength(1);
  return turn.asks[0]!;
}

// Allows the turn's one waiting call through the session, per the contract.
async function allowOnlyAsk(sessionId: string, runId: string, label: string): Promise<void> {
  const ask = requireOneAsk(await turnById(clients, sessionId, runId));
  await confirmPerContract({
    clients,
    sessionId,
    runId,
    expectedRemaining: 0,
    label,
    answer: () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: ask.id, result: "allow" }),
  });
}

describe("Run approval — spec bypass and what an ask names", () => {
  it("auto_approve_all bypasses the gate entirely (no answer needed)", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef, mcpSlug } = await provisionGatedAgent(org);

    // Same gated agent, but the execution arms auto_approve_all: the gate never
    // engages even though the server marks the tool destructive.
    mock.enqueue(anthropicToolUses([echoBlock(mcpSlug, "call_echo_bypass", "hello")]));
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
    const use = requireToolUse(await turnOfRun(clients, final), "call_echo_bypass");
    expect(use.ask, "nothing asked").toBeUndefined();
    expect(use.state, "the call ran").toBe("completed");
  });

  it("an ask names the tool, its MCP server, and why it asked", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef, mcpSlug } = await provisionGatedAgent(org);
    const { executionId, sessionId } = await runToGate(org, agentRef, [echoBlock(mcpSlug, "call_echo_details", "peek")]);
    await awaitRequiresAction(clients, sessionId, 1);

    const ask = requireOneAsk(await turnById(clients, sessionId, executionId));
    expect(ask.id, "the ask is the call's tool use").toBe(`${executionId}.call_echo_details`);
    expect(ask.name, "the ask names the tool").toBe(DESTRUCTIVE_ECHO_TOOL_NAME);
    expect(ask.mcpServerName, "the ask names the plugin server").toBe(mcpSlug);
    expect(ask.evaluatedPermission).toBe("ask");
    expect(ask.input, "the ask carries the call's input").toEqual({ text: "peek" });
    expect(ask.ask?.policySource, "the default asked because the server marks the tool destructive").toBe(
      "annotation_destructive_tighten",
    );

    // Settle through the contract so the run terminates cleanly: an answer the
    // server failed to record would otherwise surface as awaitTerminal timing
    // out, a red with a misleading face.
    await allowOnlyAsk(sessionId, executionId, "the settling allow clears the gate");
    await awaitTerminal(clients, executionId);
  });
});

// The two arms below came from the Go offline suite (hitl_offline_test.go)
// and assert what the answer arms leave out: the lease a grant gives across
// the turn's model requests, and the resumed transcript under the runner's
// durable checkpointer.
describe("Run approval — the grant's lease, durable resume", () => {
  it("[rpc:SessionCommandController.grantPermission] a grant leases the MCP server: a later call on the same server in the turn is not asked", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef, mcpSlug } = await provisionGatedAgent(org);
    // Request 1 gates on echo; request 2 is a SECOND echo in its own assistant
    // turn; request 3 ends the loop. A plain allow at request 1 would ask again.
    const { executionId, sessionId } = await runToGate(org, agentRef, [echoBlock(mcpSlug, "call_lease_first", "first")], {
      turnsBeforeDone: [anthropicToolUses([echoBlock(mcpSlug, "call_lease_second", "second")])],
    });
    const [toolUseId] = await awaitRequiresAction(clients, sessionId, 1);
    expect(toolUseId).toBe(`${executionId}.call_lease_first`);

    await confirmPerContract({
      clients,
      sessionId,
      runId: executionId,
      expectedRemaining: 0,
      label: "the grant answers the first call",
      answer: () => clients.sessionCommand.grantPermission({ sessionId, toolUseId: toolUseId! }),
    });

    // Reaching COMPLETED with all three requests consumed and nothing asked is
    // the proof: the second echo ran under the lease instead of parking the run.
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "the leased second call never asked").toBe(RunPhase.RUN_COMPLETED);
    const turn = await turnOfRun(clients, final);
    const second = requireToolUse(turn, "call_lease_second");
    expect(second.ask, "the second call ran under the lease").toBeUndefined();
    expect(second.state).toBe("completed");
    expect(turn.asks).toHaveLength(0);
    expect(mock.remaining(), "all three scripted requests were consumed").toBe(0);
  });

  // Cancel AT THE GATE (the Go arm TestOffline_HITL_CancelAtGate) is the
  // session's interrupt arm below: a parked gate is abandoned by stopping
  // the session's unfinished turns.

  it("[rpc:SessionCommandController.confirmToolUse] the allowed call survives the resume, completed with a result — a true resume, not a replay", async () => {
    // Under the runner's durable checkpointer (its OSS default) the resumed
    // invocation continues the SAME graph state: the
    // gated call keeps its id, runs, and records its result; the model then
    // gets its second request. A replay would re-emit the tool call under a
    // fresh id and consume the script out of order.
    const { org } = await target.provisionTenancy();
    const { agentRef, mcpSlug } = await provisionGatedAgent(org);
    const { executionId, sessionId } = await runToGate(org, agentRef, [echoBlock(mcpSlug, "call_durable", "durable")]);
    await awaitRequiresAction(clients, sessionId, 1);

    await allowOnlyAsk(sessionId, executionId, "the allow clears the gate");

    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    const turn = await turnOfRun(clients, final);
    const resumed = requireToolUse(turn, "call_durable");
    expect(resumed.name).toBe(DESTRUCTIVE_ECHO_TOOL_NAME);
    expect(resumed.state, "the allowed call ran on resume").toBe("completed");
    expect(resumed.result?.text, "and recorded its result").not.toBe("");
    expect(toolUsesOf(turn), "the call is in the log once, under its original id").toHaveLength(1);
    expect(turn.answer, "the resumed run appended the model's final message").not.toBe("");
    expect(mock.remaining(), "both scripted requests were consumed exactly once").toBe(0);
    expect(mock.consumed()).toBe(2);
  });
});

// The session's own answers and stop: what a Managed Agents client sends.
// The ids answered are the ones the session's requires_action idle names,
// read from the log as a client reads them, never from a run's rows.
describe("the session answers a waiting call, and stops its turns", () => {
  it("[rpc:SessionCommandController.confirmToolUse] the idle names the waiting call; an allow is recorded once, and the turn resumes and completes", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef, mcpSlug } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock(mcpSlug, "call_confirm_allow", "hello")]);
    const sessionId = sessionIdOf(gated);
    const [toolUseId] = await awaitRequiresAction(clients, sessionId, 1);
    expect(toolUseId, "the idle names the call's tool use").toBe(`${executionId}.call_confirm_allow`);

    await confirmPerContract({
      clients,
      sessionId,
      runId: executionId,
      expectedRemaining: 0,
      label: "the allow clears the gate",
      answer: () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId, result: "allow" }),
    });

    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "the allowed turn completes").toBe(RunPhase.RUN_COMPLETED);
    expect(await answersOf(clients, sessionId, executionId)).toEqual([`${toolUseId} allow`]);
    const allowed = requireToolUse(await turnOfRun(clients, final), "call_confirm_allow");
    expect(allowed.state, "the allowed call ran").toBe("completed");
    expect(allowed.confirmation?.result, "on the person's allow").toBe("allow");
    await awaitIdleWith(clients, sessionId, "end_turn");
  });

  it("[rpc:SessionCommandController.confirmToolUse] answering one of two re-states the idle with the remainder; the last answer resumes the turn", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef, mcpSlug } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [
      echoBlock(mcpSlug, "call_remainder_1", "one"),
      echoBlock(mcpSlug, "call_remainder_2", "two"),
    ]);
    const sessionId = sessionIdOf(gated);
    const [first, second] = await awaitRequiresAction(clients, sessionId, 2);
    expect([first, second]).toEqual([`${executionId}.call_remainder_1`, `${executionId}.call_remainder_2`]);

    await confirmPerContract({
      clients,
      sessionId,
      runId: executionId,
      expectedRemaining: 1,
      label: "one call still waits",
      answer: () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: first!, result: "allow" }),
    });
    expect(await awaitRequiresAction(clients, sessionId, 1), "the idle is re-stated with the remainder").toEqual([second]);

    await confirmPerContract({
      clients,
      sessionId,
      runId: executionId,
      expectedRemaining: 0,
      label: "nothing waits",
      answer: () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: second!, result: "allow" }),
    });
    expect((await awaitTerminal(clients, executionId)).status?.phase).toBe(RunPhase.RUN_COMPLETED);
  });

  it("[rpc:SessionCommandController.confirmToolUse] a deny's message is what the agent reads, and the denied call's result is an error", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef, mcpSlug } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock(mcpSlug, "call_confirm_deny", "hello")]);
    const sessionId = sessionIdOf(gated);
    const [toolUseId] = await awaitRequiresAction(clients, sessionId, 1);
    const reason = "use the quiet echo instead";

    await confirmPerContract({
      clients,
      sessionId,
      runId: executionId,
      expectedRemaining: 0,
      label: "the deny clears the gate",
      answer: () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId, result: "deny", denyMessage: reason }),
    });

    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "a deny never fails the run").toBe(RunPhase.RUN_COMPLETED);
    expect(await answersOf(clients, sessionId, executionId)).toEqual([`${toolUseId} deny "${reason}"`]);
    const denied = requireToolUse(await turnOfRun(clients, final), "call_confirm_deny");
    expect(denied.state, "the denied call never ran").toBe("denied");
    expect(denied.confirmation?.denyMessage).toBe(reason);
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
    const { agentRef, mcpSlug } = await provisionGatedAgent(org);
    // Two co-pending calls keep the gate open between the answers.
    const { executionId, gated } = await runToGate(org, agentRef, [
      echoBlock(mcpSlug, "call_replay_1", "one"),
      echoBlock(mcpSlug, "call_replay_2", "two"),
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
      sessionId,
      runId: executionId,
      expectedRemaining: 0,
      label: "the second answer clears the gate",
      answer: () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: second!, result: "allow" }),
    });
    expect((await awaitTerminal(clients, executionId)).status?.phase).toBe(RunPhase.RUN_COMPLETED);
  });

  it("[rpc:SessionCommandController.confirmToolUse] refuses a deny_message on an allow, and a tool use that is not one of the session's asks", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef, mcpSlug } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock(mcpSlug, "call_confirm_bad", "hello")]);
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
      sessionId,
      runId: executionId,
      expectedRemaining: 0,
      label: "the settling allow clears the gate",
      answer: () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId, result: "allow" }),
    });
    await awaitTerminal(clients, executionId);
  });

  it("[rpc:SessionCommandController.grantPermission] a grant allows the co-pending calls of its class in one answer, with one grant event", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef, mcpSlug } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [
      echoBlock(mcpSlug, "call_grant_1", "one"),
      echoBlock(mcpSlug, "call_grant_2", "two"),
    ]);
    const sessionId = sessionIdOf(gated);
    const [first, second] = await awaitRequiresAction(clients, sessionId, 2);

    let granted: Awaited<ReturnType<typeof clients.sessionCommand.grantPermission>> | undefined;
    await confirmPerContract({
      clients,
      sessionId,
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
    const { agentRef, mcpSlug } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock(mcpSlug, "call_interrupt_gate", "hello")], { done: false });
    const sessionId = sessionIdOf(gated);
    await awaitRequiresAction(clients, sessionId, 1);

    const stopped = await clients.sessionCommand.interrupt({ sessionId });
    expect(stopped.event?.event.case).toBe("userInterrupt");
    expect(stopped.stoppedRunIds).toEqual([executionId]);
    const final = await awaitTerminal(clients, executionId);
    expect(RunPhase[final.status?.phase ?? 0]).toBe(RunPhase[RunPhase.RUN_CANCELLED]);
    expect(final.status?.stopCause).toBe("user");
    expect((await turnOfRun(clients, final)).asks, "nothing waits once the turn is stopped").toEqual([]);
    await awaitIdleWith(clients, sessionId, "end_turn");
  });

  it("[rpc:SessionCommandController.confirmToolUse] refuses an answer once the asking turn has finished: FailedPrecondition, and nothing recorded", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef, mcpSlug } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock(mcpSlug, "call_confirm_finished", "hello")], { done: false });
    const sessionId = sessionIdOf(gated);
    const [toolUseId] = await awaitRequiresAction(clients, sessionId, 1);
    await clients.sessionCommand.interrupt({ sessionId });
    await awaitPhase(clients, executionId, RunPhase.RUN_CANCELLED);

    await expectGrpcCode(
      () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: toolUseId!, result: "allow" }),
      Code.FailedPrecondition,
      "an answer to a finished turn's ask",
    );
    expect(await answersOf(clients, sessionId, executionId), "the refused answer is not in the log").toEqual([]);
  });

  it("[rpc:SessionCommandController.interrupt] stops a paused turn", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef, mcpSlug } = await provisionGatedAgent(org);
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

  it("[rpc:RunCommandController.sendMessage] a message while the turn waits is refused, naming the waiting turn; the interrupt stops the turn", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef, mcpSlug } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock(mcpSlug, "call_interrupt_queue", "hello")], { done: false });
    const sessionId = sessionIdOf(gated);
    await awaitRequiresAction(clients, sessionId, 1);

    const message = makeAgentExecution({ org, name: uniqueName("aex-while-waiting"), sessionId, message: "and another thing" });
    const refused = await expectGrpcCode(() => clients.agentExecutionCommand.sendMessage(message), Code.FailedPrecondition, "a message while the turn waits");
    expect(refused.rawMessage).toContain(executionId);
    await expectGrpcCode(() => clients.agentExecutionCommand.create(message), Code.FailedPrecondition, "a second turn while the first waits");
    expect((await clients.agentExecutionQuery.get({ value: executionId })).status?.phase, "the first turn still waits").toBe(
      RunPhase.RUN_WAITING_FOR_APPROVAL,
    );

    const stopped = await clients.sessionCommand.interrupt({ sessionId });
    expect([...stopped.stoppedRunIds]).toEqual([executionId]);
    const final = await awaitTerminal(clients, executionId);
    expect(RunPhase[final.status?.phase ?? 0]).toBe(RunPhase[RunPhase.RUN_CANCELLED]);
    await awaitIdleWith(clients, sessionId, "end_turn");
  });

  it("[rpc:SessionCommandController.interrupt] refuses to stop one thread alone", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef, mcpSlug } = await provisionGatedAgent(org);
    const { executionId, gated } = await runToGate(org, agentRef, [echoBlock(mcpSlug, "call_interrupt_thread", "hello")]);
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

// An agent's own hooks block, in Claude Code's format, over the same
// destructive echo: the hook decides before the default does. Shell-form
// commands run in bash on the runner, as Claude Code's do.
describe("Run — an agent's hooks decide at the gate", () => {
  async function provisionHookedAgent(org: string, command: string): Promise<{ agentRef: AgentRefInit; mcpSlug: string }> {
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
    return { agentRef: agentRefOf(agent), mcpSlug: toolServerSegment(plugin.metadata!.name) };
  }

  it("a hook's deny: the call never runs, the run completes, and its result carries the hook's reason", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef, mcpSlug } = await provisionHookedAgent(org, "echo 'echoes are not allowed' >&2; exit 2");
    mock.enqueue(anthropicToolUses([echoBlock(mcpSlug, "call_echo_hook_deny", "hello")]));
    mock.enqueue(anthropicText("Done."));
    const execution = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-hook-deny"), agentRef }),
    );
    const executionId = execution.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: executionId }));

    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase, "a refused call does not stop the run").toBe(RunPhase.RUN_COMPLETED);
    const refused = requireToolUse(await turnOfRun(clients, final), "call_echo_hook_deny");
    expect(refused.state).toBe("failed");
    expect(refused.ask, "a hook's deny asks no one").toBeUndefined();
    expect(refused.result?.isError).toBe(true);
    expect(refused.result?.text).toContain("echoes are not allowed");
  });

  it("a hook's ask: the run waits on an ask naming the hook, and completes once allowed", async () => {
    const { org } = await target.provisionTenancy();
    const { agentRef, mcpSlug } = await provisionHookedAgent(
      org,
      `printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"echoes need a person"}}'`,
    );
    const { executionId, sessionId } = await runToGate(org, agentRef, [echoBlock(mcpSlug, "call_echo_hook_ask", "hello")]);
    await awaitRequiresAction(clients, sessionId, 1);

    const ask = requireOneAsk(await turnById(clients, sessionId, executionId));
    expect(ask.ask?.policySource).toBe("hook");
    expect(ask.ask?.policyHook, "the agent's own block asked").toBe("");
    expect(ask.ask?.message).toBe("echoes need a person");

    await allowOnlyAsk(sessionId, executionId, "allowing the hook's ask clears the gate");
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    const allowed = requireToolUse(await turnOfRun(clients, final), "call_echo_hook_ask");
    expect(allowed.ask?.policySource, "the log keeps that the hook asked").toBe("hook");
    expect(allowed.state).toBe("completed");
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

  it("refuses the delete with the plugin's reason, and holds the publish on an ask naming the plugin", async () => {
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
    const sessionId = sessionIdOf(gated);
    await awaitRequiresAction(clients, sessionId, 1);
    const turn = await turnById(clients, sessionId, executionId);
    const refused = requireToolUse(turn, "call_hook_rm");
    expect(refused.state).toBe("failed");
    expect(refused.result?.text).toContain("recursive deletes are not allowed");
    const ask = requireOneAsk(turn);
    expect(ask.id).toBe(`${executionId}.call_hook_publish`);
    expect(ask.ask?.message).toBe("publishing needs a person");
    expect(ask.ask?.policySource).toBe("hook");
    expect(ask.ask?.policyHook, "the ask names the plugin").toBe(slug);

    await allowOnlyAsk(sessionId, executionId, "allowing the plugin's ask clears the gate");
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    const published = requireToolUse(await turnOfRun(clients, final), "call_hook_publish");
    expect(published.result?.text).toContain("published");
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

  it("refuses the delete with the plugin's reason, and holds the publish on an ask naming the plugin", async () => {
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
    const sessionId = sessionIdOf(gated);
    await awaitRequiresAction(clients, sessionId, 1);
    const turn = await turnById(clients, sessionId, executionId);
    const refused = requireToolUse(turn, "call_cursor_hook_rm");
    expect(refused.state).toBe("failed");
    expect(refused.result?.text).toContain("recursive deletes are not allowed");
    const ask = requireOneAsk(turn);
    expect(ask.id).toBe(`${executionId}.call_cursor_hook_publish`);
    expect(ask.ask?.message).toBe("publishing needs a person");
    expect(ask.ask?.policySource).toBe("hook");
    expect(ask.ask?.policyHook, "the ask names the plugin").toBe(slug);

    await allowOnlyAsk(sessionId, executionId, "allowing the Cursor plugin's ask clears the gate");
    const final = await awaitTerminal(clients, executionId);
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    const published = requireToolUse(await turnOfRun(clients, final), "call_cursor_hook_publish");
    expect(published.result?.text).toContain("published");
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
    expect(trusted.status?.fileChanges, "review is off: the rule file lands with nothing to review").toHaveLength(0);
    const trustedTurn = await turnOfRun(clients, trusted);
    const row = (id: string) => requireToolUse(trustedTurn, id);
    const refusedByHookify = (id: string): void => {
      const refused = row(id);
      expect(refused.state, id).toBe("failed");
      expect(refused.ask, `${id}: a refusal asks no one`).toBeUndefined();
      expect(refused.result?.text, `${id}: hookify's own text is the reason`).toContain("Dangerous rm command detected!");
    };

    expect(row("call_hookify_rule").state).toBe("completed");
    refusedByHookify("call_hookify_rm");
    const tamper = row("call_hookify_tamper");
    expect(tamper.state, "the agent's shell may write the mounted files").toBe("completed");
    const tamperText = tamper.result?.text ?? "";
    const tamperedBlob = /\b[0-9a-f]{40}\b/.exec(tamperText)?.[0];
    expect(tamperedBlob, `the tamper printed the edited file's blob SHA: ${tamperText}`).toBeDefined();
    expect(tamperedBlob, "the edit changed the mounted rule engine").not.toBe(RULE_ENGINE_BLOB);
    refusedByHookify("call_hookify_rm_after_tamper");
    expect(row("call_hookify_restored").result?.text, "the mounted rule engine is upstream's again").toContain(RULE_ENGINE_BLOB);

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

    await awaitPhase(clients, secondId, RunPhase.RUN_WAITING_FOR_APPROVAL, {
      label: "WAITING_FOR_APPROVAL on the default's ask for a call hookify let pass",
    });
    const sessionId = sessionIdOf(trusted);
    await awaitRequiresAction(clients, sessionId, 1);
    const gatedTurn = await turnById(clients, sessionId, secondId);
    const refused = requireToolUse(gatedTurn, "call_hookify_rm_untrusted");
    expect(refused.state).toBe("failed");
    expect(refused.result?.text).toContain("Dangerous rm command detected!");
    const ask = requireOneAsk(gatedTurn);
    expect(ask.id).toBe(`${secondId}.call_hookify_quiet`);
    expect(ask.ask?.policySource, "hookify decided nothing, so the default asked").toBe("builtin_category");

    await allowOnlyAsk(sessionId, secondId, "allowing the default's ask clears the gate");
    const final = await awaitTerminal(clients, secondId);
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    const quiet = requireToolUse(await turnOfRun(clients, final), "call_hookify_quiet");
    expect(quiet.state).toBe("completed");
    expect(quiet.result?.text).toContain("built");
  });
});

// The gate on Claude, where the pause is the engine's own: its PreToolUse
// callback defers a call that asks, the turn ends at the gate, and the
// person's answer reaches the engine's resumed session in a new activity,
// which runs exactly the call that waited (or hands the model the refusal).
// The call is the engine's shell, which the default asks before; each run
// counts its executions in a ledger file of its own.
describe("Run approval — on Claude", () => {
  beforeEach(claudeTurnsOnly(capabilities));
  /** A file a scripted shell call appends one line to each time it runs. */
  function ledger(): { readonly command: string; runs(): number } {
    const dir = mkdtempSync(join(tmpdir(), "stigmer-claude-gate-"));
    fixtures.defer(async () => rmSync(dir, { recursive: true, force: true }));
    const file = join(dir, "ran");
    return {
      command: `echo ran >> '${file}'`,
      runs: () => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter((line) => line === "ran").length : 0),
    };
  }

  /** A Claude run of a fresh agent whose model plays `steps`, created and followed to its gate. */
  async function claudeRunToGate(steps: readonly ArmStep[]): Promise<{ readonly runId: string; readonly sessionId: string }> {
    const { org } = await target.provisionTenancy();
    const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("agent-claude-gate") }));
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    const task = uniqueName("Clean the build directory");
    CLAUDE_ARM.script(mock, task, steps);
    const created = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("aex-claude-gate"), agentRef: agentRefOf(agent), message: task, sessionSpec: { harness: CLAUDE_ARM.harness } }),
    );
    const runId = created.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: runId }));
    const gated = await awaitPhase(clients, runId, RunPhase.RUN_WAITING_FOR_APPROVAL, { label: "WAITING_FOR_APPROVAL" });
    return { runId, sessionId: sessionIdOf(gated) };
  }

  /** How many times the workflow ran the turn's Claude activity. */
  async function claudeActivities(runId: string): Promise<number> {
    const engine = target.engineCoordinates?.();
    if (engine === undefined) return -1;
    const history = await showWorkflow(engine.temporalHostPort, "default", invokeWorkflowIdFor(runId));
    return history.events.filter((event) => event.activityTaskScheduledEventAttributes?.activityType?.name === EXECUTE_CLAUDE_ACTIVITY_NAME).length;
  }

  const callId = (label: string): string => `toolu_${uniqueName(label).replace(/-/g, "_")}`;

  it("[rpc:SessionCommandController.confirmToolUse] the shell call waits before it runs; an allow runs it once, on a resumed engine in a new activity, and the turn completes", async () => {
    const shell = ledger();
    const id = callId("gate_allow");
    const { runId, sessionId } = await claudeRunToGate([{ kind: "shell", id, command: shell.command }, { kind: "text", text: "Cleaned." }]);
    const [toolUseId] = await awaitRequiresAction(clients, sessionId, 1);
    expect(toolUseId, "the idle names the call").toBe(`${runId}.${id}`);
    expect(shell.runs(), "nothing ran before the answer").toBe(0);

    await confirmPerContract({ clients, sessionId, runId, expectedRemaining: 0, label: "the allow clears the gate", answer: () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: toolUseId!, result: "allow" }) });
    const final = await awaitTerminal(clients, runId);
    expect(final.status?.phase, `the allowed turn: ${final.status?.error}`).toBe(RunPhase.RUN_COMPLETED);
    expect(shell.runs(), "the approved call ran exactly once").toBe(1);
    expect(await answersOf(clients, sessionId, runId)).toEqual([`${toolUseId} allow`]);
    const allowed = requireToolUse(await turnOfRun(clients, final), id);
    expect([allowed.name, allowed.state, allowed.confirmation?.result]).toEqual(["Bash", "completed", "allow"]);
    expect(await claudeActivities(runId), "the gate's invocation and the resumed one").toBe(2);
    await awaitIdleWith(clients, sessionId, "end_turn");
  });

  it("[rpc:SessionCommandController.confirmToolUse] a deny: the call never runs, its result is an error, and the turn completes", async () => {
    const shell = ledger();
    const id = callId("gate_deny");
    const { runId, sessionId } = await claudeRunToGate([{ kind: "shell", id, command: shell.command }, { kind: "text", text: "Left it alone." }]);
    const [toolUseId] = await awaitRequiresAction(clients, sessionId, 1);
    await confirmPerContract({ clients, sessionId, runId, expectedRemaining: 0, label: "the deny clears the gate", answer: () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: toolUseId!, result: "deny" }) });

    const final = await awaitTerminal(clients, runId);
    expect(final.status?.phase, "a deny never fails the run").toBe(RunPhase.RUN_COMPLETED);
    expect(shell.runs(), "the denied call never ran").toBe(0);
    const denied = requireToolUse(await turnOfRun(clients, final), id);
    expect(denied.state).toBe("denied");
    expect(denied.result?.isError, "its result is an error").toBe(true);
  });

  it("[rpc:SessionCommandController.confirmToolUse] a deny's reason is what the model reads on its next request", async () => {
    const shell = ledger();
    const id = callId("gate_deny_reason");
    const { runId, sessionId } = await claudeRunToGate([{ kind: "shell", id, command: shell.command }, { kind: "text", text: "Understood." }]);
    const [toolUseId] = await awaitRequiresAction(clients, sessionId, 1);
    const reason = `keep the build directory ${uniqueName("reason")}`;
    await confirmPerContract({ clients, sessionId, runId, expectedRemaining: 0, label: "the deny clears the gate", answer: () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: toolUseId!, result: "deny", denyMessage: reason }) });

    const final = await awaitTerminal(clients, runId);
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    expect(shell.runs()).toBe(0);
    expect(await answersOf(clients, sessionId, runId)).toEqual([`${toolUseId} deny "${reason}"`]);
    const loop = CLAUDE_ARM.loopRequests(mock);
    expect(JSON.stringify(loop.at(-1)?.body ?? ""), "the model reads the person's reason").toContain(reason);
    expect(loop.slice(0, -1).some((request) => JSON.stringify(request.body).includes(reason)), "and never before the answer").toBe(false);
  });

  it("[rpc:SessionCommandController.confirmToolUse] a batch's gated call waits alone: the call beside it runs at once, and the approved one runs once", async () => {
    const shell = ledger();
    const gatedId = callId("gate_batch_shell");
    const besideId = callId("gate_batch_glob");
    const { runId, sessionId } = await claudeRunToGate([
      { kind: "batch", calls: [{ kind: "call", id: besideId, name: "Glob", input: { pattern: "*" } }, { kind: "shell", id: gatedId, command: shell.command }] },
      { kind: "text", text: "Both done." },
    ]);
    const [toolUseId] = await awaitRequiresAction(clients, sessionId, 1);
    expect(toolUseId, "only the shell call waits").toBe(`${runId}.${gatedId}`);
    await confirmPerContract({ clients, sessionId, runId, expectedRemaining: 0, label: "the allow clears the gate", answer: () => clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: toolUseId!, result: "allow" }) });

    const final = await awaitTerminal(clients, runId);
    expect(final.status?.phase, `the batch's turn: ${final.status?.error}`).toBe(RunPhase.RUN_COMPLETED);
    expect(shell.runs(), "the approved call ran exactly once").toBe(1);
    const turn = await turnOfRun(clients, final);
    expect(requireToolUse(turn, besideId).state, "the call beside it ran, unasked").toBe("completed");
    expect(requireToolUse(turn, gatedId).state).toBe("completed");
  });
});
