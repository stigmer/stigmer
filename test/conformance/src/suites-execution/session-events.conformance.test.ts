// Conformance suite for a session's ordered event log, on real turns.
// Domain: agentic / session — the history every later client reads.
//
// The contract pinned here, over the wire with the runner and the mock LLM:
//
//   - one turn's log reads, in order: the user's message (its text), the
//     session running, the agent's message the runner wrote, then the
//     session idle with stop_reason end_turn;
//   - the runner writes what the agent did, each fact once and in order,
//     under ids derived from the run and the row: thinking (with its text in
//     stigmer.agent.thinking), a tool use and its result, the answer; a tool
//     use that waits for a person carries evaluated_permission ask and a
//     stigmer.permission.asked, and the resumed turn adds only the result
//     and what follows; a sub-agent is a thread of its own, opened after the
//     task's tool use and closed before its result; a structured output is
//     stigmer.agent.structured_output; a turn stopped by its tool-call
//     limit ends the session as budget_reached;
//   - a stream opened on a session before a turn sees that turn's events as
//     they are appended, in the same order as the list;
//   - the session's status describes the whole session: with a second turn
//     sent while the first still works, the session reads running until
//     BOTH have ended, with one idle, after both user messages;
//   - a cancelled turn ends the session's turn as end_turn;
//   - the runner acting for a live run appends the agent's events with its
//     run credential (held here through the scoped-token exchange, without
//     a runner): a resend is accepted once, the same id with other content
//     is ALREADY_EXISTS, a stream that asked for agent.message previews
//     gets the preview, the user's turn and the session's status are
//     refused (the server's alone), another run's credential is
//     PERMISSION_DENIED, and a finished run takes no more events.
//
// The append arm presents a run credential through the RPC itself, beside
// the runner's own writes, to pin the gate.
// The outsider contract (no view, no events) is Class A,
// suites/session-events.conformance.test.ts, on the enforcing lane.
import { Code, ConnectError } from "@connectrpc/connect";
import { ApprovalAction, ApprovalPolicySource, RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import type { StreamSessionEventsResponse } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import type { AnthropicMessageBody } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { DESTRUCTIVE_ECHO_TOOL_NAME, ECHO_TOOL_NAME, type McpToolFixture } from "../harness/mcp-server";
import { agentRefOf, createSubagents, makeAgent, subagentSlugsOf } from "../support/agents";
import { pollUntil } from "../support/run-poll";
import {
  type AgentExecutionOptions,
  awaitPhase,
  awaitTerminal,
  makeAgentExecution,
  pushFixturePlugin,
  requireLlmProxy,
  requireMcpFixture,
  submitApprovalPerContract,
} from "../support/runs";
import { makeSession } from "../support/sessions";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
let mcp: McpToolFixture;
const fixtures = new FixtureTracker();

/** How long a held turn stays IN_PROGRESS unless released. */
const HOLD_MS = 120_000;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
  mcp = requireMcpFixture(target);
});

afterEach(async () => {
  mock.releaseHolds();
  // A run that ended before it reached the model would take the next arm's
  // script; wait, bounded, for every scripted turn to be claimed.
  const claimDeadline = Date.now() + 15_000;
  while (mock.remaining() > 0 && Date.now() < claimDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  await fixtures.cleanup();
  mock.reset();
  mcp.resetCaptured();
});

afterAll(async () => {
  await target?.teardown();
});

/** An event's type, by its oneof case. */
function typeOf(event: SessionEvent): string {
  return TYPE_BY_CASE[String(event.event.case)] ?? String(event.event.case);
}

/** The event types these arms read, by oneof case. */
const TYPE_BY_CASE: Readonly<Record<string, string>> = {
  userMessage: "user.message",
  sessionStatusRunning: "session.status_running",
  sessionStatusIdle: "session.status_idle",
  sessionError: "session.error",
  agentMessage: "agent.message",
  agentThinking: "agent.thinking",
  agentToolUse: "agent.tool_use",
  agentToolResult: "agent.tool_result",
  agentMcpToolUse: "agent.mcp_tool_use",
  agentMcpToolResult: "agent.mcp_tool_result",
  sessionThreadCreated: "session.thread_created",
  sessionThreadStatusRunning: "session.thread_status_running",
  sessionThreadStatusIdle: "session.thread_status_idle",
  agentThreadMessageSent: "agent.thread_message_sent",
  agentThreadMessageReceived: "agent.thread_message_received",
  stigmerAgentThinking: "stigmer.agent.thinking",
  stigmerPermissionAsked: "stigmer.permission.asked",
  stigmerHarnessNote: "stigmer.harness.note",
  stigmerAgentStructuredOutput: "stigmer.agent.structured_output",
  stigmerMemoryRecalled: "stigmer.memory.recalled",
};

/** An event's own id. */
function idOf(event: SessionEvent): string {
  return event.event.case === undefined ? "" : event.event.value.id;
}

async function newAgentRef(org: string): Promise<ReturnType<typeof agentRefOf>> {
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("events-agent") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  return agentRefOf(agent);
}

async function newSession(org: string): Promise<string> {
  const session = await clients.sessionCommand.create(
    makeSession({ org, name: uniqueName("events-session"), agentRef: await newAgentRef(org) }),
  );
  const id = session.metadata!.id;
  fixtures.defer(() => clients.sessionCommand.delete({ value: id }).catch(() => undefined));
  return id;
}

async function startTurn(org: string, sessionId: string, message: string): Promise<string> {
  const run = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName("events-run"), sessionId, message, autoApproveAll: true }),
  );
  const id = run.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: id }).catch(() => undefined));
  return id;
}

async function log(sessionId: string): Promise<SessionEvent[]> {
  return (await clients.sessionQuery.listEvents({ sessionId, pageSize: 1000 })).events;
}

/** Collects a session's stream in the background until `done` says so; `afterSeq` resumes after that seq. */
function watch(
  sessionId: string,
  eventDeltas: string[],
  done: (frames: StreamSessionEventsResponse[]) => boolean,
  afterSeq?: bigint,
): { frames: StreamSessionEventsResponse[]; finished: Promise<void>; stop: () => void } {
  const controller = new AbortController();
  const frames: StreamSessionEventsResponse[] = [];
  const finished = (async () => {
    try {
      for await (const frame of clients.sessionQuery.streamEvents(
        { sessionId, eventDeltas, ...(afterSeq === undefined ? {} : { afterSeq }) },
        { signal: controller.signal },
      )) {
        frames.push(frame);
        if (done(frames)) {
          controller.abort();
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        throw error;
      }
    }
  })();
  return { frames, finished, stop: () => controller.abort() };
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected a refusal");
}

describe("a session's event log on real turns", () => {
  it("[rpc:SessionQueryController.streamEvents] a client that listed resumes with after_seq and misses nothing appended in between", async () => {
    const { org } = await target.provisionTenancy();
    const sessionId = await newSession(org);
    mock.enqueue(anthropicText("First."));
    const first = await startTurn(org, sessionId, "first");
    await awaitTerminal(clients, first);
    const listed = await log(sessionId);
    const lastSeen = listed[listed.length - 1]!.seq;
    // A turn appended after the list, before the stream opens: the gap a
    // resume must close.
    mock.enqueue(anthropicText("Second."));
    const second = await startTurn(org, sessionId, "second");
    await awaitTerminal(clients, second);
    const stream = watch(
      sessionId,
      [],
      (frames) => frames.filter((f) => f.frame.case === "event").length === 4,
      lastSeen,
    );
    await stream.finished;
    const resumed = stream.frames.flatMap((f) => (f.frame.case === "event" ? [f.frame.value] : []));
    expect(resumed.map((e) => e.seq)).toEqual((await log(sessionId)).filter((e) => e.seq > lastSeen).map((e) => e.seq));
    expect(resumed.map(typeOf)).toEqual(["user.message", "session.status_running", "agent.message", "session.status_idle"]);
  });

  it("[rpc:SessionQueryController.listEvents] one turn's log reads the user's message, running, the agent's message, then idle as end_turn, in order", async () => {
    const { org } = await target.provisionTenancy();
    const sessionId = await newSession(org);
    mock.enqueue(anthropicText("Hello from the mock."));
    const runId = await startTurn(org, sessionId, "summarise the repo");
    const final = await awaitTerminal(clients, runId);
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);

    const events = await log(sessionId);
    expect(events.map(typeOf)).toEqual(["user.message", "session.status_running", "agent.message", "session.status_idle"]);
    expect(events.map((e) => e.seq)).toEqual([1n, 2n, 3n, 4n]);
    expect(events.every((e) => e.sessionId === sessionId && e.runId === runId)).toBe(true);
    const message = events[0]!.event;
    expect(message.case === "userMessage" && message.value.content.map((b) => b.text)).toEqual(["summarise the repo"]);
    const answer = events[2]!.event;
    expect(answer.case === "agentMessage" && answer.value.content.map((b) => b.text)).toEqual(["Hello from the mock."]);
    expect(idOf(events[2]!), "the agent's message is named by its run and its row").toBe(`${runId}.root.m0`);
    const idle = events[3]!.event;
    expect(idle.case === "sessionStatusIdle" && idle.value.stopReason?.type).toBe("end_turn");
  });

  it("[rpc:SessionQueryController.streamEvents] a stream opened before a turn sees its events as they are appended, in the list's order", async () => {
    const { org } = await target.provisionTenancy();
    const sessionId = await newSession(org);
    const stream = watch(sessionId, [], (frames) =>
      frames.some((f) => f.frame.case === "event" && f.frame.value.event.case === "sessionStatusIdle"),
    );
    // A stream sends nothing from before it opened; give it a moment to register.
    await new Promise((resolve) => setTimeout(resolve, 500));
    mock.enqueue(anthropicText("Streamed."));
    const runId = await startTurn(org, sessionId, "stream me");
    await awaitTerminal(clients, runId);
    await stream.finished;
    const streamed = stream.frames.flatMap((f) => (f.frame.case === "event" ? [f.frame.value] : []));
    expect(streamed.map(typeOf)).toEqual(["user.message", "session.status_running", "agent.message", "session.status_idle"]);
    expect(streamed.map((e) => e.seq)).toEqual((await log(sessionId)).map((e) => e.seq));
  });

  it("[rpc:SessionQueryController.listEvents] with a second turn sent while the first works, the session reads running until both have ended", async () => {
    const { org } = await target.provisionTenancy();
    const sessionId = await newSession(org);
    mock.enqueue(anthropicText("First, held."), { delayMs: HOLD_MS });
    mock.enqueue(anthropicText("Second."));
    const first = await startTurn(org, sessionId, "first");
    await awaitPhase(clients, first, RunPhase.RUN_IN_PROGRESS);
    const second = await startTurn(org, sessionId, "second");
    const whileWorking = (await log(sessionId)).map(typeOf);
    expect(whileWorking).toEqual(["user.message", "session.status_running", "user.message"]);

    mock.releaseHolds();
    await Promise.all([awaitTerminal(clients, first), awaitTerminal(clients, second)]);
    const events = await log(sessionId);
    const statuses = events.filter((e) => typeOf(e).startsWith("session.status_"));
    expect(statuses.map(typeOf), "one running, then one idle when the last turn ended").toEqual([
      "session.status_running",
      "session.status_idle",
    ]);
    expect(typeOf(events[events.length - 1]!)).toBe("session.status_idle");
  });

  it("[rpc:SessionQueryController.listEvents] a cancelled turn ends the session's turn as end_turn", async () => {
    const { org } = await target.provisionTenancy();
    const sessionId = await newSession(org);
    mock.enqueue(anthropicText("Held until cancelled."), { delayMs: HOLD_MS });
    const runId = await startTurn(org, sessionId, "cancel me");
    await awaitPhase(clients, runId, RunPhase.RUN_IN_PROGRESS);
    await clients.agentExecutionCommand.cancel({ id: runId });
    const final = await awaitTerminal(clients, runId);
    expect(final.status?.phase).toBe(RunPhase.RUN_CANCELLED);
    const events = await pollUntil(
      () => log(sessionId),
      (got) => got.length > 0 && typeOf(got[got.length - 1]!) === "session.status_idle",
      (last) => `the session never went idle after the cancel: ${JSON.stringify(last?.map(typeOf))}`,
    );
    const idle = events[events.length - 1]!.event;
    expect(idle.case === "sessionStatusIdle" && idle.value.stopReason?.type).toBe("end_turn");
  });

  it("[rpc:SessionCommandController.appendEvents] the run's runner appends the agent's events: resends once, refuses changed content, streams previews, refuses the server's types and other runs' credentials, and a finished run", async () => {
    const { org } = await target.provisionTenancy();
    const sessionId = await newSession(org);
    mock.enqueue(anthropicText("Held while the runner appends."), { delayMs: HOLD_MS });
    const runId = await startTurn(org, sessionId, "append to me");
    await awaitPhase(clients, runId, RunPhase.RUN_IN_PROGRESS);

    const minted = await clients.platformQuery.getRunnerScopedToken({ scope: { case: "runId", value: runId } });
    expect(minted.runnerScopedToken, "the exchange mints the run's credential").not.toBe("");
    const runner = target.clientsPresenting(minted.runnerScopedToken);

    const stream = watch(sessionId, ["agent.message"], (frames) =>
      frames.some((f) => f.frame.case === "event" && f.frame.value.event.case === "agentMessage"),
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    const message = {
      event: { case: "agentMessage" as const, value: { id: "evt-m1", content: [{ type: "text", text: "Working on it." }] } },
    };
    const first = await runner.sessionCommand.appendEvents({
      runId,
      events: [message],
      previews: [{ preview: { case: "eventStart", value: { event: { id: "evt-m2", type: "agent.message" } } } }],
    });
    expect(first.events.map((e) => [typeOf(e), e.sessionId, e.runId])).toEqual([["agent.message", sessionId, runId]]);
    await stream.finished;
    expect(stream.frames.map((f) => f.frame.case)).toEqual(["eventStart", "event"]);

    const again = await runner.sessionCommand.appendEvents({ runId, events: [message] });
    expect(again.events[0]?.seq, "a resend answers the first place").toBe(first.events[0]?.seq);
    expect((await log(sessionId)).filter((e) => typeOf(e) === "agent.message")).toHaveLength(1);

    const changed = await refusal(
      runner.sessionCommand.appendEvents({
        runId,
        events: [{ event: { case: "agentMessage", value: { id: "evt-m1", content: [{ type: "text", text: "Other." }] } } }],
      }),
    );
    expect(changed.code).toBe(Code.AlreadyExists);

    const serverOnly = await refusal(
      runner.sessionCommand.appendEvents({
        runId,
        events: [{ event: { case: "sessionStatusIdle", value: { id: "evt-idle", stopReason: { type: "end_turn" } } } }],
      }),
    );
    expect(serverOnly.code).toBe(Code.InvalidArgument);

    mock.enqueue(anthropicText("Another run."));
    const otherSession = await newSession(org);
    const otherRun = await startTurn(org, otherSession, "another");
    await awaitTerminal(clients, otherRun);
    const otherCredential = await clients.platformQuery.getRunnerScopedToken({ scope: { case: "runId", value: otherRun } });
    const foreign = await refusal(
      target.clientsPresenting(otherCredential.runnerScopedToken).sessionCommand.appendEvents({
        runId,
        events: [{ event: { case: "agentThinking", value: { id: "evt-t" } } }],
      }),
    );
    expect(foreign.code, "another run's credential").toBe(Code.PermissionDenied);

    mock.releaseHolds();
    await awaitTerminal(clients, runId);
    const late = await refusal(
      runner.sessionCommand.appendEvents({ runId, events: [{ event: { case: "agentThinking", value: { id: "evt-late" } } }] }),
    );
    expect(late.code, "a finished run takes no more events").toBe(Code.FailedPrecondition);
    const final = await log(sessionId);
    expect(final.map(typeOf)).toEqual([
      "user.message",
      "session.status_running",
      "agent.message",
      "agent.message",
      "session.status_idle",
    ]);
    expect(final.map(idOf).slice(2, 4), "the append's own, then the runner's").toEqual(["evt-m1", `${runId}.root.m0`]);
  });
});

describe("the runner writes what the agent did", () => {
  /** A model turn that thinks, then calls one tool. */
  function thinkThenCall(thinking: string, callId: string, tool: string, input: Record<string, unknown>): AnthropicMessageBody {
    const body = anthropicToolUse(callId, tool, input);
    return { ...body, content: [{ type: "thinking", thinking }, ...body.content] };
  }

  /** Creates a turn on its own conversation and answers its id. */
  async function turn(options: Omit<AgentExecutionOptions, "name">): Promise<string> {
    const run = await clients.agentExecutionCommand.create(makeAgentExecution({ name: uniqueName("events-run"), ...options }));
    const id = run.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: id }).catch(() => undefined));
    return id;
  }

  /** The run's events, after the session went idle. */
  async function runLog(runId: string): Promise<SessionEvent[]> {
    const final = await awaitTerminal(clients, runId);
    const sessionId = final.spec?.target.case === "sessionId" ? final.spec.target.value : "";
    return pollUntil(
      async () => (await clients.sessionQuery.listEvents({ sessionId, runId, pageSize: 1000 })).events,
      (got) => got.length > 0 && typeOf(got[got.length - 1]!) === "session.status_idle",
      (last) => `run ${runId}'s session never went idle: ${JSON.stringify(last?.map(typeOf))}`,
    );
  }

  it("[rpc:SessionQueryController.listEvents] a turn's thinking, tool use, result and answer, in order, each once, under ids derived from the run", async () => {
    const { org } = await target.provisionTenancy();
    mock.enqueue(thinkThenCall("I should look first.", "toolu_events_read", "read_file", { file_path: "/missing.md" }));
    mock.enqueue(anthropicText("There is no such file."));
    const runId = await turn({ org, agentRef: await newAgentRef(org), message: "read it", autoApproveAll: true });
    const events = await runLog(runId);
    expect(events.map(typeOf)).toEqual([
      "user.message",
      "session.status_running",
      "agent.thinking",
      "stigmer.agent.thinking",
      "agent.tool_use",
      "agent.tool_result",
      "agent.message",
      "session.status_idle",
    ]);
    const [, , thinking, thinkingText, use, result] = events;
    expect(thinkingText!.event.case === "stigmerAgentThinking" && [thinkingText!.event.value.thinkingId, thinkingText!.event.value.text]).toEqual([
      idOf(thinking!),
      "I should look first.",
    ]);
    expect(idOf(use!)).toBe(`${runId}.toolu_events_read`);
    expect(use!.event.case === "agentToolUse" && [use!.event.value.name, use!.event.value.input?.file_path]).toEqual(["read_file", "/missing.md"]);
    expect(result!.event.case === "agentToolResult" && result!.event.value.toolUseId).toBe(idOf(use!));
    expect(new Set(events.map(idOf)).size, "every fact once").toBe(events.length);
  });

  it("[rpc:SessionQueryController.listEvents] a tool use that waits carries its ask; the resumed turn adds only its result and what follows", async () => {
    const { org } = await target.provisionTenancy();
    const plugin = await pushFixturePlugin(clients, mcp, fixtures, { org, name: uniqueName("gated"), tools: [DESTRUCTIVE_ECHO_TOOL_NAME] });
    const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("events-gated"), plugins: [plugin.metadata!.slug] }));
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    mock.enqueue(anthropicToolUse("toolu_events_echo", DESTRUCTIVE_ECHO_TOOL_NAME, { text: "hello" }));
    mock.enqueue(anthropicText("Echoed."));
    const runId = await turn({ org, agentRef: agentRefOf(agent), message: "echo it" });
    const gated = await awaitPhase(clients, runId, RunPhase.RUN_WAITING_FOR_APPROVAL, { label: "WAITING_FOR_APPROVAL" });
    const sessionId = gated.spec?.target.case === "sessionId" ? gated.spec.target.value : "";
    const atGate = (await clients.sessionQuery.listEvents({ sessionId, runId, pageSize: 1000 })).events;
    expect(atGate.map(typeOf)).toEqual(["user.message", "session.status_running", "agent.mcp_tool_use", "stigmer.permission.asked"]);
    const use = atGate[2]!.event;
    expect(use.case === "agentMcpToolUse" && use.value.evaluatedPermission).toBe("ask");
    const asked = atGate[3]!.event;
    expect(asked.case === "stigmerPermissionAsked" && [asked.value.toolUseId, asked.value.policySource]).toEqual([
      idOf(atGate[2]!),
      ApprovalPolicySource.ANNOTATION_DESTRUCTIVE_TIGHTEN,
    ]);

    await submitApprovalPerContract({
      expectedRemaining: 0,
      label: "approve clears the gate",
      submit: () =>
        clients.agentExecutionCommand.submitApproval({ runId, toolCallId: gated.status!.pendingApprovals[0]!.toolCallId, action: ApprovalAction.APPROVE }),
    });
    const events = await runLog(runId);
    expect(events.map(typeOf)).toEqual([
      "user.message",
      "session.status_running",
      "agent.mcp_tool_use",
      "stigmer.permission.asked",
      "agent.mcp_tool_result",
      "agent.message",
      "session.status_idle",
    ]);
    const result = events[4]!.event;
    expect(result.case === "agentMcpToolResult" && [result.value.mcpToolUseId, result.value.isError]).toEqual([idOf(events[2]!), false]);
  });

  it("[rpc:SessionQueryController.listEvents] a sub-agent is a thread of its own, opened after the task's tool use and closed before its result", async () => {
    const { org } = await target.provisionTenancy();
    const saved = await createSubagents(clients, fixtures, org, [{ name: uniqueName("events-helper"), description: "Answers one question." }]);
    const parent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("events-parent"), subagents: subagentSlugsOf(saved) }));
    fixtures.defer(() => clients.agentCommand.delete({ value: parent.metadata!.id }));
    mock.enqueue(
      anthropicToolUse("toolu_events_task", "task", {
        description: "Ask the helper",
        prompt: "Answer in one sentence.",
        subagent_type: saved[0]!.metadata!.slug,
      }),
    );
    mock.enqueue(anthropicText("The helper's answer."));
    mock.enqueue(anthropicText("The helper says hello."));
    const runId = await turn({ org, agentRef: agentRefOf(parent), message: "delegate", autoApproveAll: true });
    const events = await runLog(runId);
    const thread = `${runId}.toolu_events_task`;
    expect(events.map(typeOf)).toEqual([
      "user.message",
      "session.status_running",
      "agent.tool_use",
      "session.thread_created",
      "agent.thread_message_sent",
      "session.thread_status_running",
      "agent.message",
      "agent.thread_message_received",
      "session.thread_status_idle",
      "agent.tool_result",
      "agent.message",
      "session.status_idle",
    ]);
    expect(events[6]!.threadId, "the sub-agent's own message is on its thread").toBe(thread);
    expect(events.filter((e) => e.threadId !== "").map(idOf)).toEqual([`${thread}.m0`]);
    const created = events[3]!.event;
    expect(created.case === "sessionThreadCreated" && created.value.sessionThreadId).toBe(thread);
  });

  it("[rpc:SessionQueryController.listEvents] a turn's structured output is stigmer.agent.structured_output, after its answer", async () => {
    const { org } = await target.provisionTenancy();
    mock.enqueue(anthropicText('{"summary":"all good"}'));
    const runId = await turn({
      org,
      agentRef: await newAgentRef(org),
      message: "summarise",
      autoApproveAll: true,
      structuredOutputSchema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
    });
    const events = await runLog(runId);
    expect(events.map(typeOf)).toEqual([
      "user.message",
      "session.status_running",
      "agent.message",
      "stigmer.agent.structured_output",
      "session.status_idle",
    ]);
    const output = events[3]!.event;
    expect(output.case === "stigmerAgentStructuredOutput" && output.value.output).toEqual({ summary: "all good" });
  });

  it("[rpc:SessionQueryController.listEvents] a turn stopped by its tool-call limit ends the session as budget_reached", async () => {
    const { org } = await target.provisionTenancy();
    const plugin = await pushFixturePlugin(clients, mcp, fixtures, { org, name: uniqueName("rounds"), tools: [ECHO_TOOL_NAME] });
    const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("events-rounds"), plugins: [plugin.metadata!.slug] }));
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    // The budget is ten rounds, the least the runner honours: the model is
    // asked ten times, and the turn stops before the eleventh request
    // (run-tool-rounds' shape).
    for (let round = 1; round <= 11; round++) {
      mock.enqueue(anthropicToolUse(`toolu_events_round_${round}`, ECHO_TOOL_NAME, { text: `round-${round}` }));
    }
    const runId = await turn({ org, agentRef: agentRefOf(agent), message: "echo each round", autoApproveAll: true, runConfig: { maxToolRounds: 10 } });
    const final = await awaitTerminal(clients, runId);
    expect(final.status?.phase).toBe(RunPhase.RUN_TERMINATED);
    expect(final.status?.stopCause).toBe("budget_reached");
    const events = await runLog(runId);
    const idle = events[events.length - 1]!.event;
    expect(idle.case === "sessionStatusIdle" && idle.value.stopReason?.type).toBe("budget_reached");
    // The turn past the budget was never requested; clear it for the next arm.
    mock.reset();
  });
});
