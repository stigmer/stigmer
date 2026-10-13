/**
 * The server's own reads of one turn's facts from its session's log: what
 * the scoring readers (domain/score: the checks' actions, the judge's
 * subject, a plugin eval's trace), the vote and verdict readers and the
 * usage report read, in place of the run's transcript rows.
 *
 * Every read is indexed: a run's events by the (session_id, run_id, seq)
 * index, one type by (session_id, type, seq). A run's whole log is read in
 * pages of RUN_EVENTS_PAGE_SIZE, oldest first, until a short page; the
 * readers fold it with `@stigmer/session-log`, the fold every client uses,
 * so a turn reads the same to the server as to a person.
 *
 * A run with no session has no log, and reads as no events.
 *
 * Proven by __tests__/run-events.test.ts.
 */
import type { JsonObject } from "@bufbuild/protobuf";

import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { SessionEvent } from "@stigmer/protos/ai/stigmer/agentic/session/v1/event_pb";

import type { Store } from "../../../store/interface.js";
import type { SessionEventRecord } from "../../../store/session-events.js";
import { sessionIdOf } from "../../run/target.js";
import { eventOf } from "./codec.js";

/** One page of a full read: the store contract's own largest test page, well under any driver's bound. */
export const RUN_EVENTS_PAGE_SIZE = 1000;

/** The type of a turn's structured answer. */
export const STRUCTURED_OUTPUT_EVENT_TYPE = "stigmer.agent.structured_output";

/** The type that opens a sub-agent's thread, once per thread. */
export const THREAD_CREATED_EVENT_TYPE = "session.thread_created";

/** One run with its own events, in log order. */
export interface RunTranscript {
  readonly run: Run;
  readonly events: ReadonlyArray<SessionEvent>;
}

/** What narrows a full read: one run, some types, or both. */
export interface SessionEventFilter {
  readonly runId?: string;
  readonly types?: ReadonlyArray<string>;
}

/** Every event of a session matching `filter`, oldest first, read page by page. */
export async function readSessionEvents(
  store: Store,
  sessionId: string,
  filter: SessionEventFilter,
): Promise<SessionEvent[]> {
  return (await readRecords(store, sessionId, filter)).map(eventOf);
}

/** The stored records a full read returns, undecoded. */
async function readRecords(
  store: Store,
  sessionId: string,
  filter: SessionEventFilter,
): Promise<SessionEventRecord[]> {
  const records: SessionEventRecord[] = [];
  let afterSeq: number | undefined;
  for (;;) {
    const page = await store.sessionEvents.list(sessionId, {
      order: "asc",
      limit: RUN_EVENTS_PAGE_SIZE,
      ...(afterSeq === undefined ? {} : { afterSeq }),
      ...(filter.runId === undefined ? {} : { runId: filter.runId }),
      ...(filter.types === undefined ? {} : { types: filter.types }),
    });
    records.push(...page);
    const last = page.at(-1);
    if (last === undefined || page.length < RUN_EVENTS_PAGE_SIZE) {
      return records;
    }
    afterSeq = last.seq;
  }
}

/** The run's own events (of `types` only, when given), oldest first; none for a run with no session. */
export async function runEventsOf(
  store: Store,
  run: Run,
  types?: ReadonlyArray<string>,
): Promise<SessionEvent[]> {
  const sessionId = sessionIdOf(run.spec);
  const runId = run.metadata?.id ?? "";
  if (sessionId === "" || runId === "") {
    return [];
  }
  return readSessionEvents(store, sessionId, {
    runId,
    ...(types === undefined ? {} : { types }),
  });
}

/** The run with its own events. */
export async function runTranscriptOf(
  store: Store,
  run: Run,
): Promise<RunTranscript> {
  return { run, events: await runEventsOf(store, run) };
}

/**
 * The structured answer the run delivered: its newest
 * `stigmer.agent.structured_output` event's output, read alone; undefined
 * when it delivered none.
 */
export async function structuredOutputOf(
  store: Store,
  run: Run,
): Promise<JsonObject | undefined> {
  const sessionId = sessionIdOf(run.spec);
  const runId = run.metadata?.id ?? "";
  if (sessionId === "" || runId === "") {
    return undefined;
  }
  const [newest] = await store.sessionEvents.list(sessionId, {
    order: "desc",
    runId,
    types: [STRUCTURED_OUTPUT_EVENT_TYPE],
    limit: 1,
  });
  if (newest === undefined) {
    return undefined;
  }
  const event = eventOf(newest).event;
  return event.case === "stigmerAgentStructuredOutput"
    ? (event.value.output ?? {})
    : undefined;
}

/**
 * How many sub-agent threads each run of a session opened: its
 * `session.thread_created` events, read by type alone and counted by
 * their run column, no event decoded.
 * A run that opened none is absent.
 */
export async function threadCountsOf(
  store: Store,
  sessionId: string,
): Promise<ReadonlyMap<string, number>> {
  const counts = new Map<string, number>();
  if (sessionId === "") {
    return counts;
  }
  const records = await readRecords(store, sessionId, {
    types: [THREAD_CREATED_EVENT_TYPE],
  });
  for (const record of records) {
    counts.set(record.runId, (counts.get(record.runId) ?? 0) + 1);
  }
  return counts;
}
