/**
 * Every run write that can change whether a run is working: through here,
 * so the session's events commit with the run (store/session-events.ts)
 * and reach its live streams after the commit.
 *
 * The sites (run/status-observers.ts lists the phase writes; creation and
 * deletion are the other two):
 *
 *   create ............ the run chain's Persist step (createRunAppendingEvents)
 *   update ............ a row-locked change: updateStatus' merge, the
 *                       lifecycle transition, an answer, a file decision,
 *                       the next turn's close of the previous turn's file
 *                       review (updateRunAppendingEvents)
 *   overwrite ......... the two writes that save a copy held in memory:
 *                       the start failure, and the stale reconcile
 *                       (overwriteRunAppendingEvents). Their overwrite is
 *                       kept, but their events are computed from the
 *                       committed row, never the copy, which may be stale.
 *   remove ............ the run chain's DeleteResource step
 *                       (removeRunAppendingEvents). A removed run's own
 *                       events go with it; its status events stay, because
 *                       they describe the session, and a working run's
 *                       removal ends the session's turn when nothing else
 *                       works, so the session never reads running forever.
 *
 * A run's session, the count of its session's other working runs, its
 * other waiting runs and its other paused runs come from the run list
 * index's `session`, `working_session`, `waiting_session` and
 * `paused_session` keys (run/list-index.ts), read
 * under the session's lock without decoding a run; the open asks of the
 * waiting runs and of the written run come from the log's gate columns
 * (gates.ts). An update may append events of its own: those that answer
 * an ask (../hitl/answer.ts) come first, and the asks they close are
 * closed before the status is computed; the file-review decisions it
 * records (`stigmer.file_review.decided`, run/filereview/decided.ts) come
 * last, after the transition's events. An update that must know the
 * conversation's newest turn asks for the run of the session's newest
 * `user.message` (`runOfNewestType`), and an update that decides from
 * what the run's log says (a file-review decision, a policy keep) asks
 * for the run's events of the types it reads (`runEventTypes`); only an
 * update that asks pays either read.
 *
 * One turn at a time. A create refuses, under the session's lock, a run
 * in a session whose other runs are unfinished (working, waiting or
 * paused), or whose queue holds messages it does not start from: a turn
 * that takes no queued message while any waits, or one whose first is
 * not the oldest waiting (SESSION_TURN_UNFINISHED, run/constants.ts; the
 * queue's turn takes the oldest messages sent with one authority, and
 * those behind them wait, run/queued-turn.ts): a message for a working
 * session waits in its queue (run/send-message.ts) and never races it
 * (stigmer#2429). A reconcile turn (spec.reconcile_file_review) is not a
 * message's turn and is never refused: it runs no model and only puts
 * back files a person undid, and each undo needs its own, even while an
 * earlier one runs (that one may have read what is owed already;
 * ../filereview/decide.ts). A turn started from the queue
 * (spec.queued_message_ids) takes those messages in its write: each must
 * still wait, and the turn's own events list them, moved to the head as
 * its own. A write that takes queued messages for a working run (the
 * runner's claim, ../claim-input.ts) does the same without a transition.
 *
 * Proven by __tests__/run-writes.test.ts on both drivers, and end to end by
 * the session-events conformance suite.
 */
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { failedPreconditionError } from "../../../pipeline/errors.js";
import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import type {
  OpenSessionEventGate,
  ResourceEventWriteResult,
  ResourceEventWriter,
  SessionEventContext,
  SessionEventDraft,
  SessionEventScope,
} from "../../../store/session-events.js";
import {
  QUEUED_MESSAGE_GONE_REASON,
  SESSION_TURN_UNFINISHED_REASON,
  queuedMessageGoneMessage,
  sessionQueueWaitsMessage,
  sessionTurnUnfinishedMessage,
} from "../../run/constants.js";
import { agentExecutionListIndex } from "../../run/list-index.js";
import type { SessionEventBroker } from "./broker.js";
import { SESSION_STATUS_TYPES } from "./catalog.js";
import { draftOf, eventOf } from "./codec.js";
import { gatesOfEvent } from "./gates.js";
import { sessionEventsForTransition, sessionIdOfRun, sessionStatusOf } from "./transitions.js";
import type { RunTransition } from "./transitions.js";

/** What a run write that appends session events needs. */
export interface RunEventWriteDeps {
  readonly store: Store;
  readonly sessionEventBroker: SessionEventBroker;
}

type RunListKey = keyof typeof agentExecutionListIndex.keys;
const SESSION_KEY: RunListKey = "session";
const WORKING_KEY: RunListKey = "working_session";
const WAITING_KEY: RunListKey = "waiting_session";
const PAUSED_KEY: RunListKey = "paused_session";

/** What an update may ask the store for beyond what every write is handed. */
export interface RunUpdateOptions {
  /**
   * An event type whose newest event's run `modify` is handed
   * (`SessionEventContext.runOfNewestType`): "user.message" names the
   * conversation's newest turn.
   */
  readonly runOfNewestType?: string;
  /**
   * Event types of the run's own `modify` is handed, read under the
   * session's lock (`SessionEventContext.runEvents`): a write that decides
   * from what the run's log says (filereview/logged.ts) reads it there.
   */
  readonly runEventTypes?: ReadonlyArray<string>;
  /** `modify` is handed the session's queue (`SessionEventContext.queued`). */
  readonly queued?: boolean;
}

function scopeOf(sessionId?: string, options: RunUpdateOptions = {}): SessionEventScope {
  return {
    sessionKey: SESSION_KEY,
    workingKey: WORKING_KEY,
    waitingKey: WAITING_KEY,
    pausedKey: PAUSED_KEY,
    stateEventTypes: SESSION_STATUS_TYPES,
    ...(options.queued === true ? { queued: true } : {}),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(options.runOfNewestType === undefined ? {} : { runOfNewestType: options.runOfNewestType }),
    ...(options.runEventTypes === undefined ? {} : { runEventTypes: options.runEventTypes }),
  };
}

function phaseOf(run: Run): RunPhase {
  return run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
}

/**
 * The session's open asks once `appending` is in the log: the context's
 * gates less those the write's own events close (an event closes only its
 * own run's ask).
 */
export function gatesAfter(
  session: SessionEventContext,
  appending: ReadonlyArray<SessionEvent> = [],
): OpenSessionEventGate[] {
  const closing = new Set(
    appending
      .map((event) => ({ runId: event.runId, closes: gatesOfEvent(event).closes }))
      .filter((c) => c.closes !== "")
      .map((c) => `${c.runId}\u0000${c.closes}`),
  );
  return session.gates.filter((gate) => !closing.has(`${gate.runId}\u0000${gate.toolUseId}`));
}

/** The open asks of one run, by tool use id, once `appending` is in the log. */
export function openAsksOf(
  session: SessionEventContext,
  runId: string,
  appending: ReadonlyArray<SessionEvent> = [],
): ReadonlySet<string> {
  return new Set(gatesAfter(session, appending).filter((gate) => gate.runId === runId).map((gate) => gate.toolUseId));
}

/**
 * A transition's events as store drafts, after the write's own events;
 * none for a run in no session, which has no log.
 */
function draftsFor(
  transition: RunTransition,
  session: SessionEventContext,
  sessionRow: Run | undefined,
  own: ReadonlyArray<SessionEvent> = [],
): SessionEventDraft[] {
  if (sessionRow === undefined || sessionIdOfRun(sessionRow) === "") {
    return [];
  }
  const latest = session.latestState === undefined ? undefined : sessionStatusOf(eventOf(session.latestState));
  return [
    ...own,
    ...sessionEventsForTransition(transition, {
      othersWorking: session.othersWorking,
      othersWaiting: session.othersWaiting,
      gates: gatesAfter(session, own),
      status: latest,
      othersPaused: session.othersPaused,
      queuedCount: session.queuedCount,
    }),
  ].map(draftOf);
}

/** The run create chain's Persist writer (pipeline/steps/persist.ts). */
export function runCreateWriter(deps: RunEventWriteDeps): (run: Run) => Promise<void> {
  return (run) => createRunAppendingEvents(deps, run);
}

/** The run delete chain's DeleteResource remover (pipeline/steps/delete.ts). */
export function runRemover(deps: RunEventWriteDeps): (runId: string) => Promise<void> {
  return (runId) => removeRunAppendingEvents(deps, runId);
}

/**
 * Persists a new run with its user message (or the queued messages it
 * takes) and, when it starts the session's work, the running status;
 * refuses a run its session's unfinished work or queue holds off (module
 * header).
 */
export async function createRunAppendingEvents(deps: RunEventWriteDeps, run: Run): Promise<void> {
  const runId = run.metadata?.id ?? "";
  const sessionId = sessionIdOfRun(run);
  const takes = run.spec?.queuedMessageIds ?? [];
  await write(
    deps,
    runId,
    (_previous, others) => {
      if (run.spec?.reconcileFileReview !== true) {
        refuseUnlessFree(sessionId, others, takes);
      }
      const taken = takenOf(sessionId, others, takes);
      const transition: RunTransition = {
        kind: "create",
        run,
        ...(taken === undefined ? {} : { taken }),
      };
      return {
        put: run,
        events: draftsFor(transition, others, run),
        ...(takes.length === 0 ? {} : { takeQueued: takes }),
      };
    },
    sessionId,
    takes.length === 0 ? {} : { queued: true },
  );
}

/** Refuses a new turn while another of its session is unfinished, or older messages than it takes wait. */
function refuseUnlessFree(
  sessionId: string,
  session: SessionEventContext,
  takes: ReadonlyArray<string>,
): void {
  if (sessionId === "") {
    return;
  }
  if (session.othersWorking > 0 || session.othersWaiting.length > 0 || session.othersPaused.length > 0) {
    throw failedPreconditionError(sessionTurnUnfinishedMessage(sessionId), {
      reason: SESSION_TURN_UNFINISHED_REASON,
      metadata: { session_id: sessionId },
    });
  }
  // A turn whose messages are all gone is refused by takenOf, naming one.
  const oldest = session.queued[0]?.record.eventId;
  const startsTheQueue = takes.length === 0 ? session.queuedCount === 0 : oldest === undefined || oldest === takes[0];
  if (!startsTheQueue) {
    throw failedPreconditionError(sessionQueueWaitsMessage(sessionId), {
      reason: SESSION_TURN_UNFINISHED_REASON,
      metadata: { session_id: sessionId },
    });
  }
}

/**
 * The queued messages a turn takes, from the queue it is handed, in the
 * order sent; undefined for a turn that takes none. Each must still wait.
 */
function takenOf(
  sessionId: string,
  session: SessionEventContext,
  takes: ReadonlyArray<string>,
): SessionEvent[] | undefined {
  if (takes.length === 0) {
    return undefined;
  }
  const waiting = new Map(session.queued.map((queued) => [queued.record.eventId, queued.record]));
  for (const eventId of takes) {
    if (!waiting.has(eventId)) {
      throw failedPreconditionError(queuedMessageGoneMessage(sessionId, eventId), {
        reason: QUEUED_MESSAGE_GONE_REASON,
        metadata: { session_id: sessionId, event_id: eventId },
      });
    }
  }
  return session.queued
    .filter((queued) => takes.includes(queued.record.eventId))
    .map((queued) => eventOf(queued.record));
}

/**
 * The events a row-locked change appends of its own (module header):
 * `first` before the transition's events (an answer, whose asks are closed
 * before the status is computed), `last` after them (the decisions it
 * records).
 */
export interface RunUpdateEvents {
  readonly first?: ReadonlyArray<SessionEvent>;
  readonly last?: ReadonlyArray<SessionEvent>;
  /**
   * Queued messages the change takes, by id (the options must ask for the
   * queue): `last` carries them again as the run's (store/session-events.ts,
   * "The queue").
   */
  readonly takeQueued?: ReadonlyArray<string>;
}

/**
 * A row-locked change: `modify` mutates the committed run in place, as
 * Store.updateResource's does, and must be synchronous; it is handed the
 * session as committed (with the run of `options.runOfNewestType` when
 * asked), and throwing writes nothing. It may return events of its own
 * (`RunUpdateEvents`; a bare list is `first`). The transition's events
 * commit with the run. Throws ResourceNotFoundError when the run is
 * absent.
 */
export async function updateRunAppendingEvents(
  deps: RunEventWriteDeps,
  runId: string,
  modify: (run: Run, session: SessionEventContext) => ReadonlyArray<SessionEvent> | RunUpdateEvents | void,
  options: RunUpdateOptions = {},
): Promise<{
  readonly run: Run;
  readonly previousPhase: RunPhase;
  readonly events: ReadonlyArray<SessionEvent>;
}> {
  let previousPhase = RunPhase.RUN_PHASE_UNSPECIFIED;
  const result = await write(
    deps,
    runId,
    (previous, others) => {
      if (previous === undefined) {
        throw new ResourceNotFoundError(`run/${runId}`);
      }
      previousPhase = phaseOf(previous);
      const own = ownEventsOf(modify(previous, others));
      const transition: RunTransition = { kind: "update", previousPhase, run: previous };
      return {
        put: previous,
        events: [
          ...draftsFor(transition, others, previous, own.first ?? []),
          ...(sessionIdOfRun(previous) === "" ? [] : (own.last ?? []).map(draftOf)),
        ],
        ...(own.takeQueued === undefined || own.takeQueued.length === 0 ? {} : { takeQueued: own.takeQueued }),
      };
    },
    undefined,
    options,
  );
  return { run: result.row!, previousPhase, events: result.events.map(eventOf) };
}

/**
 * Saves a copy of the run held in memory over the stored row, as the
 * blind writes always did, with its events computed from the committed
 * row. Throws ResourceNotFoundError when the run is no longer stored: a
 * deleted run is not written back.
 */
export async function overwriteRunAppendingEvents(
  deps: RunEventWriteDeps,
  run: Run,
): Promise<{ readonly previousPhase: RunPhase }> {
  const runId = run.metadata?.id ?? "";
  let previousPhase = RunPhase.RUN_PHASE_UNSPECIFIED;
  await write(
    deps,
    runId,
    (previous, others) => {
      if (previous === undefined) {
        throw new ResourceNotFoundError(`run/${runId}`);
      }
      previousPhase = phaseOf(previous);
      const transition: RunTransition = { kind: "update", previousPhase, run };
      return { put: run, events: draftsFor(transition, others, run) };
    },
    sessionIdOfRun(run),
  );
  return { previousPhase };
}

/** Removes a run with its own events, ending its session's turn when it was the last working run. No error when absent. */
export async function removeRunAppendingEvents(deps: RunEventWriteDeps, runId: string): Promise<void> {
  try {
    await write(deps, runId, (previous, others) => {
      const transition: RunTransition = {
        kind: "remove",
        previousPhase: previous === undefined ? RunPhase.RUN_PHASE_UNSPECIFIED : phaseOf(previous),
        runId,
      };
      return {
        remove: { keepEventTypes: SESSION_STATUS_TYPES },
        events: draftsFor(transition, others, previous),
      };
    });
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return;
    }
    throw error;
  }
}

/** A change's own events, as `RunUpdateEvents`. */
function ownEventsOf(own: ReadonlyArray<SessionEvent> | RunUpdateEvents | void): RunUpdateEvents {
  if (own === undefined) {
    return {};
  }
  return isEventList(own) ? { first: own } : own;
}

function isEventList(own: ReadonlyArray<SessionEvent> | RunUpdateEvents): own is ReadonlyArray<SessionEvent> {
  return Array.isArray(own);
}

async function write(
  deps: RunEventWriteDeps,
  runId: string,
  writer: ResourceEventWriter<typeof RunSchema>,
  sessionId?: string,
  options?: RunUpdateOptions,
): Promise<ResourceEventWriteResult<typeof RunSchema>> {
  const result = await deps.store.writeResourceAppendingEvents(
    ApiResourceKind.run,
    runId,
    RunSchema,
    writer,
    scopeOf(sessionId, options),
  );
  const first = result.events[0];
  if (first !== undefined) {
    deps.sessionEventBroker.publish(first.sessionId, result.events.map(eventOf));
  }
  return result;
}
