/**
 * Working time: how long an agent worked on a session, by the run whose
 * start began each stretch of work. The usage reports read it beside
 * tokens, in every edition.
 *
 * "Working" is decided in one place, transitions.ts beside this file: the
 * server appends `session.status_running` when a session starts working
 * and `session.status_idle` when it stops, only on a change, each stamped
 * with the id of the run whose write caused it, in the transaction of that
 * write. A turn waiting on a person's answer is idle, so a wait is never
 * working. This module only pairs what the log already says: a running
 * event with the next idle event, the stretch's milliseconds (between the
 * two events' accepted times) credited to the running event's run. The
 * store numbers and stamps a session's events under its write
 * serialization, so a session's stretches never overlap and each belongs
 * to exactly one run. A stretch still open is counted up to `now`.
 *
 * Crediting the opening run keeps every report's one rule ("a run created
 * in the window counts wholly", domain/run/usage.ts) for time as for
 * tokens. A run's figure is the stretches it started: when a second run
 * works in a session that is already working, its work is in the first
 * run's stretch.
 *
 * Proven by __tests__/working-time.test.ts.
 */
import type { Store } from "../../../store/interface.js";
import type { SessionEventRecord } from "../../../store/session-events.js";
import { SESSION_STATUS_TYPES } from "./catalog.js";
import { readRecords } from "./run-events.js";

const RUNNING_EVENT_TYPE = "session.status_running";
const IDLE_EVENT_TYPE = "session.status_idle";

/**
 * Each run's working milliseconds in one session's status events, oldest
 * first; a run that started no stretch is absent. A running event while a
 * stretch is open, or an idle event while none is, changes nothing, and a
 * stretch whose end precedes its start (a clock step) counts zero.
 */
export function workingMillisByRun(
  records: ReadonlyArray<SessionEventRecord>,
  now: Date,
): Map<string, number> {
  const byRun = new Map<string, number>();
  let open: { readonly runId: string; readonly startMs: number } | undefined;
  const credit = (runId: string, startMs: number, endMs: number): void => {
    byRun.set(runId, (byRun.get(runId) ?? 0) + Math.max(0, endMs - startMs));
  };
  for (const record of records) {
    if (record.type === RUNNING_EVENT_TYPE && open === undefined) {
      open = { runId: record.runId, startMs: Date.parse(record.processedAt) };
    } else if (record.type === IDLE_EVENT_TYPE && open !== undefined) {
      credit(open.runId, open.startMs, Date.parse(record.processedAt));
      open = undefined;
    }
  }
  if (open !== undefined) {
    credit(open.runId, open.startMs, now.getTime());
  }
  return byRun;
}

/**
 * Each run's working milliseconds across `sessionIds`: one typed read of
 * each distinct session's status events. Run ids are unique across
 * sessions, so the maps merge without collision.
 */
export async function workingMillisOfSessions(
  store: Store,
  sessionIds: Iterable<string>,
  now: Date,
): Promise<Map<string, number>> {
  const byRun = new Map<string, number>();
  for (const sessionId of new Set(sessionIds)) {
    if (sessionId === "") {
      continue;
    }
    const records = await readRecords(store, sessionId, {
      types: SESSION_STATUS_TYPES,
    });
    for (const [runId, millis] of workingMillisByRun(records, now)) {
      byRun.set(runId, (byRun.get(runId) ?? 0) + millis);
    }
  }
  return byRun;
}
