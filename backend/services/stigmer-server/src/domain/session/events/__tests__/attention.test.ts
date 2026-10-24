/**
 * Pins SessionQueryController.streamAttention (../attention.ts) on a real
 * store: a conversation the caller created that stops working sends one
 * Attention, "finished", "failed" or "needs_answer" by its idle's reason,
 * with its title and turn; another person's conversation, and an idle the
 * person's own stop caused, send nothing; a stream sends nothing from
 * before it opened, and one resumed with a cursor sends what came after
 * it; an idle committed after a later one, stamped earlier, still comes;
 * the stream wakes on the broker's idle bell and on its tail timer, and
 * ends with UNAVAILABLE when the broker closes; a request with no
 * organization, or a cursor the stream never wrote, is refused. A read
 * pages past one batch, forgets the ids its window has passed, and reads a
 * conversation's title afresh; a resume from further back than a day reads
 * from a day ago; the authorizer is asked again once five minutes have
 * gone, and its refusal then ends the stream with nothing sent; a store
 * that fails a read ends the stream INTERNAL.
 */
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createContextValues, type HandlerContext } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunSchema, type Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { StreamAttentionRequestSchema, type Attention } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { createLogger } from "../../../../boot/logger.js";
import type { CallerIdentity } from "../../../../extensions/identity.js";
import { callerIdentityKey } from "../../../../pipeline/interceptors/auth.js";
import { newPermissiveSingleTeamAuthorizer } from "../../../../pipeline/steps/authorize.js";
import { tempStore } from "../../../../store/sqlite/__tests__/support.js";
import type { TempStore } from "../../../../store/sqlite/__tests__/support.js";
import {
  ATTENTION_OVERLAP_MS,
  ATTENTION_RESUME_LIMIT_MS,
  attentionCursorOf,
  positionOfCursor,
  streamAttention,
  type StreamAttentionDeps,
} from "../attention.js";
import { SessionEventBroker, sessionIdleBellOf } from "../broker.js";
import { draftOf } from "../codec.js";
import { createRunAppendingEvents, updateRunAppendingEvents } from "../run-writes.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });
const ME = "acc_me";
/** A cursor before every idle: a resumed stream reads them all. */
const EPOCH_CURSOR = "1970-01-01T00:00:00.000Z|";
const SOMEONE = "acc_someone";

let temp: TempStore;
let broker: SessionEventBroker;
let deps: StreamAttentionDeps;
let aborts: AbortController[];

beforeEach(() => {
  temp = tempStore();
  broker = new SessionEventBroker(silentLogger);
  deps = { store: temp.store, authorizer: newPermissiveSingleTeamAuthorizer(), sessionEventBroker: broker, tailMs: { min: 60_000, max: 60_000 } };
  aborts = [];
});

afterEach(async () => {
  for (const abort of aborts) abort.abort();
  await temp.cleanup();
});

function caller(identityId = ME): CallerIdentity {
  return { identityId, callerClass: "user", issuer: "", rawToken: "" };
}

/**
 * The stream's next attention, asked once the stream listens: a write
 * before then is from before it opened, which it never sends.
 */
async function listening(stream: AsyncGenerator<Attention>): Promise<{ readonly next: Promise<IteratorResult<Attention>> }> {
  const next = stream.next();
  await vi.waitFor(() => expect(broker.subscriberCount(sessionIdleBellOf("acme"))).toBeGreaterThan(0));
  await new Promise((resolve) => setImmediate(resolve));
  return { next };
}

/** A stream of attention for `who`, read one at a time. */
function open(afterCursor = "", who = ME): AsyncGenerator<Attention> {
  const abort = new AbortController();
  aborts.push(abort);
  const context = {
    values: createContextValues().set(callerIdentityKey, caller(who)),
    signal: abort.signal,
  } as unknown as HandlerContext;
  return streamAttention(deps, create(StreamAttentionRequestSchema, { org: "acme", afterCursor }), context);
}

async function conversation(sessionId: string, creator: string, subject = `about ${sessionId}`): Promise<void> {
  await temp.store.saveResource(
    ApiResourceKind.session,
    sessionId,
    SessionSchema,
    create(SessionSchema, {
      metadata: { id: sessionId, org: "acme", name: `name-${sessionId}` },
      spec: { subject },
      status: { audit: { specAudit: { createdBy: { id: creator } } } },
    }),
  );
}

function turn(id: string, sessionId: string): Run {
  return create(RunSchema, {
    metadata: { id, org: "acme" },
    spec: { target: { case: "sessionId", value: sessionId }, message: `turn ${id}` },
    status: { phase: RunPhase.RUN_PENDING },
  });
}

const writes = () => ({ store: temp.store, sessionEventBroker: broker });

/** Appends `event` to a session's log as a session-level write, and rings the bell. */
async function appendToSession(sessionId: string, event: SessionEvent): Promise<void> {
  await temp.store.sessionEvents.append(sessionId, "acme", [draftOf(event)], {
    kind: ApiResourceKind.session,
    id: sessionId,
    schema: SessionSchema,
    admit: () => undefined,
  });
  broker.publish(sessionId, "acme", [event]);
}

/** A turn of `sessionId` that runs and stops in `phase`, with `stopCause` when given. */
async function stops(id: string, sessionId: string, phase: RunPhase, stopCause = ""): Promise<void> {
  await createRunAppendingEvents(writes(), turn(id, sessionId));
  await updateRunAppendingEvents(writes(), id, (run) => {
    run.status!.phase = RunPhase.RUN_IN_PROGRESS;
  });
  await updateRunAppendingEvents(writes(), id, (run) => {
    run.status!.phase = phase;
    run.status!.stopCause = stopCause;
  });
}

function summary(attention: Attention | undefined) {
  return attention === undefined ? undefined : [attention.sessionId, attention.title, attention.runId, attention.reason];
}

describe("streamAttention", () => {
  it("sends one attention when a conversation the caller created stops working, by its reason", async () => {
    await conversation("s1", ME);
    await conversation("s2", ME, "");
    const stream = open();
    const first = (await listening(stream)).next;
    await stops("a", "s1", RunPhase.RUN_COMPLETED);
    expect(summary((await first).value)).toEqual(["s1", "about s1", "a", "finished"]);
    const second = stream.next();
    await stops("b", "s2", RunPhase.RUN_FAILED);
    expect(summary((await second).value), "a conversation with no subject is called by its name").toEqual(["s2", "name-s2", "b", "failed"]);
    const third = stream.next();
    await appendToSession(
      "s1",
      create(SessionEventSchema, {
        runId: "c",
        event: { case: "sessionStatusIdle", value: { id: "idle_asks", stopReason: { type: "requires_action", eventIds: ["toolu_1"] } } },
      }),
    );
    expect(summary((await third).value)).toEqual(["s1", "about s1", "c", "needs_answer"]);
  });

  it("sends nothing for another person's conversation, a gone one, or an idle the person's own stop caused", async () => {
    await conversation("theirs", SOMEONE);
    await conversation("mine", ME);
    const stream = open();
    const next = (await listening(stream)).next;
    await stops("t", "theirs", RunPhase.RUN_COMPLETED);
    await stops("gone", "nowhere", RunPhase.RUN_COMPLETED);
    await stops("stopped", "mine", RunPhase.RUN_CANCELLED, "user");
    await appendToSession(
      "mine",
      create(SessionEventSchema, { event: { case: "sessionStatusIdle", value: { id: "idle_new", stopReason: { type: "a_reason_to_come" } } } }),
    );
    await stops("done", "mine", RunPhase.RUN_COMPLETED);
    expect(summary((await next).value), "the first that needs the caller").toEqual(["mine", "about mine", "done", "finished"]);
  });

  it("reads a window of more idles than one batch, page by page", async () => {
    await conversation("busy", ME);
    for (let i = 0; i <= 100; i += 1) {
      await appendToSession(
        "busy",
        create(SessionEventSchema, { event: { case: "sessionStatusIdle", value: { id: `idle_${i}`, stopReason: { type: "end_turn" } } } }),
      );
    }
    const stream = open(EPOCH_CURSOR);
    const ids = new Set<string>();
    while (ids.size < 101) {
      ids.add(((await stream.next()).value as Attention).id);
    }
    expect([ids.has("idle_0"), ids.has("idle_100")], "both ends of a window past one batch").toEqual([true, true]);
  });

  it("forgets the ids its window has passed, and still sends each idle once", async () => {
    await conversation("s1", ME);
    // An hour ago, so both idles sit inside the resume window on any day (stigmer#2563).
    const start = Date.now() - 60 * 60_000;
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (const [id, at] of [["early", start], ["late", start + 3 * ATTENTION_OVERLAP_MS]] as const) {
        vi.setSystemTime(at);
        await appendToSession(
          "s1",
          create(SessionEventSchema, { event: { case: "sessionStatusIdle", value: { id, stopReason: { type: "end_turn" } } } }),
        );
      }
    } finally {
      vi.useRealTimers();
    }
    const stream = open(EPOCH_CURSOR);
    const sent = [((await stream.next()).value as Attention).id, ((await stream.next()).value as Attention).id];
    const next = stream.next();
    await stops("after", "s1", RunPhase.RUN_COMPLETED);
    sent.push(((await next).value as Attention).runId);
    expect(sent).toEqual(["early", "late", "after"]);
  });

  it("asks the authorizer again before the next attention once five minutes have gone", async () => {
    let clock = Date.now();
    const authorize = vi.fn(newPermissiveSingleTeamAuthorizer().authorize);
    deps = { ...deps, authorizer: { authorize }, now: () => clock };
    await conversation("s1", ME);
    const stream = open();
    const first = (await listening(stream)).next;
    await stops("a", "s1", RunPhase.RUN_COMPLETED);
    await first;
    expect(authorize).toHaveBeenCalledTimes(1);
    clock += 5 * 60_000;
    const second = stream.next();
    await stops("b", "s1", RunPhase.RUN_COMPLETED);
    expect(((await second).value as Attention).runId).toBe("b");
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it("ends with the authorizer's refusal at the five-minute check, and sends nothing", async () => {
    let clock = Date.now();
    let allowed = true;
    const authorize = vi.fn(() => Promise.resolve(allowed ? { kind: "allow" as const } : { kind: "deny" as const, reason: "gone" }));
    deps = { ...deps, authorizer: { authorize }, now: () => clock };
    await conversation("s1", ME);
    const stream = open();
    const next = (await listening(stream)).next;
    clock += 5 * 60_000;
    allowed = false;
    await stops("a", "s1", RunPhase.RUN_COMPLETED);
    await expect(next).rejects.toSatisfy((error) => error instanceof ConnectError && error.code === Code.PermissionDenied);
    expect(authorize).toHaveBeenCalledTimes(2);
  });

  it("resumes from a day ago at most, whatever cursor it is given", async () => {
    await conversation("s1", ME);
    const now = Date.now();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (const [id, at] of [["two_days_ago", now - 2 * ATTENTION_RESUME_LIMIT_MS], ["an_hour_ago", now - 3_600_000]] as const) {
        vi.setSystemTime(at);
        await appendToSession(
          "s1",
          create(SessionEventSchema, { event: { case: "sessionStatusIdle", value: { id, stopReason: { type: "end_turn" } } } }),
        );
      }
    } finally {
      vi.useRealTimers();
    }
    expect(((await open(EPOCH_CURSOR).next()).value as Attention).id).toBe("an_hour_ago");
  });

  it("reads a conversation's title afresh at each idle", async () => {
    await conversation("s1", ME, "before");
    const stream = open();
    const first = (await listening(stream)).next;
    await stops("a", "s1", RunPhase.RUN_COMPLETED);
    expect(((await first).value as Attention).title).toBe("before");
    await conversation("s1", ME, "after");
    const second = stream.next();
    await stops("b", "s1", RunPhase.RUN_COMPLETED);
    expect(((await second).value as Attention).title).toBe("after");
  });

  it("ends INTERNAL when the store fails a read", async () => {
    await conversation("s1", ME);
    await stops("a", "s1", RunPhase.RUN_COMPLETED);
    const internal = (error: unknown) => error instanceof ConnectError && error.code === Code.Internal;

    const listByOrg = vi.spyOn(temp.store.sessionEvents, "listByOrg").mockRejectedValueOnce(new Error("disk"));
    await expect(open(EPOCH_CURSOR).next()).rejects.toSatisfy(internal);
    listByOrg.mockRestore();

    const getResource = vi.spyOn(temp.store, "getResource").mockRejectedValueOnce(new Error("disk"));
    await expect(open(EPOCH_CURSOR).next()).rejects.toSatisfy(internal);
    getResource.mockRestore();

    const list = vi.spyOn(temp.store.sessionEvents, "list").mockRejectedValueOnce(new Error("disk"));
    await expect(open(EPOCH_CURSOR).next()).rejects.toSatisfy(internal);
    list.mockRestore();
  });

  it("sends nothing for an idle an interrupt left with no turn to stop", async () => {
    await conversation("mine", ME);
    const stream = open();
    const next = (await listening(stream)).next;
    // An interrupt that dropped only waiting messages: the drop's idle.
    await appendToSession("mine", create(SessionEventSchema, { event: { case: "userInterrupt", value: { id: "int_1" } } }));
    await appendToSession(
      "mine",
      create(SessionEventSchema, { event: { case: "sessionStatusIdle", value: { id: "idle_drop", stopReason: { type: "end_turn" } } } }),
    );
    await stops("after", "mine", RunPhase.RUN_COMPLETED);
    expect(summary((await next).value)).toEqual(["mine", "about mine", "after", "finished"]);
  });

  it("sends nothing from before it opened, and resumes after a cursor", async () => {
    await conversation("s1", ME);
    await stops("old", "s1", RunPhase.RUN_COMPLETED);
    const fresh = open();
    const next = (await listening(fresh)).next;
    await stops("new", "s1", RunPhase.RUN_COMPLETED);
    const seen = (await next).value as Attention;
    expect(seen.runId).toBe("new");

    const resumed = open(seen.cursor);
    const after = resumed.next();
    await stops("later", "s1", RunPhase.RUN_COMPLETED);
    const runs: string[] = [];
    for (let read = await after; ; read = await resumed.next()) {
      runs.push((read.value as Attention).runId);
      if (runs.includes("later")) break;
    }
    expect(runs, "a resumed stream reads its window again (a client keeps the ids it showed), then what came after").toContain("later");
  });

  it("sends an idle committed after a later one, stamped within the window", async () => {
    await conversation("s1", ME);
    await conversation("s2", ME);
    const stream = open();
    const first = (await listening(stream)).next;
    await stops("a", "s1", RunPhase.RUN_COMPLETED);
    const seen = (await first).value as Attention;
    const second = stream.next();
    // Another writer's clock stamped this one, in another conversation,
    // before the idle already sent.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse(seen.at) - ATTENTION_OVERLAP_MS / 2);
    try {
      await appendToSession(
        "s2",
        create(SessionEventSchema, { event: { case: "sessionStatusIdle", value: { id: "late_idle", stopReason: { type: "end_turn" } } } }),
      );
    } finally {
      vi.useRealTimers();
    }
    const late = (await second).value as Attention;
    expect([late.id, late.at < seen.at]).toEqual(["late_idle", true]);
  });

  it("wakes on its tail timer for an idle another process wrote", async () => {
    deps = { ...deps, tailMs: { min: 5, max: 10 } };
    await conversation("s1", ME);
    const stream = open();
    const next = (await listening(stream)).next;
    // Written with a broker the stream does not hear: another process.
    await createRunAppendingEvents({ store: temp.store, sessionEventBroker: new SessionEventBroker(silentLogger) }, turn("x", "s1"));
    await updateRunAppendingEvents({ store: temp.store, sessionEventBroker: new SessionEventBroker(silentLogger) }, "x", (run) => {
      run.status!.phase = RunPhase.RUN_COMPLETED;
    });
    expect(((await next).value as Attention).runId).toBe("x");
  });

  it("ends with UNAVAILABLE when the broker closes", async () => {
    const stream = open();
    const next = (await listening(stream)).next;
    broker.close();
    await expect(next).rejects.toSatisfy((error) => error instanceof ConnectError && error.code === Code.Unavailable);
  });

  it("refuses a request with no organization, and a cursor it never wrote", async () => {
    const abort = new AbortController();
    aborts.push(abort);
    const context = { values: createContextValues().set(callerIdentityKey, caller()), signal: abort.signal } as unknown as HandlerContext;
    await expect(streamAttention(deps, create(StreamAttentionRequestSchema, { org: "" }), context).next()).rejects.toSatisfy(
      (error) => error instanceof ConnectError && error.code === Code.InvalidArgument,
    );
    for (const cursor of ["not-a-cursor", "2026|e1", "-271821-04-20T00:00:00.000Z|e1", "2026-10-23T00:00:00Z|e1"]) {
      await expect(open(cursor).next(), cursor).rejects.toSatisfy((error) => error instanceof ConnectError && error.code === Code.InvalidArgument);
    }
    expect(positionOfCursor(attentionCursorOf({ processedAt: "2026-10-23T00:00:00.000Z", eventId: "e|1" }))).toEqual({
      processedAt: "2026-10-23T00:00:00.000Z",
      eventId: "e|1",
    });
  });
});
