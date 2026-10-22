/**
 * Pins the start of the turn a session's queue waits for (../queued-turn.ts)
 * over a real store and a stand-in for the in-process run create: nothing
 * queued starts nothing; the turn is the newest message's, its text the
 * texts joined in the order sent, its files every message's once, naming
 * the messages it takes, created as the newest sender; a refusal because
 * another write got there first starts nothing and drops nothing; any other
 * refusal drops the messages with the reason as a session.error; a sender
 * nobody stands for drops them too; an infrastructure fault is thrown for
 * the workflow's activity to retry; and the observer starts the turn when
 * a turn of the session ends, logging rather than throwing a fault.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import { createLogger } from "../../../boot/logger.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import { failedPreconditionError, permissionDeniedError } from "../../../pipeline/errors.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../store/sqlite/__tests__/support.js";
import { SessionEventBroker } from "../../session/events/broker.js";
import { eventOf } from "../../session/events/codec.js";
import { enqueueMessage } from "../../session/events/queue.js";
import { createRunAppendingEvents, updateRunAppendingEvents } from "../../session/events/run-writes.js";
import { readSessionState } from "../../session/events/state.js";
import { SESSION_TURN_UNFINISHED_REASON } from "../constants.js";
import { newQueuedTurnObserver, queuedTurn, startQueuedTurn } from "../queued-turn.js";
import type { QueuedTurnDeps } from "../queued-turn.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

let temp: TempStore;
let created: Array<{ run: Run; caller: CallerIdentity }>;
let answer: (run: Run) => Promise<Run>;
let deps: QueuedTurnDeps;
const people = new Map<string, CallerIdentity>([
  ["person-a", testCallerIdentity({ identityId: "person-a" })],
  ["person-b", testCallerIdentity({ identityId: "person-b" })],
]);

beforeEach(() => {
  temp = tempStore();
  created = [];
  answer = async (run) => run;
  deps = {
    store: temp.store,
    logger: silentLogger,
    sessionEventBroker: new SessionEventBroker(silentLogger),
    creator: () => ({
      create: async (run, caller) => {
        created.push({ run, caller });
        return answer(run);
      },
    }),
    callerOf: async (senderId) => people.get(senderId),
  };
});

afterEach(async () => {
  await temp.cleanup();
});

function turn(text: string, fileIds: string[] = [], name = "run-1"): Run {
  return create(RunSchema, {
    metadata: { name, org: "acme", labels: { from: name } },
    spec: { target: { case: "sessionId", value: "s1" }, message: text, fileIds },
  });
}

async function working(): Promise<void> {
  await createRunAppendingEvents(
    deps,
    create(RunSchema, {
      metadata: { id: "a", org: "acme" },
      spec: { target: { case: "sessionId", value: "s1" }, message: "build it" },
      status: { phase: RunPhase.RUN_PENDING },
    }),
  );
}

async function queue(text: string, sender: string, fileIds: string[] = [], name = "run-1"): Promise<string> {
  const outcome = await enqueueMessage(deps, { sessionId: "s1", org: "acme", sender, turn: turn(text, fileIds, name) });
  if (!("queued" in outcome) || outcome.queued.event.case !== "userMessage") {
    throw new Error("not queued");
  }
  return outcome.queued.event.value.id;
}

async function end(): Promise<void> {
  await updateRunAppendingEvents(deps, "a", (run) => {
    run.status!.phase = RunPhase.RUN_COMPLETED;
  });
}

describe("the queue's turn", () => {
  it("starts nothing when nothing is queued", async () => {
    expect(await startQueuedTurn(deps, "s1")).toBeUndefined();
    expect(created).toEqual([]);
  });

  it("is the newest message's turn, the texts joined and the files together, as the newest sender", async () => {
    await working();
    const one = await queue("first", "person-a", ["file_1", "file_2"], "run-1");
    const two = await queue("second", "person-b", ["file_2", "file_3"], "run-2");
    await end();
    await startQueuedTurn(deps, "s1");
    expect(created).toHaveLength(1);
    const [{ run, caller }] = created as [{ run: Run; caller: CallerIdentity }];
    expect(caller.identityId).toBe("person-b");
    expect(run.metadata?.name).toBe("run-2");
    expect(run.metadata?.labels).toEqual({ from: "run-2" });
    expect(run.spec?.message).toBe("first\n\nsecond");
    expect(run.spec?.fileIds).toEqual(["file_1", "file_2", "file_3"]);
    expect(run.spec?.queuedMessageIds).toEqual([one, two]);
    expect(run.status).toBeUndefined();
  });

  it("leaves out an empty text, so a message of files alone adds no blank line", () => {
    const joined = queuedTurn([turn("", ["file_1"]), turn("look")], ["q1", "q2"]);
    expect(joined.spec?.message).toBe("look");
  });

  it("starts nothing and drops nothing when another write got there first", async () => {
    await working();
    await queue("first", "person-a");
    answer = async () => {
      throw failedPreconditionError("held", { reason: SESSION_TURN_UNFINISHED_REASON });
    };
    expect(await startQueuedTurn(deps, "s1")).toBeUndefined();
    expect(await temp.store.sessionEvents.queued("s1")).toHaveLength(1);
  });

  it("drops the messages with the reason when a check refuses the turn, and idles the session", async () => {
    await working();
    await queue("first", "person-a");
    await end();
    expect(await readSessionState(temp.store, "s1")).toBe("running");
    answer = async () => {
      throw permissionDeniedError("unauthorized to run agent 'gone'");
    };
    expect(await startQueuedTurn(deps, "s1")).toBeUndefined();
    expect(await temp.store.sessionEvents.queued("s1")).toEqual([]);
    expect(await readSessionState(temp.store, "s1")).toBe("idle");
    const [error] = await temp.store.sessionEvents.list("s1", { order: "desc", types: ["session.error"], limit: 1 });
    const event = eventOf(error!);
    expect(event.event.case === "sessionError" && event.event.value.error?.message).toBe(
      "the queued messages were not read: unauthorized to run agent 'gone'",
    );
  });

  it("drops the messages when their sender is nobody this server knows", async () => {
    await working();
    await queue("first", "a-departed-person");
    await end();
    expect(await startQueuedTurn(deps, "s1")).toBeUndefined();
    expect(created).toEqual([]);
    expect(await temp.store.sessionEvents.queued("s1")).toEqual([]);
  });

  it("throws an infrastructure fault for the workflow's activity to retry", async () => {
    await working();
    await queue("first", "person-a");
    answer = async () => {
      throw new Error("connection reset");
    };
    await expect(startQueuedTurn(deps, "s1")).rejects.toThrow("connection reset");
    expect(await temp.store.sessionEvents.queued("s1")).toHaveLength(1);
  });

  it("is started by the observer when a turn of the session ends, never on another phase, and a fault is logged", async () => {
    await working();
    await queue("first", "person-a");
    const observer = newQueuedTurnObserver(deps);
    const run = create(RunSchema, { metadata: { id: "a" }, spec: { target: { case: "sessionId", value: "s1" } } });
    await observer({ run, oldPhase: RunPhase.RUN_PENDING, newPhase: RunPhase.RUN_IN_PROGRESS });
    expect(created).toEqual([]);
    answer = async () => {
      throw new ConnectError("unavailable", Code.Unavailable);
    };
    await expect(observer({ run, oldPhase: RunPhase.RUN_IN_PROGRESS, newPhase: RunPhase.RUN_COMPLETED })).resolves.toBeUndefined();
    expect(created).toHaveLength(1);
  });
});
