/**
 * What the server writes into a session's log when one of its runs is
 * created, changes phase, or is removed: the turn's user message, and the
 * session's status.
 *
 * A status event says what the whole session is doing, never one run. A
 * session can have more than one turn unfinished at once (a channel user
 * who sends two messages quickly has two runs, the second queued behind
 * the first's workspace lock), and Managed Agents has one status per
 * session. So each write computes the session's status from what the
 * store reads under the session's lock (store/session-events.ts) and
 * writes it when it differs from the newest status event:
 *
 *   running ........ this run works (pending or in progress,
 *                    run/phases.ts `isWorkingPhase`), another does
 *                    (`othersWorking`), or a waiting run has no open ask
 *                    left: its answers are in and it is about to resume
 *                    (Managed Agents: "resolving all of them transitions
 *                    the session back to running")
 *   idle requires_action
 *                    otherwise, while a waiting run has open asks
 *                    (`gates`): event_ids names every open ask of every
 *                    waiting run, in log order. Answering some of several
 *                    re-states the idle with the remainder.
 *   idle ........... otherwise: end_turn; retries_exhausted when this run
 *                    just FAILED; budget_reached when it just stopped on
 *                    its budget (the cost cap or the tool-call limit)
 *
 * "Differs" compares the type, and for requires_action the event ids;
 * another idle is never re-written over an idle, so a finished turn's
 * later write cannot turn a retries_exhausted into an end_turn. Comparing
 * states rather than reacting to one run's transition also repairs a log
 * that drifted: runs that were working when the log was introduced, or a
 * phase an older binary wrote during a roll, are put right by the next
 * write in their session.
 *
 * The turn's own phase. Every phase change of a run, its creation
 * included, also appends `stigmer.run.status` for that run, with the
 * phase as a word (`runPhaseWordOf`) and, once the turn has ended, its
 * stop cause and error. The session's status cannot say that one turn
 * ended while another works or waits in the queue; this event does, and
 * it is the end of the turn `sendAndWait` and the consoles read. A
 * removed run writes none: its own events go with it.
 *
 * The open asks are the session's gates (domain/session/events/gates.ts):
 * an ask opens one, its answer or its result closes it. The events the
 * write itself appends count: an answer it records has closed its ask
 * before the status is computed (run-writes.ts hands the fold the gates
 * that remain).
 *
 *   created .................. user.message (none for a reconcile turn,
 *                              `spec.reconcile_file_review`, which has no
 *                              message); stigmer.run.status; then the
 *                              session's status
 *   this run just FAILED ..... session.error (terminal) first, whether or
 *   (from working or waiting)  not others still work: model_request_failed_
 *                              error when the model provider failed the
 *                              turn, unknown_error otherwise
 *   phase changed ............ stigmer.run.status, after any
 *                              session.error and before the session's
 *                              status
 *   removed .................. as stopping
 *
 * The cause is the run's `stop_cause`, written with its terminal status
 * by the runner's terminal table, the workflow or a stop
 * (RunStatus.stop_cause), never matched from its error text. PAUSED, and
 * TERMINATED for any other cause, end the turn as end_turn: a Stigmer
 * client reads the pause and the precise cause from the run.
 * session.status_terminated is never written: in Managed Agents it is a
 * session that can no longer be used, and a Stigmer conversation always
 * takes another message.
 *
 * Proven by __tests__/transitions.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";

import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import {
  SessionEventSchema,
  type SessionEvent,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import { generateId } from "../../../pipeline/steps/defaults.js";
import type { OpenSessionEventGate } from "../../../store/session-events.js";
import { isTerminalExecutionPhase, isWaitingPhase, isWorkingPhase } from "../../run/phases.js";
import { SESSION_EVENT_ID_PREFIX } from "./catalog.js";

/** What happened to the run. */
export type RunTransition =
  | { readonly kind: "create"; readonly run: Run }
  | { readonly kind: "update"; readonly previousPhase: RunPhase; readonly run: Run }
  | { readonly kind: "remove"; readonly previousPhase: RunPhase; readonly runId: string };

/** The run's session id; "" for a run in none. */
export function sessionIdOfRun(run: Run): string {
  return run.spec?.target.case === "sessionId" ? run.spec.target.value : "";
}

/** The session's status as its newest status event states it; undefined when it has none (reads idle). */
export type SessionStatusNow =
  | { readonly type: "running" }
  | { readonly type: "idle"; readonly reason: string; readonly eventIds: ReadonlyArray<string> };

/** The session as committed, read under its lock, with the write's own answers applied. */
export interface SessionNow {
  /** The session's other runs that work (pending or in progress). */
  readonly othersWorking: number;
  /** The session's other runs that wait for a person's answer. */
  readonly othersWaiting: ReadonlyArray<string>;
  /** The open asks of the waiting runs and of this run, in log order. */
  readonly gates: ReadonlyArray<OpenSessionEventGate>;
  /** The newest status event; undefined when there is none. */
  readonly status: SessionStatusNow | undefined;
}

/**
 * A run phase as `stigmer.run.status` says it; undefined for
 * RUN_PHASE_UNSPECIFIED and for a value this binary does not know.
 */
export function runPhaseWordOf(phase: RunPhase): string | undefined {
  switch (phase) {
    case RunPhase.RUN_PENDING:
      return "pending";
    case RunPhase.RUN_IN_PROGRESS:
      return "running";
    case RunPhase.RUN_WAITING_FOR_APPROVAL:
      return "waiting";
    case RunPhase.RUN_PAUSED:
      return "paused";
    case RunPhase.RUN_COMPLETED:
      return "completed";
    case RunPhase.RUN_FAILED:
      return "failed";
    case RunPhase.RUN_CANCELLED:
      return "cancelled";
    case RunPhase.RUN_TERMINATED:
      return "terminated";
    default:
      return undefined;
  }
}

/** The status a session event states; undefined for any other event. */
export function sessionStatusOf(event: SessionEvent): SessionStatusNow | undefined {
  switch (event.event.case) {
    case "sessionStatusRunning":
      return { type: "running" };
    case "sessionStatusIdle":
      return {
        type: "idle",
        reason: event.event.value.stopReason?.type ?? "",
        eventIds: event.event.value.stopReason?.eventIds ?? [],
      };
    default:
      return undefined;
  }
}

/**
 * The events a run transition appends, in order, given the session as
 * committed (module header).
 */
export function sessionEventsForTransition(
  transition: RunTransition,
  session: SessionNow,
): SessionEvent[] {
  const runId =
    transition.kind === "remove" ? transition.runId : (transition.run.metadata?.id ?? "");
  const event = (value: MessageInitShape<typeof SessionEventSchema>["event"]): SessionEvent =>
    create(SessionEventSchema, { runId, event: value });
  const id = (): string => generateId(SESSION_EVENT_ID_PREFIX);

  const events: SessionEvent[] = [];
  // A reconcile turn carries no message: the person's act is the decided
  // event before it, and the conversation's newest turn stays the one
  // whose files are reviewed.
  if (transition.kind === "create" && transition.run.spec?.reconcileFileReview !== true) {
    events.push(
      event({
        case: "userMessage",
        value: {
          id: id(),
          // The text, then the files the message carried, as the server
          // recorded them when the run was created (domain/file/message-files.ts).
          content: [
            { type: "text", text: transition.run.spec?.message ?? "" },
            ...(transition.run.status?.messageFiles ?? []),
          ],
        },
      }),
    );
  }

  const wasActive =
    transition.kind !== "create" &&
    (isWorkingPhase(transition.previousPhase) || isWaitingPhase(transition.previousPhase));
  const nextPhase =
    transition.kind === "remove"
      ? RunPhase.RUN_PHASE_UNSPECIFIED
      : (transition.run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED);
  const isWorking = isWorkingPhase(nextPhase);
  const isWaiting = isWaitingPhase(nextPhase);
  const failed = wasActive && nextPhase === RunPhase.RUN_FAILED;
  const stopCause = transition.kind === "remove" ? "" : (transition.run.status?.stopCause ?? "");
  if (failed && transition.kind !== "remove") {
    events.push(
      event({
        case: "sessionError",
        value: {
          id: id(),
          error: {
            type: stopCause === "model_error" ? "model_request_failed_error" : "unknown_error",
            message: transition.run.status?.error ?? "",
            retryStatus: { type: "terminal" },
          },
        },
      }),
    );
  }
  const previousPhase =
    transition.kind === "update" ? transition.previousPhase : RunPhase.RUN_PHASE_UNSPECIFIED;
  const phaseWord = runPhaseWordOf(nextPhase);
  if (transition.kind !== "remove" && phaseWord !== undefined && nextPhase !== previousPhase) {
    const ended = isTerminalExecutionPhase(nextPhase);
    events.push(
      event({
        case: "stigmerRunStatus",
        value: {
          id: id(),
          phase: phaseWord,
          stopCause: ended ? stopCause : "",
          error: ended ? (transition.run.status?.error ?? "") : "",
        },
      }),
    );
  }

  const stopped = wasActive && !isWorking && !isWaiting;
  const idleReason = failed
    ? "retries_exhausted"
    : stopped && stopCause === "budget_reached"
      ? "budget_reached"
      : "end_turn";

  const waitingRuns = new Set(session.othersWaiting);
  if (isWaiting) {
    waitingRuns.add(runId);
  }
  const open = session.gates.filter((gate) => waitingRuns.has(gate.runId));
  const withOpenAsks = new Set(open.map((gate) => gate.runId));
  const resuming = [...waitingRuns].some((waiting) => !withOpenAsks.has(waiting));
  const sessionWorks = isWorking || session.othersWorking > 0 || resuming;

  const now = session.status;
  if (sessionWorks) {
    if (now?.type !== "running") {
      events.push(event({ case: "sessionStatusRunning", value: { id: id() } }));
    }
  } else if (open.length > 0) {
    const eventIds = open.map((gate) => gate.toolUseId);
    const stated =
      now?.type === "idle" &&
      now.reason === "requires_action" &&
      now.eventIds.length === eventIds.length &&
      now.eventIds.every((value, index) => value === eventIds[index]);
    if (!stated) {
      events.push(
        event({
          case: "sessionStatusIdle",
          value: { id: id(), stopReason: { type: "requires_action", eventIds } },
        }),
      );
    }
  } else if (now?.type === "running" || (now?.type === "idle" && now.reason === "requires_action")) {
    events.push(
      event({
        case: "sessionStatusIdle",
        value: { id: id(), stopReason: { type: idleReason } },
      }),
    );
  }
  return events;
}
