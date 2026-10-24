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
//     stigmer.permission.asked, the session goes idle with requires_action
//     naming it, the person's answer is a user.tool_confirmation (the
//     server's), and the resumed turn adds only the result and what
//     follows; a sub-agent is a thread of its own, opened after the
//     task's tool use and closed before its result; a structured output is
//     stigmer.agent.structured_output; a turn stopped by its tool-call
//     limit ends the session as budget_reached;
//   - a stream opened on a session before a turn sees that turn's events as
//     they are appended, in the same order as the list;
//   - every phase change of a turn is a stigmer.run.status of its run (the
//     server's): pending at its creation, running, and the phase that ends
//     it, before the session's idle; a turn that ends with a message
//     queued says so, though the session's status does not change. The
//     arms that pin the session's own sequence read the log without these;
//   - the session's status describes the whole session: a message sent
//     while the turn works (sendMessage) waits in the log with no run and
//     no processed_at, and the session reads running until the turn that
//     reads it has ended, with one idle; the message is then listed once,
//     as that turn's, after the first turn's end;
//   - a cancelled turn ends the session's turn as end_turn;
//   - the conversation's creator, following streamAttention, is told when
//     its turn finishes, "finished" with the conversation and the turn, and
//     never of a turn they stopped themselves;
//   - in a session with file review on, a turn that edits a file writes
//     stigmer.file_review.changes from its change set before it ends; a
//     person's decision is stigmer.file_review.decided, the server's own,
//     once per target; an undo's reconcile turn reads running, then
//     stigmer.file_review.reconciled, then idle, with no user.message;
//   - the runner acting for a live run appends the agent's events with its
//     run credential (held here through the scoped-token exchange, without
//     a runner): a resend is accepted once, the same id with other content
//     is ALREADY_EXISTS, a stream that asked for agent.message previews
//     gets the preview, the user's turn and the session's status are
//     refused (the server's alone), another run's credential is
//     PERMISSION_DENIED, and a finished run takes no more events;
//   - a command the agent runs in the background: the runner writes its
//     stigmer.background_command.status, never the stop request, which is
//     the server's; a person's stopBackgroundCommand on a running command
//     records one stigmer.background_command.stop_requested in the
//     command's thread and answers a second with the first; a stop of a
//     command that ended, of a call that started none, or once its turn
//     stopped working is refused.
//
// The append arm presents a run credential through the RPC itself, beside
// the runner's own writes, to pin the gate.
// The outsider contract (no view, no events) is Class A,
// suites/session-events.conformance.test.ts, on the enforcing lane.
import { Code, ConnectError } from "@connectrpc/connect";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type { Attention, StreamSessionEventsResponse } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import type { SendMessageResponse } from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import type { AnthropicMessageBody } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { GitWorkspace } from "../harness/git-workspace";
import { DESTRUCTIVE_ECHO_TOOL_NAME, ECHO_TOOL_NAME, type McpToolFixture } from "../harness/mcp-server";
import { agentRefOf, createSubagents, makeAgent, subagentSlugsOf } from "../support/agents";
import { awaitFileReview, requireChangeByPath, requireReviewSet, reviewChangeSet, reviewFileByPath } from "../support/file-review";
import { pollUntil } from "../support/run-poll";
import {
  type AgentExecutionOptions,
  awaitPhase,
  awaitRunThatRead,
  awaitTerminal,
  makeAgentExecution,
  pushFixturePlugin,
  requireLlmProxy,
  requireMcpFixture,
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
  stigmerFileReviewChanges: "stigmer.file_review.changes",
  stigmerFileReviewDecided: "stigmer.file_review.decided",
  stigmerFileReviewReconciled: "stigmer.file_review.reconciled",
  userToolConfirmation: "user.tool_confirmation",
  userInterrupt: "user.interrupt",
  stigmerPermissionGrant: "stigmer.permission.grant",
  stigmerRunStatus: "stigmer.run.status",
  stigmerToolResultFullOutput: "stigmer.tool_result.full_output",
  stigmerBackgroundCommandStatus: "stigmer.background_command.status",
  stigmerBackgroundCommandStopRequested: "stigmer.background_command.stop_requested",
};

/** The log without each turn's own stigmer.run.status: the sequence the session's arms pin. */
function sessionOnly(events: ReadonlyArray<SessionEvent>): SessionEvent[] {
  return events.filter((event) => event.event.case !== "stigmerRunStatus");
}

/** Each turn's phases, as its stigmer.run.status events say them, by run, in log order. */
function turnPhases(events: ReadonlyArray<SessionEvent>): Array<[string, string]> {
  return events.flatMap((event) =>
    event.event.case === "stigmerRunStatus" ? [[event.runId, event.event.value.phase] as [string, string]] : [],
  );
}

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

/** A message sent to the session (sendMessage): started at once, or queued while a turn works. */
async function sendTurnMessage(org: string, sessionId: string, message: string): Promise<SendMessageResponse> {
  return clients.agentExecutionCommand.sendMessage(
    makeAgentExecution({ org, name: uniqueName("events-run"), sessionId, message, autoApproveAll: true }),
  );
}

/** The session's log as the session's own arms read it (`sessionOnly`). */
async function log(sessionId: string): Promise<SessionEvent[]> {
  return sessionOnly(await fullLog(sessionId));
}

async function fullLog(sessionId: string): Promise<SessionEvent[]> {
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
      (frames) => sessionOnly(frames.flatMap((f) => (f.frame.case === "event" ? [f.frame.value] : []))).length === 4,
      lastSeen,
    );
    await stream.finished;
    const resumed = sessionOnly(stream.frames.flatMap((f) => (f.frame.case === "event" ? [f.frame.value] : [])));
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
    expect(events.every((e, i) => i === 0 || e.seq > events[i - 1]!.seq), "in the log's order").toBe(true);
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
    const streamed = sessionOnly(stream.frames.flatMap((f) => (f.frame.case === "event" ? [f.frame.value] : [])));
    expect(streamed.map(typeOf)).toEqual(["user.message", "session.status_running", "agent.message", "session.status_idle"]);
    expect(streamed.map((e) => e.seq)).toEqual((await log(sessionId)).map((e) => e.seq));
  });

  it("[rpc:RunCommandController.sendMessage] a message sent while the turn works waits in the log, and the session reads running until the turn that reads it has ended", async () => {
    const { org } = await target.provisionTenancy();
    const sessionId = await newSession(org);
    mock.enqueue(anthropicText("First, held."), { delayMs: HOLD_MS });
    mock.enqueue(anthropicText("Second."));
    const first = await startTurn(org, sessionId, "first");
    await awaitPhase(clients, first, RunPhase.RUN_IN_PROGRESS);
    const sent = await sendTurnMessage(org, sessionId, "second");
    expect(sent.run, "no second turn starts while the first works").toBeUndefined();
    const whileWorking = await log(sessionId);
    expect(whileWorking.map(typeOf)).toEqual(["user.message", "session.status_running", "user.message"]);
    const queued = whileWorking[2]!;
    expect([queued.runId, queued.event.case === "userMessage" && queued.event.value.processedAt]).toEqual(["", ""]);

    mock.releaseHolds();
    await awaitTerminal(clients, first);
    const second = await awaitRunThatRead(clients, sessionId, sent, { timeoutMs: HOLD_MS });
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: second }).catch(() => undefined));
    await awaitTerminal(clients, second);
    const events = await pollUntil(
      () => log(sessionId),
      (got) => got.length > 0 && typeOf(got[got.length - 1]!) === "session.status_idle",
      (last) => `the session never went idle: ${JSON.stringify(last?.map(typeOf))}`,
    );
    const statuses = events.filter((e) => typeOf(e).startsWith("session.status_"));
    expect(statuses.map(typeOf), "one running, then one idle when the turn that read the message ended").toEqual([
      "session.status_running",
      "session.status_idle",
    ]);
    const messages = events.filter((e) => e.event.case === "userMessage");
    expect(messages.map((e) => e.runId), "the message is listed once, as the turn's that read it").toEqual([first, second]);
  });

  it("[rpc:SessionQueryController.listEvents] each phase change of a turn is a stigmer.run.status of its run, the one that ends it before the session's idle", async () => {
    const { org } = await target.provisionTenancy();
    const sessionId = await newSession(org);
    mock.enqueue(anthropicText("Done."));
    const runId = await startTurn(org, sessionId, "phases");
    await awaitTerminal(clients, runId);
    const events = await pollUntil(
      () => fullLog(sessionId),
      (got) => got.length > 0 && typeOf(got[got.length - 1]!) === "session.status_idle",
      (last) => `the session never went idle: ${JSON.stringify(last?.map(typeOf))}`,
    );
    expect(turnPhases(events)).toEqual([
      [runId, "pending"],
      [runId, "running"],
      [runId, "completed"],
    ]);
    const types = events.map(typeOf);
    expect(types.indexOf("stigmer.run.status"), "the turn's status follows its message").toBe(1);
    expect(types.slice(-2), "the turn's end, then the session's idle").toEqual(["stigmer.run.status", "session.status_idle"]);
    const ended = events[events.length - 2]!.event;
    expect(ended.case === "stigmerRunStatus" && [ended.value.stopCause, ended.value.error]).toEqual(["", ""]);
  });

  it("[rpc:SessionQueryController.listEvents] a message sent while a turn works is read by that turn, listed as its own where it read it; the session idles once", async () => {
    const { org } = await target.provisionTenancy();
    const sessionId = await newSession(org);
    mock.enqueue(anthropicText("First, held."), { delayMs: HOLD_MS });
    mock.enqueue(anthropicText("Second."));
    const first = await startTurn(org, sessionId, "first");
    await awaitPhase(clients, first, RunPhase.RUN_IN_PROGRESS);
    const sent = await sendTurnMessage(org, sessionId, "second");
    expect(sent.run, "the message waits for the working turn").toBeUndefined();
    mock.releaseHolds();
    await awaitTerminal(clients, first);
    expect(await awaitRunThatRead(clients, sessionId, sent, { timeoutMs: HOLD_MS }), "the working turn read it").toBe(first);
    const events = await pollUntil(
      () => fullLog(sessionId),
      (got) => got.length > 0 && typeOf(got[got.length - 1]!) === "session.status_idle",
      (last) => `the session never went idle: ${JSON.stringify(last?.map(typeOf))}`,
    );
    const messages = events.flatMap((e, i) => (e.runId === first && e.event.case === "userMessage" ? [i] : []));
    const firstEnd = events.findIndex((e) => e.runId === first && e.event.case === "stigmerRunStatus" && e.event.value.phase === "completed");
    expect(messages, "the turn's own message, then the one it read").toHaveLength(2);
    expect(firstEnd, "the turn ends after it read the message").toBeGreaterThan(messages[1]!);
    expect(new Set(events.map((e) => e.runId).filter((runId) => runId !== "")), "no second turn").toEqual(new Set([first]));
    const idles = events.flatMap((e, i) => (e.event.case === "sessionStatusIdle" ? [i] : []));
    expect(idles, "the session idles once, after the turn ended").toEqual([events.length - 1]);
  });

  it("[rpc:SessionQueryController.listEvents] an interrupted turn ends the session's turn as end_turn", async () => {
    const { org } = await target.provisionTenancy();
    const sessionId = await newSession(org);
    mock.enqueue(anthropicText("Held until interrupted."), { delayMs: HOLD_MS });
    const runId = await startTurn(org, sessionId, "stop me");
    await awaitPhase(clients, runId, RunPhase.RUN_IN_PROGRESS);
    await clients.sessionCommand.interrupt({ sessionId });
    const final = await awaitTerminal(clients, runId);
    expect(final.status?.phase).toBe(RunPhase.RUN_CANCELLED);
    const events = await pollUntil(
      () => log(sessionId),
      (got) => got.length > 0 && typeOf(got[got.length - 1]!) === "session.status_idle",
      (last) => `the session never went idle after the interrupt: ${JSON.stringify(last?.map(typeOf))}`,
    );
    const idle = events[events.length - 1]!.event;
    expect(idle.case === "sessionStatusIdle" && idle.value.stopReason?.type).toBe("end_turn");
  });

  it("[rpc:SessionCommandController.bindHarnessState] the run's runner records the harness state in the session's status; an edit made during the turn stays; a credential for another run is refused", async () => {
    const { org } = await target.provisionTenancy();
    const sessionId = await newSession(org);
    mock.enqueue(anthropicText("Held while the runner binds."), { delayMs: HOLD_MS });
    const runId = await startTurn(org, sessionId, "bind for me");
    await awaitPhase(clients, runId, RunPhase.RUN_IN_PROGRESS);

    // The owner edits the conversation while the turn runs.
    await clients.sessionCommand.update({
      resource: { metadata: { id: sessionId }, spec: { subject: "Renamed during the turn" } },
      updateMask: { paths: ["spec.subject"] },
    });

    const minted = await clients.platformQuery.getRunnerScopedToken({ scope: { case: "runId", value: runId } });
    const runner = target.clientsPresenting(minted.runnerScopedToken);
    const first = await runner.sessionCommand.bindHarnessState({ runId, harnessStateId: "thread-1" });
    expect([first.harnessStateId, first.harnessStateIdHistory]).toEqual(["thread-1", []]);
    const second = await runner.sessionCommand.bindHarnessState({ runId, harnessStateId: "thread-2" });
    expect([second.harnessStateId, second.harnessStateIdHistory]).toEqual(["thread-2", ["thread-1"]]);

    const session = await clients.sessionQuery.get({ value: sessionId });
    expect(session.spec?.subject, "the edit made during the turn stays").toBe("Renamed during the turn");
    expect(session.status?.harnessStateId).toBe("thread-2");
    expect(session.status?.harnessStateIdHistory).toEqual(["thread-1"]);

    const otherRun = await expectGrpcCode(
      () => runner.sessionCommand.bindHarnessState({ runId: "run_01conformancenotthisrun", harnessStateId: "thread-forged" }),
      Code.PermissionDenied,
      "bindHarnessState naming another run",
    );
    expect(otherRun.rawMessage).toBe("only the runner acting for this run may record its session's harness state");

    await clients.sessionCommand.interrupt({ sessionId });
    await awaitTerminal(clients, runId);
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

describe("a command the agent runs in the background", () => {
  it("[rpc:SessionCommandController.stopBackgroundCommand] the runner writes its status and never the stop; a person's stop is recorded once, in the command's thread, and refused once the command or its turn ended", async () => {
    const { org } = await target.provisionTenancy();
    const sessionId = await newSession(org);
    mock.enqueue(anthropicText("Held while its commands run."), { delayMs: HOLD_MS });
    const runId = await startTurn(org, sessionId, "run the server");
    await awaitPhase(clients, runId, RunPhase.RUN_IN_PROGRESS);
    const minted = await clients.platformQuery.getRunnerScopedToken({ scope: { case: "runId", value: runId } });
    const runner = target.clientsPresenting(minted.runnerScopedToken);

    // Each command's start, as the runner writes it: the call, its at-once
    // result, then the command's running status keyed to the call.
    const started = (call: string, threadId = "") => {
      const toolUseId = `${runId}.${call}`;
      return [
        { threadId, event: { case: "agentToolUse" as const, value: { id: toolUseId, name: "execute", input: { command: "npm run dev", background: true }, sessionThreadId: threadId } } },
        { threadId, event: { case: "agentToolResult" as const, value: { id: `${toolUseId}.r`, toolUseId, content: [{ type: "text", text: "Started in the background." }] } } },
        { threadId, event: { case: "stigmerBackgroundCommandStatus" as const, value: { id: `${toolUseId}.bg`, toolUseId, sessionThreadId: threadId, phase: "running", timeoutSeconds: 3300 } } },
      ];
    };
    const ended = (call: string) => {
      const toolUseId = `${runId}.${call}`;
      return { event: { case: "stigmerBackgroundCommandStatus" as const, value: { id: `${toolUseId}.bg.end`, toolUseId, phase: "ended", ending: "exited", exitCode: 0, output: "ok\n" } } };
    };
    const appended = await runner.sessionCommand.appendEvents({ runId, events: [...started("bg1"), ...started("bg2"), ended("bg2")] });
    expect(appended.events.map(typeOf).filter((type) => type.startsWith("stigmer.background_command")), "a runner writes the status").toEqual([
      "stigmer.background_command.status",
      "stigmer.background_command.status",
      "stigmer.background_command.status",
    ]);

    const forged = await refusal(
      runner.sessionCommand.appendEvents({
        runId,
        events: [{ event: { case: "stigmerBackgroundCommandStopRequested", value: { id: "evt-stop", toolUseId: `${runId}.bg1` } } }],
      }),
    );
    expect(forged.code, "a stop request is the server's alone").toBe(Code.InvalidArgument);

    const stop = await clients.sessionCommand.stopBackgroundCommand({ sessionId, toolUseId: `${runId}.bg1` });
    expect([typeOf(stop), stop.runId, stop.threadId]).toEqual(["stigmer.background_command.stop_requested", runId, ""]);
    expect(stop.event.case === "stigmerBackgroundCommandStopRequested" && stop.event.value.toolUseId).toBe(`${runId}.bg1`);
    const again = await clients.sessionCommand.stopBackgroundCommand({ sessionId, toolUseId: `${runId}.bg1` });
    expect([idOf(again), again.seq], "a second stop answers the first").toEqual([idOf(stop), stop.seq]);

    const endedStop = await refusal(clients.sessionCommand.stopBackgroundCommand({ sessionId, toolUseId: `${runId}.bg2` }));
    expect(endedStop.code, "the command already ended").toBe(Code.FailedPrecondition);
    const none = await refusal(clients.sessionCommand.stopBackgroundCommand({ sessionId, toolUseId: `${runId}.no-such-call` }));
    expect(none.code, "a call that started no command").toBe(Code.NotFound);

    await runner.sessionCommand.appendEvents({ runId, events: started("bg3") });
    mock.releaseHolds();
    await awaitTerminal(clients, runId);
    const afterTurn = await refusal(clients.sessionCommand.stopBackgroundCommand({ sessionId, toolUseId: `${runId}.bg3` }));
    expect(afterTurn.code, "its turn no longer works").toBe(Code.FailedPrecondition);
    const stops = (await log(sessionId)).filter((event) => typeOf(event) === "stigmer.background_command.stop_requested");
    expect(stops.map(idOf), "one request in the log").toEqual([idOf(stop)]);
  });
});

describe("a conversation's creator is told what needs them", () => {
  it("[rpc:SessionQueryController.streamAttention] the creator is told when a turn finishes, never of a turn they stopped", async () => {
    const { org } = await target.provisionTenancy();
    const sessionId = await newSession(org);
    const abort = new AbortController();
    fixtures.defer(async () => abort.abort());
    const received: Attention[] = [];
    void (async () => {
      for await (const attention of clients.sessionQuery.streamAttention({ org, afterCursor: "" }, { signal: abort.signal })) {
        received.push(attention);
      }
    })().catch(() => undefined);
    const toldOf = (runId: string) =>
      pollUntil(
        async () => received.find((attention) => attention.runId === runId),
        (attention) => attention !== undefined,
        (_last, timeoutMs) => `no attention for turn ${runId} within ${timeoutMs}ms; received ${JSON.stringify(received.map((a) => a.runId))}`,
        { timeoutMs: 10_000 },
      );
    const finish = async (label: string): Promise<string> => {
      mock.enqueue(anthropicText(`Done: ${label}.`));
      const runId = await startTurn(org, sessionId, label);
      await awaitTerminal(clients, runId);
      return runId;
    };

    // Nothing tells a client its stream listens, and a stream says nothing
    // of what came before it does: turns finish until one is told.
    let told: Attention | undefined;
    for (let attempt = 0; attempt < 5 && told === undefined; attempt++) {
      told = await toldOf(await finish(`warm-up ${attempt}`)).catch(() => undefined);
    }
    expect(told?.reason, "a finished turn tells its creator").toBe("finished");
    expect(told?.sessionId).toBe(sessionId);

    mock.enqueue(anthropicText("Held until stopped."), { delayMs: HOLD_MS });
    const stopped = await startTurn(org, sessionId, "stop me");
    await awaitPhase(clients, stopped, RunPhase.RUN_IN_PROGRESS);
    await clients.sessionCommand.interrupt({ sessionId });
    expect((await awaitTerminal(clients, stopped)).status?.phase).toBe(RunPhase.RUN_CANCELLED);
    mock.releaseHolds();

    const after = await finish("after the stop");
    expect((await toldOf(after))?.reason).toBe("finished");
    expect(received.filter((attention) => attention.runId === stopped), "a turn the person stopped tells them nothing").toEqual([]);
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
    return sessionOnly(
      await pollUntil(
        async () => (await clients.sessionQuery.listEvents({ sessionId, runId, pageSize: 1000 })).events,
        (got) => got.length > 0 && typeOf(got[got.length - 1]!) === "session.status_idle",
        (last) => `run ${runId}'s session never went idle: ${JSON.stringify(last?.map(typeOf))}`,
      ),
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

  it("[rpc:SessionQueryController.listEvents] [rpc:SessionCommandController.confirmToolUse] a tool use that waits carries its ask and the session's requires_action; the answer is the server's event; the resumed turn adds only its result and what follows", async () => {
    const { org } = await target.provisionTenancy();
    const plugin = await pushFixturePlugin(clients, mcp, fixtures, { org, name: uniqueName("gated"), tools: [DESTRUCTIVE_ECHO_TOOL_NAME] });
    const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("events-gated"), plugins: [plugin.metadata!.slug] }));
    fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
    mock.enqueue(anthropicToolUse("toolu_events_echo", DESTRUCTIVE_ECHO_TOOL_NAME, { text: "hello" }));
    mock.enqueue(anthropicText("Echoed."));
    const runId = await turn({ org, agentRef: agentRefOf(agent), message: "echo it" });
    const gated = await awaitPhase(clients, runId, RunPhase.RUN_WAITING_FOR_APPROVAL, { label: "WAITING_FOR_APPROVAL" });
    const sessionId = gated.spec?.target.case === "sessionId" ? gated.spec.target.value : "";
    const atGate = sessionOnly((await clients.sessionQuery.listEvents({ sessionId, runId, pageSize: 1000 })).events);
    expect(atGate.map(typeOf)).toEqual([
      "user.message",
      "session.status_running",
      "agent.mcp_tool_use",
      "stigmer.permission.asked",
      "session.status_idle",
    ]);
    const waiting = atGate[4]!.event;
    expect(waiting.case === "sessionStatusIdle" && [waiting.value.stopReason?.type, waiting.value.stopReason?.eventIds]).toEqual([
      "requires_action",
      [idOf(atGate[2]!)],
    ]);
    const use = atGate[2]!.event;
    expect(use.case === "agentMcpToolUse" && use.value.evaluatedPermission).toBe("ask");
    const asked = atGate[3]!.event;
    expect(asked.case === "stigmerPermissionAsked" && [asked.value.toolUseId, asked.value.policySource]).toEqual([
      idOf(atGate[2]!),
      "annotation_destructive_tighten",
    ]);

    const answer = await clients.sessionCommand.confirmToolUse({ sessionId, toolUseId: idOf(atGate[2]!), result: "allow" });
    expect(answer.event.case === "userToolConfirmation" && [answer.event.value.toolUseId, answer.event.value.result]).toEqual([
      idOf(atGate[2]!),
      "allow",
    ]);
    const events = await runLog(runId);
    expect(events.map(typeOf)).toEqual([
      "user.message",
      "session.status_running",
      "agent.mcp_tool_use",
      "stigmer.permission.asked",
      "session.status_idle",
      "user.tool_confirmation",
      "session.status_running",
      "agent.mcp_tool_result",
      "agent.message",
      "session.status_idle",
    ]);
    const result = events[7]!.event;
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

describe("file review's events", () => {
  /** A turn in a fresh session with file review on, whose agent writes `path` in a git workspace. */
  async function reviewedTurn(path: string, content: string): Promise<{ sessionId: string; runId: string }> {
    const { org } = await target.provisionTenancy();
    const workspace = await GitWorkspace.create();
    fixtures.defer(() => workspace.cleanup());
    const session = await clients.sessionCommand.create(
      makeSession({
        org,
        name: uniqueName("events-review"),
        agentRef: await newAgentRef(org),
        harness: Harness.NATIVE,
        localWorkspaces: [{ name: "repo", path: workspace.dir }],
        fileReview: true,
      }),
    );
    const sessionId = session.metadata!.id;
    fixtures.defer(() => clients.sessionCommand.delete({ value: sessionId }).catch(() => undefined));
    mock.enqueue(anthropicToolUse("toolu_events_write", "write_file", { file_path: path, content }));
    mock.enqueue(anthropicText("Wrote it."));
    const run = await clients.agentExecutionCommand.create(
      makeAgentExecution({ org, name: uniqueName("events-run"), sessionId, message: "write it" }),
    );
    const runId = run.metadata!.id;
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: runId }).catch(() => undefined));
    return { sessionId, runId };
  }

  /** One run's events once the session is idle after it. */
  async function idleLog(sessionId: string, runId: string): Promise<SessionEvent[]> {
    return sessionOnly(
      await pollUntil(
        async () => (await clients.sessionQuery.listEvents({ sessionId, runId, pageSize: 1000 })).events,
        (got) => got.length > 0 && typeOf(got[got.length - 1]!) === "session.status_idle",
        (last) => `run ${runId}'s session never went idle: ${JSON.stringify(last?.map(typeOf))}`,
      ),
    );
  }

  /** The id the runner derives for a change set's events: <run>.fr<turn>, from the set's <run>:<turn>. */
  function reviewEventId(changeSetId: string): string {
    return changeSetId.replace(":", ".fr");
  }

  it("[rpc:SessionQueryController.listEvents] a turn with review on writes stigmer.file_review.changes from its change set, once, before the session goes idle", async () => {
    const { sessionId, runId } = await reviewedTurn("notes.txt", "one\ntwo\n");
    const ended = await awaitFileReview(clients, runId);
    expect(ended.status?.phase, "review never holds the turn").toBe(RunPhase.RUN_COMPLETED);
    const set = requireReviewSet(ended);
    const change = requireChangeByPath(set, "notes.txt");

    const events = await idleLog(sessionId, runId);
    const types = events.map(typeOf);
    expect(types.filter((t) => t !== "stigmer.file_review.changes")).toEqual([
      "user.message",
      "session.status_running",
      "agent.tool_use",
      "agent.tool_result",
      "agent.message",
      "session.status_idle",
    ]);
    const at = types.indexOf("stigmer.file_review.changes");
    expect(types.filter((t) => t === "stigmer.file_review.changes"), "one offer per turn").toHaveLength(1);
    expect(at, "offered after the edit's result").toBeGreaterThan(types.indexOf("agent.tool_result"));
    expect(at, "and before the turn ends").toBeLessThan(types.indexOf("session.status_idle"));
    const offered = events[at]!.event;
    expect(idOf(events[at]!), "named by the run and the turn").toBe(reviewEventId(set.id));
    expect(offered.case === "stigmerFileReviewChanges" && offered.value.changeSetId).toBe(set.id);
    expect(offered.case === "stigmerFileReviewChanges" && offered.value.aggregateDigest).toBe(set.aggregateDigest);
    expect(
      offered.case === "stigmerFileReviewChanges" &&
        offered.value.files.map((f) => [f.fileChangeId, f.path, f.previousPath, f.change, f.digest, f.linesAdded, f.linesRemoved, f.reviewable]),
    ).toEqual([[change.id, "notes.txt", "", "added", change.fileDigest, 2, 0, "complete"]]);
  });

  it("[rpc:SessionCommandController.reviewFileChanges] a person's decision is stigmer.file_review.decided, the server's, on the change set's run; the same decision again appends nothing", async () => {
    const { sessionId, runId } = await reviewedTurn("kept.txt", "keep\n");
    const set = requireReviewSet(await awaitFileReview(clients, runId));
    const change = requireChangeByPath(set, "kept.txt");

    await reviewFileByPath(clients, sessionId, set, "kept.txt", "keep", { reason: "looks right" });
    await reviewFileByPath(clients, sessionId, set, "kept.txt", "keep", { reason: "looks right" });

    const decided = (await clients.sessionQuery.listEvents({ sessionId, pageSize: 1000, types: ["stigmer.file_review.decided"] })).events;
    expect(decided, "a decision is final per target; the repeat appends nothing").toHaveLength(1);
    const event = decided[0]!;
    expect(idOf(event), "a server-written id").toMatch(/^sevt_fd_[0-9a-f]{40}$/);
    expect(event.runId, "written on the change set's run").toBe(runId);
    const value = event.event;
    expect(
      value.case === "stigmerFileReviewDecided" && [
        value.value.changeSetId,
        value.value.scope,
        value.value.fileChangeId,
        value.value.action,
        value.value.expectedDigest,
        value.value.origin,
        value.value.reason,
      ],
    ).toEqual([set.id, "file", change.id, "keep", change.fileDigest, "person", "looks right"]);
  });

  it("[rpc:SessionQueryController.listEvents] an undo's reconcile turn reads running, stigmer.file_review.reconciled, then idle, and writes no user.message", async () => {
    const { sessionId, runId } = await reviewedTurn("undone.txt", "undo me\n");
    const set = requireReviewSet(await awaitFileReview(clients, runId));

    const undone = await reviewChangeSet(clients, sessionId, set, "undo");
    const reconcileRunId = undone.reconcileRunId;
    expect(reconcileRunId, "an undo on a finished turn starts a reconcile turn").not.toBe("");
    fixtures.defer(() => clients.agentExecutionCommand.delete({ value: reconcileRunId }).catch(() => undefined));
    expect((await awaitTerminal(clients, reconcileRunId)).status?.phase).toBe(RunPhase.RUN_COMPLETED);

    const reconcile = await idleLog(sessionId, reconcileRunId);
    expect(reconcile.map(typeOf)).toEqual(["session.status_running", "stigmer.file_review.reconciled", "session.status_idle"]);
    const undoDecided = (await clients.sessionQuery.listEvents({ sessionId, pageSize: 1000 })).events.find(
      (event) => event.event.case === "stigmerFileReviewDecided" && event.event.value.changeSetId === set.id,
    );
    expect(
      idOf(reconcile[1]!),
      "one per undo, named by the change set and the undo's decided event, whichever turn reconciles it",
    ).toBe(`${reviewEventId(set.id)}.r.${idOf(undoDecided!)}`);
    const reconciled = reconcile[1]!.event;
    expect(
      reconciled.case === "stigmerFileReviewReconciled" && [
        reconciled.value.changeSetId,
        reconciled.value.undonePaths,
        reconciled.value.failure,
        reconciled.value.failureDetail,
      ],
    ).toEqual([set.id, ["undone.txt"], "", ""]);
    const idle = reconcile[2]!.event;
    expect(idle.case === "sessionStatusIdle" && idle.value.stopReason?.type).toBe("end_turn");

    const whole = (await log(sessionId)).map(typeOf);
    expect(whole.filter((t) => t === "user.message"), "the undo is no message").toHaveLength(1);
    expect(whole.slice(-4), "the person's undo, then the turn that put the file back").toEqual([
      "stigmer.file_review.decided",
      "session.status_running",
      "stigmer.file_review.reconciled",
      "session.status_idle",
    ]);
    expect(mock.remaining(), "the reconcile turn asked no model").toBe(0);
  });
});
