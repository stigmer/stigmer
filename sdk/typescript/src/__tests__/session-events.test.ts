/**
 * Pins the follow helpers (../session-events.ts) against a scripted log: a
 * follow resumes after the place it asks for and reconnects from the last
 * event it delivered when the stream drops or ends, with a growing wait;
 * a refusal ends it; an abort ends it quietly. `sendAndWait` reads from the
 * newest place of an existing session (the whole log of a new one), starts
 * the turn and returns its answer once its status ends it, or its asks
 * when the session waits on them; `waitForTurn` resumes after an answer.
 * Against a server older than the liveness preview, a follow that asked
 * for it asks again without it, once and for good.
 */
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { RunSchema, type Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import {
  SessionEventListSchema,
  StreamSessionEventsResponseSchema,
  type ListSessionEventsRequest,
  type StreamSessionEventsRequest,
  type StreamSessionEventsResponse,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";

import type { RunInput } from "../gen/run.js";
import { ALL_SESSION_PREVIEWS, followSession, newestSeq, sendAndWait, waitForTurn, type SendAndWaitClient } from "../session-events.js";

type EventInit = MessageInitShape<typeof SessionEventSchema>["event"];

function event(seq: number, runId: string, init: EventInit): SessionEvent {
  return create(SessionEventSchema, { seq: BigInt(seq), sessionId: "ses_1", runId, event: init });
}
function frameOf(e: SessionEvent): StreamSessionEventsResponse {
  return create(StreamSessionEventsResponseSchema, { frame: { case: "event", value: e } });
}

/**
 * A log double: `log` holds the stored events; each stream call serves the
 * events after its `after_seq`, then runs the next scripted step (`end`,
 * `drop` a transient error, `refuse`, or append more events and end).
 */
function logDouble(log: SessionEvent[], steps: Array<"end" | "drop" | "refuse" | SessionEvent[]> = []) {
  const requests: StreamSessionEventsRequest[] = [];
  const lists: ListSessionEventsRequest[] = [];
  const created: RunInput[] = [];
  const client: SendAndWaitClient = {
    session: {
      async *streamEvents(input: StreamSessionEventsRequest, signal?: AbortSignal) {
        requests.push(input);
        for (const e of log.filter((x) => x.seq > (input.afterSeq ?? 0n))) {
          yield frameOf(e);
        }
        const step = steps.shift() ?? "end";
        if (step === "drop") throw new ConnectError("gone", Code.Unavailable);
        if (step === "refuse") throw new ConnectError("no", Code.PermissionDenied);
        if (Array.isArray(step)) {
          log.push(...step);
          for (const e of step) {
            if (signal?.aborted) return;
            yield frameOf(e);
          }
        }
      },
      async listEvents(input: ListSessionEventsRequest) {
        lists.push(input);
        const newest = [...log].sort((a, b) => Number(b.seq - a.seq))[0];
        return create(SessionEventListSchema, { events: newest === undefined ? [] : [newest] });
      },
    },
    run: {
      async create(input: RunInput): Promise<Run> {
        created.push(input);
        return create(RunSchema, { metadata: { id: "run_new" }, spec: { target: { case: "sessionId", value: input.sessionId ?? "ses_new" } } });
      },
    },
  };
  return { client, requests, lists, created };
}

const noWait = async () => {};

/**
 * A server that predates `stigmer.run.liveness`: its `event_deltas` takes at
 * most three names from its own list, and it refuses any other request as
 * invalid before it streams anything.
 */
function olderServer(log: SessionEvent[], steps: Array<"end" | "drop"> = []) {
  const requests: StreamSessionEventsRequest[] = [];
  const known = new Set(["agent.message", "agent.thinking", "stigmer.tool_output_delta"]);
  const client = {
    session: {
      async *streamEvents(input: StreamSessionEventsRequest) {
        requests.push(input);
        if (input.eventDeltas.length > 3 || input.eventDeltas.some((type) => !known.has(type))) {
          throw new ConnectError("validation error: event_deltas", Code.InvalidArgument);
        }
        for (const e of log.filter((x) => x.seq > (input.afterSeq ?? 0n))) {
          yield frameOf(e);
        }
        if (steps.shift() === "drop") throw new ConnectError("gone", Code.Unavailable);
      },
      async listEvents() {
        return create(SessionEventListSchema, {});
      },
    },
  };
  return { client, requests };
}

describe("followSession against a server that predates the liveness preview", () => {
  it("asks again without stigmer.run.liveness once, and keeps it off for the rest of the follow", async () => {
    const log = [event(1, "r", { case: "userMessage", value: { id: "u1" } })];
    const { client, requests } = olderServer(log, ["drop", "end"]);
    const abort = new AbortController();
    const seen: bigint[] = [];
    let waits = 0;
    for await (const frame of followSession(client, "ses_1", {
      previews: ALL_SESSION_PREVIEWS,
      signal: abort.signal,
      sleep: async () => {
        waits += 1;
        if (waits === 2) abort.abort();
      },
    })) {
      if (frame.frame.case === "event") seen.push(frame.frame.value.seq);
    }
    expect(seen).toEqual([1n]);
    expect(requests.map((r) => r.eventDeltas)).toEqual([
      ["agent.message", "agent.thinking", "stigmer.tool_output_delta", "stigmer.run.liveness"],
      ["agent.message", "agent.thinking", "stigmer.tool_output_delta"],
      ["agent.message", "agent.thinking", "stigmer.tool_output_delta"],
    ]);
  });

  it("ends on an invalid request that asked for no liveness, and on a second refusal", async () => {
    const refuseAll = {
      session: {
        async *streamEvents(): AsyncGenerator<StreamSessionEventsResponse> {
          throw new ConnectError("bad session id", Code.InvalidArgument);
        },
        async listEvents() {
          return create(SessionEventListSchema, {});
        },
      },
    };
    await expect(drain(followSession(refuseAll, "ses_1", { previews: ["agent.message"], sleep: noWait }))).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(drain(followSession(refuseAll, "ses_1", { previews: ALL_SESSION_PREVIEWS, sleep: noWait }))).rejects.toMatchObject({ code: "invalid-argument" });
  });
});

async function drain(follow: AsyncGenerator<StreamSessionEventsResponse>): Promise<void> {
  for await (const _ of follow) {
    // the follow's frames are not this test's
  }
}

describe("followSession", () => {
  it("resumes after the place it asks for and reconnects from the last event it delivered, waiting longer each time", async () => {
    const log = [event(1, "r", { case: "userMessage", value: { id: "u1" } }), event(2, "r", { case: "agentMessage", value: { id: "m1" } })];
    const { client, requests } = logDouble(log, ["drop", "end", [event(3, "r", { case: "agentMessage", value: { id: "m2" } })], "refuse"]);
    const waits: number[] = [];
    const seen: bigint[] = [];
    await expect(
      (async () => {
        for await (const frame of followSession(client, "ses_1", {
          afterSeq: 1n,
          previews: ["agent.message"],
          backoffMs: 10,
          maxBackoffMs: 15,
          sleep: async (ms) => {
            waits.push(ms);
          },
        })) {
          if (frame.frame.case === "event") seen.push(frame.frame.value.seq);
        }
      })(),
    ).rejects.toMatchObject({ code: "permission-denied" });
    expect(seen).toEqual([2n, 3n]);
    expect(requests.map((r) => [r.afterSeq, r.eventDeltas])).toEqual([
      [1n, ["agent.message"]],
      [2n, ["agent.message"]],
      [2n, ["agent.message"]],
      [3n, ["agent.message"]],
    ]);
    // A delivered event resets the wait; failures in a row double it, capped.
    expect(waits).toEqual([10, 15, 10]);
  });

  it("an abort ends the follow quietly, whether it comes while reading or while waiting", async () => {
    const controller = new AbortController();
    const { client } = logDouble([event(1, "r", { case: "userMessage", value: { id: "u1" } })], ["drop"]);
    const seen: string[] = [];
    for await (const frame of followSession(client, "ses_1", {
      signal: controller.signal,
      sleep: async () => {
        controller.abort();
      },
    })) {
      seen.push(frame.frame.case ?? "");
    }
    expect(seen).toEqual(["event"]);

    const aborting = new AbortController();
    const { client: dropping } = logDouble([], ["drop"]);
    const streamEvents = dropping.session.streamEvents.bind(dropping.session);
    dropping.session.streamEvents = async function* (input, signal) {
      aborting.abort();
      yield* streamEvents(input, signal);
    };
    const frames = [];
    for await (const frame of followSession(dropping, "ses_1", { signal: aborting.signal, sleep: noWait })) frames.push(frame);
    expect(frames).toEqual([]);

    const ending = new AbortController();
    const { client: closing } = logDouble([], ["end"]);
    const endEvents = closing.session.streamEvents.bind(closing.session);
    closing.session.streamEvents = async function* (input, signal) {
      yield* endEvents(input, signal);
      ending.abort();
    };
    for await (const frame of followSession(closing, "ses_1", { signal: ending.signal, sleep: noWait })) frames.push(frame);
    expect(frames).toEqual([]);
  });

  it("waits for real by default, and an abort cuts the wait short", async () => {
    const controller = new AbortController();
    const { client } = logDouble([], ["end", "end"]);
    const started = Date.now();
    setTimeout(() => controller.abort(), 20);
    for await (const _frame of followSession(client, "ses_1", { signal: controller.signal, backoffMs: 5_000 })) {
      // no frames
    }
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe("newestSeq", () => {
  it("is the newest event's place, or 0 for an empty log", async () => {
    expect(await newestSeq(logDouble([event(7, "r", { case: "userMessage", value: { id: "u" } })]).client, "ses_1")).toBe(7n);
    expect(await newestSeq(logDouble([]).client, "ses_1")).toBe(0n);
  });
});

describe("sendAndWait and waitForTurn", () => {
  const R = "run_new";
  const turnEvents = (from: number): SessionEvent[] => [
    event(from, R, { case: "userMessage", value: { id: "u", content: [{ type: "text", text: "hi" }] } }),
    event(from + 1, R, { case: "stigmerRunStatus", value: { id: "s1", phase: "pending" } }),
    event(from + 2, R, { case: "agentMessage", value: { id: `${R}.root.m0`, content: [{ type: "text", text: "Hello." }] } }),
    event(from + 3, R, { case: "stigmerAgentStructuredOutput", value: { id: `${R}.output`, output: { ok: true } } }),
    event(from + 4, R, { case: "stigmerRunStatus", value: { id: "s2", phase: "completed", stopCause: "" } }),
  ];

  it("in an existing session reads from its newest place and returns the answer once the turn ends", async () => {
    const earlier = [event(1, "run_old", { case: "agentMessage", value: { id: "old", content: [{ type: "text", text: "Old." }] } })];
    const { client, requests, created } = logDouble(earlier, [turnEvents(2)]);
    const outcome = await sendAndWait(client, { sessionId: "ses_1", org: "acme", message: "hi" }, { sleep: noWait });
    expect(requests[0]!.afterSeq).toBe(1n);
    expect(created[0]).toMatchObject({ sessionId: "ses_1", org: "acme", message: "hi" });
    expect(created[0]!.name).toMatch(/^run-\d+$/);
    expect([outcome.runId, outcome.sessionId, outcome.phase, outcome.answer, outcome.lastSeq]).toEqual([R, "ses_1", "completed", "Hello.", 6n]);
    expect(outcome.structuredOutput).toEqual({ ok: true });
    expect(outcome.run?.metadata?.id).toBe(R);
    expect(outcome.turn.userMessage?.text).toBe("hi");
  });

  it("in a new session reads its whole log, and keeps a name it is given", async () => {
    const { client, requests, lists, created } = logDouble([], [turnEvents(1)]);
    const outcome = await sendAndWait(client, { sessionSpec: { org: "acme" } as never, org: "acme", message: "hi", name: "mine" }, { sleep: noWait });
    expect(lists).toEqual([]);
    expect(requests[0]!.afterSeq).toBe(0n);
    expect(created[0]!.name).toBe("mine");
    expect([outcome.sessionId, outcome.phase]).toEqual(["ses_new", "completed"]);
  });

  it("returns the asks when the session waits on the turn, and resumes after the answer", async () => {
    const waiting = [
      event(1, R, { case: "userMessage", value: { id: "u" } }),
      event(2, R, { case: "stigmerRunStatus", value: { id: "s1", phase: "running" } }),
      event(3, R, { case: "agentToolUse", value: { id: `${R}.c1`, name: "shell", input: {}, evaluatedPermission: "ask" } }),
      event(4, R, { case: "stigmerRunStatus", value: { id: "s2", phase: "waiting" } }),
      event(5, R, { case: "sessionStatusIdle", value: { id: "i", stopReason: { type: "requires_action", eventIds: [`${R}.c1`] } } }),
    ];
    const { client } = logDouble([], [waiting]);
    const asked = await sendAndWait(client, { org: "acme", message: "run it" }, { sleep: noWait });
    expect([asked.phase, asked.asks.map((a) => a.id), asked.lastSeq]).toEqual(["waiting", [`${R}.c1`], 5n]);

    const after = [
      event(6, R, { case: "userToolConfirmation", value: { id: "c", toolUseId: `${R}.c1`, result: "deny", denyMessage: "no" } }),
      event(7, R, { case: "stigmerRunStatus", value: { id: "s3", phase: "failed", stopCause: "failed", error: "boom" } }),
    ];
    const { client: next } = logDouble([...waiting], [after]);
    const done = await waitForTurn(next, "ses_new", R, { afterSeq: asked.lastSeq, sleep: noWait });
    expect([done.phase, done.stopCause, done.error, done.asks, done.run]).toEqual(["failed", "failed", "boom", [], undefined]);
  });

  it("an abort stops the wait with a cancelled error; a run that names no session is refused", async () => {
    const controller = new AbortController();
    const { client } = logDouble([], ["drop"]);
    const waiting = waitForTurn(client, "ses_1", R, {
      signal: controller.signal,
      sleep: async () => {
        controller.abort();
      },
    });
    await expect(waiting).rejects.toMatchObject({ code: "cancelled" });

    const { client: noSession } = logDouble([]);
    noSession.run.create = async () => create(RunSchema, { metadata: { id: R } });
    await expect(sendAndWait(noSession, { org: "acme", message: "hi" })).rejects.toMatchObject({ code: "internal" });
  });

  it("skips frames that change nothing and events of other turns", async () => {
    const other = [
      event(1, "run_other", { case: "userMessage", value: { id: "uo" } }),
      event(1, "run_other", { case: "userMessage", value: { id: "uo" } }),
      ...turnEvents(2),
    ];
    const { client } = logDouble([], [other]);
    const outcome = await waitForTurn(client, "ses_1", R, { sleep: noWait });
    expect(outcome.phase).toBe("completed");
  });
});
