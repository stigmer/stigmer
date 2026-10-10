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
 *                       lifecycle transition (updateRunAppendingEvents)
 *   overwrite ......... the three writes that save a copy held in memory:
 *                       the start failure, and the two stale reconciles
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
 * A run's session and the count of its session's other working runs come
 * from the run list index's `session` and `working_session` keys
 * (run/list-index.ts), read under the session's lock without decoding a
 * run.
 *
 * Proven by __tests__/run-writes.test.ts on both drivers, and end to end by
 * the session-events conformance suite.
 */
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { ResourceNotFoundError } from "../../../store/interface.js";
import type { Store } from "../../../store/interface.js";
import type {
  ResourceEventWriteResult,
  ResourceEventWriter,
  SessionEventDraft,
  SessionEventScope,
} from "../../../store/session-events.js";
import { agentExecutionListIndex } from "../../run/list-index.js";
import type { SessionEventBroker } from "./broker.js";
import { SESSION_STATUS_TYPES } from "./catalog.js";
import { draftOf, eventOf } from "./codec.js";
import { sessionEventsForTransition, sessionIdOfRun } from "./transitions.js";
import type { RunTransition } from "./transitions.js";

/** What a run write that appends session events needs. */
export interface RunEventWriteDeps {
  readonly store: Store;
  readonly sessionEventBroker: SessionEventBroker;
}

type RunListKey = keyof typeof agentExecutionListIndex.keys;
const SESSION_KEY: RunListKey = "session";
const WORKING_KEY: RunListKey = "working_session";

function scopeOf(sessionId?: string): SessionEventScope {
  return {
    sessionKey: SESSION_KEY,
    workingKey: WORKING_KEY,
    ...(sessionId === undefined ? {} : { sessionId }),
  };
}

function phaseOf(run: Run): RunPhase {
  return run.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED;
}

/** A transition's events as store drafts; none for a run in no session, which has no log. */
function draftsFor(
  transition: RunTransition,
  others: number,
  sessionRow: Run | undefined,
): SessionEventDraft[] {
  if (sessionRow === undefined || sessionIdOfRun(sessionRow) === "") {
    return [];
  }
  return sessionEventsForTransition(transition, others).map(draftOf);
}

/** Persists a new run with its user message and, when it starts the session's work, the running status. */
export async function createRunAppendingEvents(deps: RunEventWriteDeps, run: Run): Promise<void> {
  const runId = run.metadata?.id ?? "";
  await write(
    deps,
    runId,
    (_previous, others) => {
      const transition: RunTransition = { kind: "create", run };
      return { put: run, events: draftsFor(transition, others, run) };
    },
    sessionIdOfRun(run),
  );
}

/**
 * A row-locked change: `modify` mutates the committed run in place, as
 * Store.updateResource's does, and must be synchronous. Throws
 * ResourceNotFoundError when the run is absent.
 */
export async function updateRunAppendingEvents(
  deps: RunEventWriteDeps,
  runId: string,
  modify: (run: Run) => void,
): Promise<{ readonly run: Run; readonly previousPhase: RunPhase }> {
  let previousPhase = RunPhase.RUN_PHASE_UNSPECIFIED;
  const result = await write(deps, runId, (previous, others) => {
    if (previous === undefined) {
      throw new ResourceNotFoundError(`run/${runId}`);
    }
    previousPhase = phaseOf(previous);
    modify(previous);
    const transition: RunTransition = { kind: "update", previousPhase, run: previous };
    return { put: previous, events: draftsFor(transition, others, previous) };
  });
  return { run: result.row!, previousPhase };
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

async function write(
  deps: RunEventWriteDeps,
  runId: string,
  writer: ResourceEventWriter<typeof RunSchema>,
  sessionId?: string,
): Promise<ResourceEventWriteResult<typeof RunSchema>> {
  const result = await deps.store.writeResourceAppendingEvents(
    ApiResourceKind.run,
    runId,
    RunSchema,
    writer,
    scopeOf(sessionId),
  );
  const first = result.events[0];
  if (first !== undefined) {
    deps.sessionEventBroker.publish(first.sessionId, result.events.map(eventOf));
  }
  return result;
}
