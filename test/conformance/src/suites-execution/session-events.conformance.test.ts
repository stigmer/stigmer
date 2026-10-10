// Conformance suite for a session's ordered event log, on real turns.
// Domain: agentic / session — the history every later client reads.
//
// The contract pinned here, over the wire with the runner and the mock LLM:
//
//   - one turn's log reads, in order: the user's message (its text), the
//     session running, then the session idle with stop_reason end_turn;
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
// The runner does not write the agent's own events into the log yet (it
// reports them on the run); these arms append them through the RPC, as a
// runner will.
// The outsider contract (no view, no events) is Class A,
// suites/session-events.conformance.test.ts, on the enforcing lane.
import { Code, ConnectError } from "@connectrpc/connect";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";
import type { StreamSessionEventsResponse } from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { agentRefOf, makeAgent } from "../support/agents";
import { pollUntil } from "../support/run-poll";
import { awaitPhase, awaitTerminal, makeAgentExecution, requireLlmProxy } from "../support/runs";
import { makeSession } from "../support/sessions";
import { uniqueName } from "../support/naming";
import { createTarget, type TargetProfile } from "../targets";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
const fixtures = new FixtureTracker();

/** How long a held turn stays IN_PROGRESS unless released. */
const HOLD_MS = 120_000;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  mock.releaseHolds();
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

/** An event's Managed Agents type, read from its oneof case. */
function typeOf(event: SessionEvent): string {
  switch (event.event.case) {
    case "userMessage":
      return "user.message";
    case "sessionStatusRunning":
      return "session.status_running";
    case "sessionStatusIdle":
      return "session.status_idle";
    case "sessionError":
      return "session.error";
    case "agentMessage":
      return "agent.message";
    default:
      return String(event.event.case);
  }
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

/** Collects a session's stream in the background until `done` says so. */
function watch(
  sessionId: string,
  eventDeltas: string[],
  done: (frames: StreamSessionEventsResponse[]) => boolean,
): { frames: StreamSessionEventsResponse[]; finished: Promise<void>; stop: () => void } {
  const controller = new AbortController();
  const frames: StreamSessionEventsResponse[] = [];
  const finished = (async () => {
    try {
      for await (const frame of clients.sessionQuery.streamEvents({ sessionId, eventDeltas }, { signal: controller.signal })) {
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
  it("[rpc:SessionQueryController.listEvents] one turn's log reads the user's message, running, then idle as end_turn, in order", async () => {
    const { org } = await target.provisionTenancy();
    const sessionId = await newSession(org);
    mock.enqueue(anthropicText("Hello from the mock."));
    const runId = await startTurn(org, sessionId, "summarise the repo");
    const final = await awaitTerminal(clients, runId);
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);

    const events = await log(sessionId);
    expect(events.map(typeOf)).toEqual(["user.message", "session.status_running", "session.status_idle"]);
    expect(events.map((e) => e.seq)).toEqual([1n, 2n, 3n]);
    expect(events.every((e) => e.sessionId === sessionId && e.runId === runId)).toBe(true);
    const message = events[0]!.event;
    expect(message.case === "userMessage" && message.value.content.map((b) => b.text)).toEqual(["summarise the repo"]);
    const idle = events[2]!.event;
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
    expect(streamed.map(typeOf)).toEqual(["user.message", "session.status_running", "session.status_idle"]);
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
    expect((await log(sessionId)).map(typeOf)).toEqual([
      "user.message",
      "session.status_running",
      "agent.message",
      "session.status_idle",
    ]);
  });
});

