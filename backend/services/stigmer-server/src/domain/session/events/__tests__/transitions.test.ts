/**
 * Pins what the server writes into a session's log for each run
 * transition (../transitions.ts): the turn's user message at creation, and
 * the session's status, which describes the whole session, so a run that
 * stops ends the turn only when no other run of the session works.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";

import { eventTypeOf } from "../catalog.js";
import { sessionEventsForTransition, sessionIdOfRun } from "../transitions.js";
import type { RunTransition } from "../transitions.js";

const P = RunPhase;

function run(phase: RunPhase, extra: { error?: string; message?: string } = {}): Run {
  return create(RunSchema, {
    metadata: { id: "run_1" },
    spec: { target: { case: "sessionId", value: "ses_1" }, message: extra.message ?? "summarise the repo" },
    status: { phase, error: extra.error ?? "" },
  });
}

/**
 * The session as a consistent log states it before the transition: running
 * when this run was working or another works.
 */
function before(transition: RunTransition, othersWorking: number) {
  const wasWorking =
    transition.kind !== "create" &&
    [P.RUN_PENDING, P.RUN_IN_PROGRESS, P.RUN_WAITING_FOR_APPROVAL].includes(transition.previousPhase);
  return { othersWorking, state: wasWorking || othersWorking > 0 ? ("running" as const) : ("idle" as const) };
}

function eventsFor(transition: RunTransition, others = 0) {
  return sessionEventsForTransition(transition, before(transition, others));
}

function types(transition: RunTransition, others = 0): string[] {
  return eventsFor(transition, others).map(eventTypeOf);
}

const update = (from: RunPhase, to: RunPhase, error?: string): RunTransition => ({
  kind: "update",
  previousPhase: from,
  run: run(to, { error }),
});

describe("creation", () => {
  it("writes the turn's text as a user message, then running when nothing else works", () => {
    const events = eventsFor({ kind: "create", run: run(P.RUN_PENDING) });
    expect(events.map(eventTypeOf)).toEqual(["user.message", "session.status_running"]);
    const message = events[0]!.event;
    expect(message.case === "userMessage" && message.value.content.map((b) => [b.type, b.text])).toEqual([
      ["text", "summarise the repo"],
    ]);
  });

  it("writes only the user message while another run of the session works (the session is already running)", () => {
    expect(types({ kind: "create", run: run(P.RUN_PENDING) }, 1)).toEqual(["user.message"]);
  });
});

describe("a run that stops working", () => {
  it.each([P.RUN_COMPLETED, P.RUN_CANCELLED, P.RUN_PAUSED, P.RUN_TERMINATED])(
    "%s ends the session's turn as end_turn when it was the last working run",
    (to) => {
      const events = eventsFor(update(P.RUN_IN_PROGRESS, to));
      expect(events.map(eventTypeOf)).toEqual(["session.status_idle"]);
      const idle = events[0]!.event;
      expect(idle.case === "sessionStatusIdle" && idle.value.stopReason?.type).toBe("end_turn");
      expect(idle.case === "sessionStatusIdle" && idle.value.stopDetails).toBeUndefined();
    },
  );

  it("FAILED writes a terminal unknown_error with the run's error, then idle as retries_exhausted", () => {
    const events = eventsFor(update(P.RUN_IN_PROGRESS, P.RUN_FAILED, "model refused"));
    expect(events.map(eventTypeOf)).toEqual(["session.error", "session.status_idle"]);
    const error = events[0]!.event;
    expect(error.case === "sessionError" && [error.value.error?.type, error.value.error?.message, error.value.error?.retryStatus?.type]).toEqual([
      "unknown_error",
      "model refused",
      "terminal",
    ]);
    const idle = events[1]!.event;
    expect(idle.case === "sessionStatusIdle" && idle.value.stopReason?.type).toBe("retries_exhausted");
  });

  it("writes no idle while another run of the session still works; FAILED still reports its error", () => {
    expect(types(update(P.RUN_IN_PROGRESS, P.RUN_COMPLETED), 1)).toEqual([]);
    expect(types(update(P.RUN_IN_PROGRESS, P.RUN_FAILED, "x"), 1)).toEqual(["session.error"]);
  });

  it("removing a working run ends the turn when it was the last; removing a finished one writes nothing", () => {
    expect(types({ kind: "remove", previousPhase: P.RUN_IN_PROGRESS, runId: "run_1" }, 0)).toEqual([
      "session.status_idle",
    ]);
    expect(types({ kind: "remove", previousPhase: P.RUN_IN_PROGRESS, runId: "run_1" }, 1)).toEqual([]);
    expect(types({ kind: "remove", previousPhase: P.RUN_COMPLETED, runId: "run_1" }, 0)).toEqual([]);
  });
});

describe("a run that starts working again, and changes that stay working", () => {
  it("resume and recover write running when nothing else works, and nothing when something does", () => {
    expect(types(update(P.RUN_PAUSED, P.RUN_IN_PROGRESS), 0)).toEqual(["session.status_running"]);
    expect(types(update(P.RUN_FAILED, P.RUN_PENDING), 0)).toEqual(["session.status_running"]);
    expect(types(update(P.RUN_PAUSED, P.RUN_IN_PROGRESS), 1)).toEqual([]);
  });

  it("PENDING to IN_PROGRESS, waiting for approval and back, and progress writes are not transitions of the session", () => {
    expect(types(update(P.RUN_PENDING, P.RUN_IN_PROGRESS))).toEqual([]);
    expect(types(update(P.RUN_IN_PROGRESS, P.RUN_WAITING_FOR_APPROVAL))).toEqual([]);
    expect(types(update(P.RUN_WAITING_FOR_APPROVAL, P.RUN_IN_PROGRESS))).toEqual([]);
    expect(types(update(P.RUN_IN_PROGRESS, P.RUN_IN_PROGRESS))).toEqual([]);
    expect(types(update(P.RUN_COMPLETED, P.RUN_COMPLETED))).toEqual([]);
  });

  it("never writes session.status_terminated: a Stigmer conversation always takes another message", () => {
    for (const from of [P.RUN_PENDING, P.RUN_IN_PROGRESS, P.RUN_WAITING_FOR_APPROVAL]) {
      for (const to of [P.RUN_TERMINATED, P.RUN_FAILED, P.RUN_CANCELLED]) {
        expect(types(update(from, to))).not.toContain("session.status_terminated");
      }
    }
  });
});

describe("a log that drifted is put right by the next write in its session", () => {
  it("a session that reads idle while a run works reads running after any write of a working run", () => {
    expect(
      sessionEventsForTransition(update(P.RUN_IN_PROGRESS, P.RUN_IN_PROGRESS), { othersWorking: 0, state: "idle" }).map(eventTypeOf),
    ).toEqual(["session.status_running"]);
    expect(
      sessionEventsForTransition({ kind: "create", run: run(P.RUN_PENDING) }, { othersWorking: 1, state: "idle" }).map(eventTypeOf),
    ).toEqual(["user.message", "session.status_running"]);
  });

  it("a session that reads running while nothing works reads idle after the next write", () => {
    expect(
      sessionEventsForTransition(update(P.RUN_COMPLETED, P.RUN_COMPLETED), { othersWorking: 0, state: "running" }).map(eventTypeOf),
    ).toEqual(["session.status_idle"]);
  });

  it("a state already stated is not stated again", () => {
    expect(
      sessionEventsForTransition(update(P.RUN_PENDING, P.RUN_IN_PROGRESS), { othersWorking: 0, state: "running" }),
    ).toEqual([]);
  });
});

describe("the events' identity", () => {
  it("each event has its own server-minted id and names the run it belongs to", () => {
    const events = eventsFor({ kind: "create", run: run(P.RUN_PENDING) });
    const ids = events.map((e) => (e.event.case === undefined ? "" : e.event.value.id));
    expect(ids.every((id) => /^sevt_[0-9a-z]{26}$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(events.every((e) => e.runId === "run_1" && e.threadId === "")).toBe(true);
  });

  it("a run's session is its session_id target; a run in none has none", () => {
    expect(sessionIdOfRun(run(P.RUN_PENDING))).toBe("ses_1");
    expect(sessionIdOfRun(create(RunSchema, {}))).toBe("");
  });
});
