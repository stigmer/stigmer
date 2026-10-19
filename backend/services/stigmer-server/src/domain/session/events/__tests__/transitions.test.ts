/**
 * Pins what the server writes into a session's log for each run
 * transition (../transitions.ts): the turn's user message at creation,
 * its text then the file blocks the run recorded (none for a reconcile
 * turn, which has no message), and
 * the session's status, which describes the whole session, so a run that
 * stops ends the turn only when no other run of the session works; a turn
 * that waits for answers states requires_action with every open ask of
 * every waiting run, re-stated with the remainder as answers come in, and
 * a waiting run whose asks are all answered reads running. Every phase
 * change of the run also writes its own stigmer.run.status, pinned in its
 * own block; the other blocks read the session's events without it.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it } from "vitest";

import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { ContentBlockSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_content_pb";

import { eventTypeOf } from "@stigmer/session-log";
import { runPhaseWordOf, sessionEventsForTransition, sessionIdOfRun, sessionStatusOf } from "../transitions.js";
import type { RunTransition, SessionNow, SessionStatusNow } from "../transitions.js";

const P = RunPhase;

function run(phase: RunPhase, extra: { error?: string; message?: string; stopCause?: string } = {}): Run {
  return create(RunSchema, {
    metadata: { id: "run_1" },
    spec: { target: { case: "sessionId", value: "ses_1" }, message: extra.message ?? "summarise the repo" },
    status: { phase, error: extra.error ?? "", stopCause: extra.stopCause ?? "" },
  });
}

/**
 * The session as a consistent log states it before the transition: running
 * when this run was working or another works.
 */
function before(transition: RunTransition, othersWorking: number): SessionNow {
  const wasWorking =
    transition.kind !== "create" && [P.RUN_PENDING, P.RUN_IN_PROGRESS].includes(transition.previousPhase);
  return session(othersWorking, wasWorking || othersWorking > 0 ? RUNNING : IDLE);
}

const RUNNING: SessionStatusNow = { type: "running" };
const IDLE: SessionStatusNow = { type: "idle", reason: "end_turn", eventIds: [] };
const waitingOn = (...eventIds: string[]): SessionStatusNow => ({ type: "idle", reason: "requires_action", eventIds });

function session(
  othersWorking: number,
  status: SessionStatusNow | undefined,
  more: Partial<Pick<SessionNow, "othersWaiting" | "gates">> = {},
): SessionNow {
  return { othersWorking, othersWaiting: more.othersWaiting ?? [], gates: more.gates ?? [], status };
}

/** An open ask of a run, at a place in the log. */
const ask = (runId: string, toolUseId: string, seq: number) => ({ runId, toolUseId, seq });

/** Every event the transition appends. */
function allEventsFor(transition: RunTransition, others = 0) {
  return sessionEventsForTransition(transition, before(transition, others));
}

/** sessionEventsForTransition less the run's own stigmer.run.status. */
function sessionEventsOnly(transition: RunTransition, now: SessionNow) {
  return sessionEventsForTransition(transition, now).filter((event) => event.event.case !== "stigmerRunStatus");
}

/** The transition's events less the run's own stigmer.run.status. */
function eventsFor(transition: RunTransition, others = 0) {
  return allEventsFor(transition, others).filter((event) => event.event.case !== "stigmerRunStatus");
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

  it("follows the text with the files the server recorded on the run, in their order", () => {
    const withFiles = run(P.RUN_PENDING, { message: "see these" });
    withFiles.status!.messageFiles = [
      create(ContentBlockSchema, { type: "image", source: { type: "file", fileId: "file_shot" } }),
      create(ContentBlockSchema, { type: "document", source: { type: "file", fileId: "file_brief" } }),
    ];
    const message = eventsFor({ kind: "create", run: withFiles })[0]!.event;
    expect(
      message.case === "userMessage" && message.value.content.map((b) => [b.type, b.text, b.source?.fileId ?? ""]),
    ).toEqual([
      ["text", "see these", ""],
      ["image", "", "file_shot"],
      ["document", "", "file_brief"],
    ]);
  });

  it("writes only the user message while another run of the session works (the session is already running)", () => {
    expect(types({ kind: "create", run: run(P.RUN_PENDING) }, 1)).toEqual(["user.message"]);
  });

  it("a reconcile turn writes no user message; its status events are any run's", () => {
    const reconcile = run(P.RUN_PENDING, { message: "" });
    reconcile.spec!.reconcileFileReview = true;
    expect(types({ kind: "create", run: reconcile })).toEqual(["session.status_running"]);
    expect(types({ kind: "create", run: reconcile }, 1)).toEqual([]);
    reconcile.status!.phase = P.RUN_COMPLETED;
    reconcile.status!.stopCause = "review_resolved";
    expect(types({ kind: "update", previousPhase: P.RUN_IN_PROGRESS, run: reconcile })).toEqual(["session.status_idle"]);
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

  it("a turn stopped on its budget ends the session as budget_reached, read from the run's stop cause", () => {
    const events = eventsFor({
      kind: "update",
      previousPhase: P.RUN_IN_PROGRESS,
      run: run(P.RUN_TERMINATED, { error: "Cost limit exceeded", stopCause: "budget_reached" }),
    });
    expect(events.map(eventTypeOf)).toEqual(["session.status_idle"]);
    const idle = events[0]!.event;
    expect(idle.case === "sessionStatusIdle" && idle.value.stopReason?.type).toBe("budget_reached");
  });

  it("any other stop cause of a TERMINATED turn ends it as end_turn; the error text is never read", () => {
    for (const stopCause of ["", "eval_stopped", "user"]) {
      const events = eventsFor({
        kind: "update",
        previousPhase: P.RUN_IN_PROGRESS,
        run: run(P.RUN_TERMINATED, { error: "Cost limit exceeded", stopCause }),
      });
      const idle = events[0]!.event;
      expect(idle.case === "sessionStatusIdle" && idle.value.stopReason?.type).toBe("end_turn");
    }
  });

  it("a turn the model provider failed reports model_request_failed_error; every other failure unknown_error", () => {
    const failed = (stopCause: string) =>
      eventsFor({ kind: "update", previousPhase: P.RUN_IN_PROGRESS, run: run(P.RUN_FAILED, { error: "x", stopCause }) })[0]!.event;
    const model = failed("model_error");
    expect(model.case === "sessionError" && model.value.error?.type).toBe("model_request_failed_error");
    for (const stopCause of ["", "failed", "timeout", "infrastructure"]) {
      const other = failed(stopCause);
      expect(other.case === "sessionError" && other.value.error?.type).toBe("unknown_error");
    }
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

describe("the turn's own status", () => {
  function runStatus(transition: RunTransition, others = 0) {
    return allEventsFor(transition, others).flatMap((event) =>
      event.event.case === "stigmerRunStatus" ? [event.event.value] : [],
    );
  }

  it("creation states the turn's phase after its message and before the session's status", () => {
    const events = allEventsFor({ kind: "create", run: run(P.RUN_PENDING) });
    expect(events.map(eventTypeOf)).toEqual(["user.message", "stigmer.run.status", "session.status_running"]);
    expect(runStatus({ kind: "create", run: run(P.RUN_PENDING) }, 1).map((s) => s.phase)).toEqual(["pending"]);
  });

  it("every phase change is stated, whatever the session does; a write that keeps the phase states nothing", () => {
    expect(runStatus(update(P.RUN_PENDING, P.RUN_IN_PROGRESS)).map((s) => s.phase)).toEqual(["running"]);
    expect(runStatus(update(P.RUN_IN_PROGRESS, P.RUN_COMPLETED), 1).map((s) => s.phase)).toEqual(["completed"]);
    expect(runStatus(update(P.RUN_IN_PROGRESS, P.RUN_WAITING_FOR_APPROVAL)).map((s) => s.phase)).toEqual(["waiting"]);
    expect(runStatus(update(P.RUN_IN_PROGRESS, P.RUN_PAUSED)).map((s) => s.phase)).toEqual(["paused"]);
    expect(runStatus(update(P.RUN_IN_PROGRESS, P.RUN_IN_PROGRESS))).toEqual([]);
  });

  it("an ended turn carries its stop cause and error; a working one carries neither", () => {
    const [ended] = runStatus({
      kind: "update",
      previousPhase: P.RUN_IN_PROGRESS,
      run: run(P.RUN_TERMINATED, { error: "Cost limit exceeded", stopCause: "budget_reached" }),
    });
    expect([ended?.phase, ended?.stopCause, ended?.error]).toEqual(["terminated", "budget_reached", "Cost limit exceeded"]);
    const [resumed] = runStatus({
      kind: "update",
      previousPhase: P.RUN_FAILED,
      run: run(P.RUN_PENDING, { error: "stale", stopCause: "failed" }),
    });
    expect([resumed?.phase, resumed?.stopCause, resumed?.error]).toEqual(["pending", "", ""]);
  });

  it("a failed turn's status follows its session.error and precedes the session's idle", () => {
    expect(allEventsFor(update(P.RUN_IN_PROGRESS, P.RUN_FAILED, "x")).map(eventTypeOf)).toEqual([
      "session.error",
      "stigmer.run.status",
      "session.status_idle",
    ]);
  });

  it("a removed run states nothing of its own: its events go with it", () => {
    expect(runStatus({ kind: "remove", previousPhase: P.RUN_IN_PROGRESS, runId: "run_1" })).toEqual([]);
  });

  it("names every phase in one word, and none for a phase it does not know", () => {
    expect(
      [P.RUN_PENDING, P.RUN_IN_PROGRESS, P.RUN_WAITING_FOR_APPROVAL, P.RUN_PAUSED, P.RUN_COMPLETED, P.RUN_FAILED, P.RUN_CANCELLED, P.RUN_TERMINATED].map(
        runPhaseWordOf,
      ),
    ).toEqual(["pending", "running", "waiting", "paused", "completed", "failed", "cancelled", "terminated"]);
    expect(runPhaseWordOf(P.RUN_PHASE_UNSPECIFIED)).toBeUndefined();
    expect(runPhaseWordOf(99 as RunPhase)).toBeUndefined();
    expect(runStatus({ kind: "create", run: run(P.RUN_PHASE_UNSPECIFIED) })).toEqual([]);
  });
});

describe("a run that starts working again, and changes that stay working", () => {
  it("resume and recover write running when nothing else works, and nothing when something does", () => {
    expect(types(update(P.RUN_PAUSED, P.RUN_IN_PROGRESS), 0)).toEqual(["session.status_running"]);
    expect(types(update(P.RUN_FAILED, P.RUN_PENDING), 0)).toEqual(["session.status_running"]);
    expect(types(update(P.RUN_PAUSED, P.RUN_IN_PROGRESS), 1)).toEqual([]);
  });

  it("PENDING to IN_PROGRESS and progress writes are not transitions of the session", () => {
    expect(types(update(P.RUN_PENDING, P.RUN_IN_PROGRESS))).toEqual([]);
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

describe("a turn that waits for answers", () => {
  const W = P.RUN_WAITING_FOR_APPROVAL;
  const idleOf = (events: ReturnType<typeof sessionEventsForTransition>) => {
    const idle = events.find((e) => e.event.case === "sessionStatusIdle")?.event;
    return idle?.case === "sessionStatusIdle" ? [idle.value.stopReason?.type, idle.value.stopReason?.eventIds] : undefined;
  };

  it("goes idle with requires_action naming its open asks, in log order", () => {
    const events = sessionEventsOnly(
      update(P.RUN_IN_PROGRESS, W),
      session(0, RUNNING, { gates: [ask("run_1", "run_1.b", 7), ask("run_1", "run_1.a", 9)] }),
    );
    expect(events.map(eventTypeOf)).toEqual(["session.status_idle"]);
    expect(idleOf(events)).toEqual(["requires_action", ["run_1.b", "run_1.a"]]);
  });

  it("re-states the idle with the remainder when some of several asks are answered, and nothing when unchanged", () => {
    const remainder = sessionEventsOnly(
      update(W, W),
      session(0, waitingOn("run_1.b", "run_1.a"), { gates: [ask("run_1", "run_1.a", 9)] }),
    );
    expect(idleOf(remainder)).toEqual(["requires_action", ["run_1.a"]]);
    expect(
      sessionEventsOnly(update(W, W), session(0, waitingOn("run_1.a"), { gates: [ask("run_1", "run_1.a", 9)] })),
    ).toEqual([]);
  });

  it("reads running once every ask of the waiting run is answered: it is about to resume", () => {
    expect(sessionEventsOnly(update(W, W), session(0, waitingOn("run_1.a"))).map(eventTypeOf)).toEqual([
      "session.status_running",
    ]);
    expect(sessionEventsOnly(update(W, P.RUN_IN_PROGRESS), session(0, RUNNING))).toEqual([]);
  });

  it("names every waiting run's asks, and ignores the asks of a run that no longer waits", () => {
    const events = sessionEventsOnly(
      update(P.RUN_IN_PROGRESS, W),
      session(0, RUNNING, {
        othersWaiting: ["run_0"],
        gates: [ask("run_0", "run_0.x", 3), ask("run_1", "run_1.a", 9), ask("run_9", "run_9.z", 1)],
      }),
    );
    expect(idleOf(events)).toEqual(["requires_action", ["run_0.x", "run_1.a"]]);
  });

  it("a queued turn reads running while an earlier one waits", () => {
    const events = sessionEventsOnly(
      { kind: "create", run: run(P.RUN_PENDING) },
      session(0, waitingOn("run_0.x"), { othersWaiting: ["run_0"], gates: [ask("run_0", "run_0.x", 3)] }),
    );
    expect(events.map(eventTypeOf)).toEqual(["user.message", "session.status_running"]);
  });

  it("a waiting turn that is stopped ends the session as end_turn; one that fails reports its error first", () => {
    expect(idleOf(sessionEventsOnly(update(W, P.RUN_CANCELLED), session(0, waitingOn("run_1.a"))))).toEqual([
      "end_turn",
      [],
    ]);
    const failed = sessionEventsOnly(update(W, P.RUN_FAILED, "gave up"), session(0, waitingOn("run_1.a")));
    expect(failed.map(eventTypeOf)).toEqual(["session.error", "session.status_idle"]);
    expect(idleOf(failed)).toEqual(["retries_exhausted", []]);
  });

  it("another turn's end keeps the session waiting on the asks still open", () => {
    expect(
      sessionEventsOnly(
        update(P.RUN_IN_PROGRESS, P.RUN_COMPLETED),
        session(0, waitingOn("run_0.x"), { othersWaiting: ["run_0"], gates: [ask("run_0", "run_0.x", 3)] }),
      ),
    ).toEqual([]);
  });
});

describe("a log that drifted is put right by the next write in its session", () => {
  it("a session that reads idle while a run works reads running after any write of a working run", () => {
    expect(
      sessionEventsOnly(update(P.RUN_IN_PROGRESS, P.RUN_IN_PROGRESS), session(0, IDLE)).map(eventTypeOf),
    ).toEqual(["session.status_running"]);
    expect(
      sessionEventsOnly({ kind: "create", run: run(P.RUN_PENDING) }, session(1, IDLE)).map(eventTypeOf),
    ).toEqual(["user.message", "session.status_running"]);
  });

  it("a session that reads running while nothing works reads idle after the next write", () => {
    expect(
      sessionEventsOnly(update(P.RUN_COMPLETED, P.RUN_COMPLETED), session(0, RUNNING)).map(eventTypeOf),
    ).toEqual(["session.status_idle"]);
  });

  it("a state already stated is not stated again, and an idle is never re-stated over another idle", () => {
    expect(sessionEventsOnly(update(P.RUN_PENDING, P.RUN_IN_PROGRESS), session(0, RUNNING))).toEqual([]);
    expect(
      sessionEventsOnly(
        update(P.RUN_COMPLETED, P.RUN_COMPLETED),
        session(0, { type: "idle", reason: "retries_exhausted", eventIds: [] }),
      ),
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

  it("only a status event states a status", () => {
    expect(sessionStatusOf(eventsFor({ kind: "create", run: run(P.RUN_PENDING) })[0]!)).toBeUndefined();
  });

  it("a run's session is its session_id target; a run in none has none", () => {
    expect(sessionIdOfRun(run(P.RUN_PENDING))).toBe("ses_1");
    expect(sessionIdOfRun(create(RunSchema, {}))).toBe("");
  });
});
