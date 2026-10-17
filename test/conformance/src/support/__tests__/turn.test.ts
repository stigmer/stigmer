// Unit arms for the turn readers. What they pin:
// - a turn is read by its run id from the folded log, and a run id the log
//   does not hold is red, naming the turns it does hold;
// - a run's turn is read from the session its target names, and a run that
//   names no id or no session is red before anything is read;
// - a turn's tool uses come in the order the agent made them, a sub-agent's
//   calls (nested ones included) right after the task call that started
//   them; a scripted call id finds its use in any thread;
// - the threads are every sub-agent's, nested ones included, in start order,
//   and the messages are only the source's own;
// - a change set's review is found on whichever turn offered it, and is
//   undefined while no turn has.
// Pure: hand-built events and stubbed clients, no target.
// Domain: conformance support (a turn's transcript is session events).
import { create, type JsonObject, type MessageInitShape } from "@bufbuild/protobuf";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { type SessionEvent, SessionEventSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { foldSession } from "@stigmer/session-log";
import { describe, expect, it, vi } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import {
  messagesOf,
  requireTurn,
  reviewSetOf,
  sessionFold,
  threadsOf,
  toolUseByCallId,
  toolUsesOf,
  turnById,
  turnOfEvents,
  turnOfRun,
} from "../turn";

type EventInit = MessageInitShape<typeof SessionEventSchema>["event"];

const R = "run_1";
const R2 = "run_2";

let seq = 0n;

// One stored event of a run, on a thread ("" for the primary).
function ev(runId: string, event: EventInit, threadId = ""): SessionEvent {
  seq += 1n;
  return create(SessionEventSchema, { seq, sessionId: "ses_1", runId, threadId, event });
}

const text = (t: string) => [{ type: "text", text: t }];

function user(runId: string, message: string): SessionEvent {
  return ev(runId, { case: "userMessage", value: { id: `${runId}.user`, content: text(message) } });
}

// An agent message; `scope` is `root` on the primary thread, the task call's id in a thread.
function said(runId: string, index: number, message: string, scope = "root", threadId = ""): SessionEvent {
  return ev(runId, { case: "agentMessage", value: { id: `${runId}.${scope}.m${index}`, content: text(message) } }, threadId);
}

function use(runId: string, call: string, name: string, threadId = "", input: JsonObject = {}): SessionEvent {
  return ev(runId, { case: "agentToolUse", value: { id: `${runId}.${call}`, name, input, sessionThreadId: threadId } }, threadId);
}

// The task call `call` and the sub-agent thread it opens, on `parentThread`.
function task(runId: string, call: string, parentThread = ""): SessionEvent[] {
  const thread = `${runId}.${call}`;
  return [
    use(runId, call, "task", parentThread, { description: call }),
    ev(runId, { case: "sessionThreadCreated", value: { id: `${thread}.created`, agentName: call, sessionThreadId: thread } }),
  ];
}

function offered(runId: string, changeSetId: string): SessionEvent {
  return ev(runId, { case: "stigmerFileReviewChanges", value: { id: `${changeSetId}.fr`, changeSetId } });
}

// A turn that reads, starts a sub-agent which itself starts one, then writes:
// root c1 -> task t1 { s1, task t2 { s2 } } -> c2.
function nestedLog(): SessionEvent[] {
  const t1 = `${R}.t1`;
  const t2 = `${R}.t2`;
  return [
    user(R, "go"),
    said(R, 0, "Reading."),
    use(R, "c1", "read"),
    ...task(R, "t1"),
    said(R, 0, "Inside.", "t1", t1),
    use(R, "s1", "shell", t1),
    ...task(R, "t2", t1),
    use(R, "s2", "grep", t2),
    said(R, 1, "Writing."),
    use(R, "c2", "write"),
  ];
}

// A session query client whose listEvents answers `log`.
function logClients(log: SessionEvent[]) {
  const listEvents = vi.fn(async () => ({ events: log }));
  return { clients: { sessionQuery: { listEvents } } as unknown as ConformanceClients, listEvents };
}

describe("requireTurn and the turn reads", () => {
  it("reads a turn by its run id, and is red naming the turns the log holds", () => {
    const fold = foldSession([user(R, "a"), user(R2, "b")]);
    expect(requireTurn(fold, R2).userMessage?.text).toBe("b");
    expect(() => requireTurn(fold, "run_9")).toThrow('the session\'s log holds no turn run_9 (turns: ["run_1","run_2"])');
  });

  it("folds the session's whole log and reads the turn from it", async () => {
    const c = logClients([user(R, "hi"), said(R, 0, "Hello.")]);
    expect((await sessionFold(c.clients, "ses_1")).turns).toHaveLength(1);
    const turn = await turnById(c.clients, "ses_1", R);
    expect(turn.answer).toBe("Hello.");
    expect(c.listEvents).toHaveBeenCalledWith({ sessionId: "ses_1", pageSize: 1000 });
  });

  it("reads a run's turn from the session its target names", async () => {
    const c = logClients([user(R, "hi")]);
    const run = create(RunSchema, { metadata: { id: R }, spec: { target: { case: "sessionId", value: "ses_1" } } });
    expect((await turnOfRun(c.clients, run)).runId).toBe(R);
    expect(c.listEvents).toHaveBeenCalledWith({ sessionId: "ses_1", pageSize: 1000 });
  });

  it("is red, before reading anything, for a run naming no id or no session", () => {
    const c = logClients([]);
    expect(() => turnOfRun(c.clients, create(RunSchema, { metadata: { id: R } }))).toThrow(
      'run "run_1" names no session to read its turn from',
    );
    expect(() =>
      turnOfRun(c.clients, create(RunSchema, { spec: { target: { case: "sessionId", value: "ses_1" } } })),
    ).toThrow('run "" names no session to read its turn from');
    expect(c.listEvents).not.toHaveBeenCalled();
  });

  it("reads the turn of an already-read log", () => {
    expect(turnOfEvents([user(R, "a"), user(R2, "b")], R).userMessage?.text).toBe("a");
    expect(() => turnOfEvents([], R)).toThrow("holds no turn run_1 (turns: [])");
  });
});

describe("the turn's items", () => {
  const turn = turnOfEvents(nestedLog(), R);

  it("lists every tool use in the order made, a sub-agent's calls after its task call", () => {
    expect(toolUsesOf(turn).map((use) => use.id)).toEqual([
      `${R}.c1`,
      `${R}.t1`,
      `${R}.s1`,
      `${R}.t2`,
      `${R}.s2`,
      `${R}.c2`,
    ]);
    const outer = threadsOf(turn)[0]!;
    expect(toolUsesOf(outer).map((use) => use.id)).toEqual([`${R}.s1`, `${R}.t2`, `${R}.s2`]);
  });

  it("finds a scripted call id's use in any thread, and none for a call never made", () => {
    expect(toolUseByCallId(turn, "c2")?.name).toBe("write");
    expect(toolUseByCallId(turn, "s2")?.name).toBe("grep");
    expect(toolUseByCallId(turn, "nope")).toBeUndefined();
  });

  it("lists every sub-agent thread, nested ones included, in start order", () => {
    expect(threadsOf(turn).map((thread) => [thread.id, thread.agentName])).toEqual([
      [`${R}.t1`, "t1"],
      [`${R}.t2`, "t2"],
    ]);
  });

  it("lists only the source's own messages", () => {
    expect(messagesOf(turn).map((message) => message.text)).toEqual(["Reading.", "Writing."]);
    expect(messagesOf(threadsOf(turn)[0]!).map((message) => message.text)).toEqual(["Inside."]);
  });
});

describe("reviewSetOf", () => {
  it("finds a change set's review on whichever turn offered it, and none before any did", () => {
    const fold = foldSession([user(R, "a"), offered(R, "run_1:0"), user(R2, "b"), offered(R2, "run_2:0")]);
    expect(reviewSetOf(fold, "run_2:0")?.changeSetId).toBe("run_2:0");
    expect(reviewSetOf(fold, "run_1:0")?.changeSetId).toBe("run_1:0");
    expect(reviewSetOf(fold, "run_3:0")).toBeUndefined();
  });
});
