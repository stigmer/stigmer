/**
 * Pins a session's queue (../queue.ts) and the run writes that read it
 * (../run-writes.ts) on a real store: a message is queued while a turn
 * works or messages wait, and refused while a turn waits for an answer or
 * is paused; a turn is created only in a session nothing else holds and
 * whose queue holds nothing it does not take; a turn from the queue moves
 * the messages it takes to the head as its own, in the order sent, and is
 * refused when one no longer waits; a turn that ends with messages queued
 * leaves the session running; a drop keeps the events listed, never
 * accepted, records a reason as a session.error and idles the session.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import { eventTypeOf } from "@stigmer/session-log";
import { createLogger } from "../../../../boot/logger.js";
import { errorReasonOf } from "../../../../pipeline/errors.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import {
  QUEUED_MESSAGE_GONE_REASON,
  SESSION_TURN_UNFINISHED_REASON,
} from "../../../run/constants.js";
import { SessionEventBroker } from "../broker.js";
import { eventOf } from "../codec.js";
import {
  dropQueuedMessages,
  enqueueMessage,
  queuedTurnOf,
  readQueueState,
} from "../queue.js";
import type { SessionQueueDeps } from "../queue.js";
import { createRunAppendingEvents, updateRunAppendingEvents } from "../run-writes.js";
import { readSessionState } from "../state.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

let temp: TempStore;
let deps: SessionQueueDeps;

beforeEach(() => {
  temp = tempStore();
  deps = { store: temp.store, sessionEventBroker: new SessionEventBroker(silentLogger) };
});

afterEach(async () => {
  await temp.cleanup();
});

function run(id: string, sessionId: string, phase = RunPhase.RUN_PENDING, message = `turn ${id}`): Run {
  return create(RunSchema, {
    metadata: { id, org: "acme" },
    spec: { target: { case: "sessionId", value: sessionId }, message },
    status: { phase },
  });
}

function setPhase(phase: RunPhase): (r: Run) => void {
  return (r) => {
    r.status!.phase = phase;
  };
}

async function queue(sessionId: string, text: string, sender = "person-a") {
  return enqueueMessage(deps, { sessionId, org: "acme", sender, turn: run("", sessionId, RunPhase.RUN_PHASE_UNSPECIFIED, text) });
}

/** The session's log as `run:type:id` (the id for a user.message only), without the turns' own stigmer.run.status. */
async function log(sessionId: string): Promise<string[]> {
  const records = await temp.store.sessionEvents.list(sessionId, { order: "asc", limit: 100 });
  return records
    .map(eventOf)
    .filter((event) => event.event.case !== "stigmerRunStatus")
    .map((event) => {
      const id = event.event.case === "userMessage" ? `:${event.event.value.id}` : "";
      return `${event.runId}:${eventTypeOf(event)}${id}`;
    });
}

function reasonOf(error: unknown): string | undefined {
  return error instanceof ConnectError ? errorReasonOf(error) : undefined;
}

describe("a session's queue", () => {
  it("queues a message while a turn works, with no run and no accepted time, and keeps the turn it would start", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    const outcome = await queue("s1", "also update the README");
    if (!("queued" in outcome)) throw new Error("not queued");
    expect(outcome.free).toBe(false);
    expect(outcome.queued.runId).toBe("");
    expect(outcome.queued.event.case === "userMessage" && outcome.queued.event.value.processedAt).toBe("");
    const [waiting] = await temp.store.sessionEvents.queued("s1");
    expect(waiting?.sender).toBe("person-a");
    expect(queuedTurnOf(waiting!).spec?.message).toBe("also update the README");
    expect(await readQueueState(temp.store, "s1")).toEqual({ kind: "busy" });
  });

  it("is free with nothing working and nothing waiting, and says so when a message is queued then", async () => {
    expect(await readQueueState(temp.store, "s1")).toEqual({ kind: "free" });
    const outcome = await queue("s1", "hello");
    expect("queued" in outcome && outcome.free).toBe(true);
    expect(await readQueueState(temp.store, "s1")).toEqual({ kind: "busy" });
    expect(await readSessionState(temp.store, "s1")).toBe("running");
  });

  it("refuses a message while a turn waits for an answer or is paused, and queues nothing", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_WAITING_FOR_APPROVAL));
    expect(await queue("s1", "x")).toEqual({ refused: { kind: "waiting", runId: "a" } });
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_IN_PROGRESS));
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_PAUSED));
    expect(await queue("s1", "x")).toEqual({ refused: { kind: "paused", runId: "a" } });
    expect(await temp.store.sessionEvents.queued("s1")).toEqual([]);
  });

  it("refuses a second turn while another of its session is unfinished, or while messages it does not take wait", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await expect(createRunAppendingEvents(deps, run("b", "s1"))).rejects.toSatisfy(
      (error) => reasonOf(error) === SESSION_TURN_UNFINISHED_REASON && (error as ConnectError).code === Code.FailedPrecondition,
    );
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_PAUSED));
    await expect(createRunAppendingEvents(deps, run("b", "s1"))).rejects.toSatisfy(
      (error) => reasonOf(error) === SESSION_TURN_UNFINISHED_REASON,
    );
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_IN_PROGRESS));
    await queue("s1", "queued while a worked");
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_COMPLETED));
    await expect(createRunAppendingEvents(deps, run("b", "s1"))).rejects.toSatisfy(
      (error) => reasonOf(error) === SESSION_TURN_UNFINISHED_REASON,
    );
    await createRunAppendingEvents(deps, run("c", "s2"));
  });

  it("keeps the session running when the turn ends with messages queued", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await queue("s1", "next");
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_COMPLETED));
    expect(await readSessionState(temp.store, "s1")).toBe("running");
    expect(await log("s1")).not.toContain(":session.status_idle");
  });

  it("starts the turn the queue waits for with every message, moved to the head as its own, in the order sent", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    const first = await queue("s1", "one");
    const second = await queue("s1", "two", "person-b");
    const ids = [first, second].map((outcome) => ("queued" in outcome && outcome.queued.event.case === "userMessage" ? outcome.queued.event.value.id : ""));
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_COMPLETED));
    const next = run("b", "s1");
    next.spec!.queuedMessageIds = ids;
    await createRunAppendingEvents(deps, next);
    expect(await log("s1")).toEqual([
      expect.stringMatching(/^a:user\.message:/),
      "a:session.status_running",
      `b:user.message:${ids[0]}`,
      `b:user.message:${ids[1]}`,
    ]);
    const moved = await temp.store.sessionEvents.list("s1", { order: "asc", runId: "b", types: ["user.message"], limit: 10 });
    expect(moved.every((record) => record.processedAt !== "")).toBe(true);
    expect(await temp.store.sessionEvents.queued("s1")).toEqual([]);
  });

  it("refuses a turn from the queue whose message no longer waits", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    const outcome = await queue("s1", "one");
    const id = "queued" in outcome && outcome.queued.event.case === "userMessage" ? outcome.queued.event.value.id : "";
    await dropQueuedMessages(deps, "s1", "acme");
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_COMPLETED));
    const next = run("b", "s1");
    next.spec!.queuedMessageIds = [id];
    await expect(createRunAppendingEvents(deps, next)).rejects.toSatisfy(
      (error) => reasonOf(error) === QUEUED_MESSAGE_GONE_REASON,
    );
  });

  it("drops what waits, keeping the events never accepted; with a reason, records it and idles a session nothing holds", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await queue("s1", "one");
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_COMPLETED));
    expect(await readSessionState(temp.store, "s1")).toBe("running");
    const dropped = await dropQueuedMessages(deps, "s1", "acme", {
      reason: { type: "unknown_error", message: "the queued messages were not read: the agent is gone" },
    });
    expect(dropped).toHaveLength(1);
    expect(await readSessionState(temp.store, "s1")).toBe("idle");
    const tail = (await log("s1")).slice(-3);
    expect(tail).toEqual([expect.stringMatching(/^:user\.message:/), ":session.error", ":session.status_idle"]);
    const [queued] = await temp.store.sessionEvents.list("s1", { order: "asc", types: ["user.message"], runId: "", limit: 1 });
    expect(eventOf(queued!).event.value?.processedAt).toBe("");
    expect(await dropQueuedMessages(deps, "s1", "acme")).toEqual([]);
  });

  it("a drop while a turn waits for an answer states no status: the waiting turn's writes do", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await queue("s1", "one");
    await updateRunAppendingEvents(deps, "a", setPhase(RunPhase.RUN_WAITING_FOR_APPROVAL));
    const before = await log("s1");
    await dropQueuedMessages(deps, "s1", "acme");
    expect(await log("s1")).toEqual(before);
  });

  it("a drop while a turn works leaves the session running", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    await queue("s1", "one");
    await dropQueuedMessages(deps, "s1", "acme");
    expect(await readSessionState(temp.store, "s1")).toBe("running");
  });

  it("a run update may take the queue as the run's own, and the message streams again under its id", async () => {
    await createRunAppendingEvents(deps, run("a", "s1"));
    const outcome = await queue("s1", "steer");
    const id = "queued" in outcome && outcome.queued.event.case === "userMessage" ? outcome.queued.event.value.id : "";
    const stream = deps.sessionEventBroker.subscribe("s1", []);
    await updateRunAppendingEvents(
      deps,
      "a",
      (_run, session) => ({
        last: session.queued.map((queued) => {
          const event = eventOf(queued.record);
          event.runId = "a";
          event.seq = 0n;
          event.sessionId = "";
          if (event.event.case === "userMessage") event.event.value.processedAt = "";
          return event;
        }),
        takeQueued: session.queued.map((queued) => queued.record.eventId),
      }),
      { queued: true },
    );
    expect((await log("s1")).at(-1)).toBe(`a:user.message:${id}`);
    expect(stream.dirty).toBe(true);
    expect(await temp.store.sessionEvents.queued("s1")).toEqual([]);
  });
});
