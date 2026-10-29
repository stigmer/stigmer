// Conformance suite for a command the agent runs in the background, on a real
// turn (Class B): what the session's log says of its life, and a person's
// stop of it.
// Domain: agentic / session — a command that runs on after its call returned.
//
// Each arm runs the Stigmer harness against the wire mock, with a REAL
// `execute` the model asks for with `background: true`, under the whole-run
// trust (spec.auto_approve_all), because a shell is gated in every other
// posture. The model's script: start the command, end its reply (the turn
// reminds it once that the command still runs), end its reply again (the
// turn now waits for the command), then answer the command's end.
//
//   - A command that ends on its own: the start's result says it started;
//     the log then holds the command's stigmer.background_command.status,
//     running and then ended (exited 0, with what it printed), each after
//     the start's result; a stream that asked for stigmer.tool_output_delta
//     sees its output under the start's tool use while it runs; the agent
//     answers its end in the same turn.
//   - A person's stop while the turn waits for the command at its reply's
//     end: SessionCommandController.stopBackgroundCommand records the
//     request, the runner stops that command alone within seconds, its
//     ended status says a person stopped it, and the agent's next reply
//     follows in the same turn, long before the command's own end.
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { SessionEvent, StigmerBackgroundCommandStatusEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import type { StreamSessionEventsResponse } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
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

/** A turn's whole budget here: a command, two waits and the model's four calls. */
const ARM_TIMEOUT_MS = 120_000;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
});

afterEach(async () => {
  const claimDeadline = Date.now() + 15_000;
  while (mock.remaining() > 0 && Date.now() < claimDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  await fixtures.cleanup();
  mock.reset();
});

afterAll(async () => {
  await target?.teardown();
});

/** A fresh conversation of a fresh agent. */
async function newSession(): Promise<{ readonly org: string; readonly sessionId: string }> {
  const { org } = await target.provisionTenancy();
  const agent = await clients.agentCommand.create(makeAgent({ org, name: uniqueName("background-agent") }));
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }).catch(() => undefined));
  const session = await clients.sessionCommand.create(makeSession({ org, name: uniqueName("background-session"), agentRef: agentRefOf(agent) }));
  const sessionId = session.metadata!.id;
  fixtures.defer(() => clients.sessionCommand.delete({ value: sessionId }).catch(() => undefined));
  return { org, sessionId };
}

/** Starts a trusted turn on the conversation and answers its id. */
async function startTurn(org: string, sessionId: string, message: string): Promise<string> {
  const run = await clients.agentExecutionCommand.create(
    makeAgentExecution({ org, name: uniqueName("background-run"), sessionId, message, autoApproveAll: true }),
  );
  const id = run.metadata!.id;
  fixtures.defer(async () => {
    await awaitTerminal(clients, id, { timeoutMs: ARM_TIMEOUT_MS }).catch(() => undefined);
    await clients.agentExecutionCommand.delete({ value: id }).catch(() => undefined);
  });
  return id;
}

/** The model's script around one background start (the suite header). */
function enqueueScript(callId: string, command: string, waiting: string, answer: string): void {
  mock.enqueue(anthropicToolUse(callId, "execute", { command, background: true }));
  mock.enqueue(anthropicText("It runs in the background."));
  mock.enqueue(anthropicText(waiting));
  mock.enqueue(anthropicText(answer));
}

async function runLog(sessionId: string, runId: string): Promise<SessionEvent[]> {
  return (await clients.sessionQuery.listEvents({ sessionId, runId, pageSize: 1000 })).events;
}

function statusesOf(events: readonly SessionEvent[], toolUseId: string): StigmerBackgroundCommandStatusEvent[] {
  return events.flatMap((event) =>
    event.event.case === "stigmerBackgroundCommandStatus" && event.event.value.toolUseId === toolUseId ? [event.event.value] : [],
  );
}

function idOf(event: SessionEvent): string {
  return event.event.case === undefined ? "" : event.event.value.id;
}

function messagesOf(events: readonly SessionEvent[]): string[] {
  return events.flatMap((event) =>
    event.event.case === "agentMessage" ? [event.event.value.content.map((block) => block.text).join("")] : [],
  );
}

describe("a command the agent runs in the background", () => {
  it("[rpc:SessionQueryController.streamEvents] its log holds the start's result, then its running and ended status; its output streams under the start's tool use while it runs", async () => {
    const { org, sessionId } = await newSession();
    const callId = uniqueName("call_bg_ticks");
    enqueueScript(callId, "for i in 1 2 3; do echo tick $i; sleep 1; done", "I will wait for the ticks.", "The ticks finished.");

    const controller = new AbortController();
    const frames: StreamSessionEventsResponse[] = [];
    const watching = (async () => {
      try {
        for await (const frame of clients.sessionQuery.streamEvents({ sessionId, eventDeltas: ["stigmer.tool_output_delta"] }, { signal: controller.signal })) {
          frames.push(frame);
        }
      } catch (error) {
        if (!controller.signal.aborted) throw error;
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 500));

    const runId = await startTurn(org, sessionId, "Run the ticks in the background.");
    const final = await awaitTerminal(clients, runId, { timeoutMs: ARM_TIMEOUT_MS });
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    controller.abort();
    await watching;

    const events = await runLog(sessionId, runId);
    const toolUseId = `${runId}.${callId}`;
    const statuses = statusesOf(events, toolUseId);
    expect(statuses.map((status) => status.phase)).toEqual(["running", "ended"]);
    expect(statuses[1]).toMatchObject({ ending: "exited", exitCode: 0, stoppedBy: "" });
    expect(statuses[1]!.output).toContain("tick 3");
    const at = (id: string) => events.findIndex((event) => idOf(event) === id);
    expect(at(`${toolUseId}.bg`), "the running status follows the start's result").toBeGreaterThan(at(`${toolUseId}.r`));
    expect(at(`${toolUseId}.bg.end`)).toBeGreaterThan(at(`${toolUseId}.bg`));

    const streamed = frames
      .flatMap((frame) => (frame.frame.case === "stigmerToolOutputDelta" && frame.frame.value.toolUseId === toolUseId ? [frame.frame.value.delta] : []))
      .join("");
    expect(streamed, "its output reached the stream while it ran").toContain("tick");
    expect(messagesOf(events).at(-1)).toBe("The ticks finished.");
  });

  it("[rpc:SessionCommandController.stopBackgroundCommand] a person's stop while the turn waits for it stops that command alone, says so, and the agent answers in the same turn", async () => {
    const { org, sessionId } = await newSession();
    const callId = uniqueName("call_bg_server");
    const WAITING = "I will wait for the server.";
    enqueueScript(callId, "sleep 300", WAITING, "You stopped the server.");

    const began = Date.now();
    const runId = await startTurn(org, sessionId, "Start the server in the background.");
    await awaitPhase(clients, runId, RunPhase.RUN_IN_PROGRESS);
    const toolUseId = `${runId}.${callId}`;
    // The agent has ended its reply and the turn waits for the command.
    await pollUntil(
      () => runLog(sessionId, runId),
      (events) => messagesOf(events).includes(WAITING) && statusesOf(events, toolUseId).length === 1,
      (last) => `the turn never waited for its command: ${JSON.stringify(last === undefined ? [] : messagesOf(last))}`,
      { timeoutMs: ARM_TIMEOUT_MS },
    );

    const stop = await clients.sessionCommand.stopBackgroundCommand({ sessionId, toolUseId });
    expect(stop.event.case).toBe("stigmerBackgroundCommandStopRequested");

    const final = await awaitTerminal(clients, runId, { timeoutMs: ARM_TIMEOUT_MS });
    expect(final.status?.phase).toBe(RunPhase.RUN_COMPLETED);
    expect(Date.now() - began, "the stop ended the command, not its own 300 s").toBeLessThan(ARM_TIMEOUT_MS);
    const events = await runLog(sessionId, runId);
    expect(statusesOf(events, toolUseId).at(-1)).toMatchObject({ phase: "ended", ending: "stopped", stoppedBy: "person" });
    const at = (id: string) => events.findIndex((event) => idOf(event) === id);
    expect(at(`${toolUseId}.bg.end`), "the request came first, then the end").toBeGreaterThan(at(idOf(stop)));
    expect(messagesOf(events).at(-1)).toBe("You stopped the server.");
  });
});
