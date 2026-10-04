/**
 * The server's read of its sessions for a sandbox driver's background
 * work (provisioner.ts, SessionActivityReader), over the store alone.
 *
 * Open source keeps no record of its sandboxes, so a driver that puts
 * idle sandboxes to sleep learns everything from the records the server
 * already has: a session's executions say whether it is busy and when it
 * was last active, and the session kind names every session a sandbox
 * can belong to. Both reads are indexed patterns the store already
 * serves (the executions' `session` list-index key; the keyset page by
 * id), so this module adds no query pattern and no index.
 *
 * The activity clock is an execution's creation
 * (`status.audit.spec_audit.created_at`, stamped by the server) and, once it
 * ends, its completion (`status.completed_at`, which the server stamps on
 * its own transitions and copies from the runner's status report
 * otherwise). A stamp more than a minute ahead of this server's clock is
 * not trusted and is skipped, so the execution's creation stands for it: a
 * runner whose clock runs far ahead cannot keep its sandbox awake, since
 * reading such a stamp as now would only read it again as now on every
 * pass. A stamp less than a minute ahead counts as it is, which keeps a
 * sandbox awake at most that minute longer. An execution that has not
 * ended is in an active phase, which makes the session busy, so its
 * progress never needs a clock.
 *
 * An idle sweep asks every awake session on every pass, and a session's
 * full history is the store's fattest rows (domain/agentexecution/list-index.ts),
 * so the reader keeps one entry per session it has read and offers a
 * second, cheap read beside the full one (stigmer#1803). `recentActivity`
 * reads only the session's executions created since its previous read,
 * less RECENT_LOOKBACK_MS, and re-reads by id the ones that were active
 * and the one holding the latest stamp. Every other execution had already
 * ended when it was folded, and an ended execution changes only through
 * Recover (domain/agentexecution/lifecycle.ts), a late status report that
 * rewrites its completion (update-status.ts), or a delete. Any of those
 * can only lower the full read's latest stamp when it befalls the
 * execution holding it, which is why that one is re-read: when its stamp
 * has gone or moved earlier, the cheap read falls back to the full one.
 * The look-back covers a run stamped up to a minute before it became
 * visible (its create chain stamps it before the gate and the save) on a
 * replica whose clock is up to a minute behind. So the cheap read can
 * miss only a recovered run or a rewritten completion of another
 * execution, or a run that became visible later than the look-back: it
 * may report a session idle, or last active earlier, when it is not,
 * never busier or later. `activity`, the full read, rebuilds the entry,
 * so the driver's guard read before every act heals any lag. An entry no
 * read has touched for ENTRY_IDLE_EVICT_MS is dropped, so memory follows
 * the sessions that are awake. The created-since read is the list
 * index's existing bound (store/list-index.ts, `createdAtOrAfter`) and
 * the by-id read is `getResource`.
 */
import { fromBinary } from "@bufbuild/protobuf";
import { timestampDate } from "@bufbuild/protobuf/wkt";

import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../boot/logger.js";
import { agentExecutionListIndex } from "../domain/agentexecution/list-index.js";
import { isActiveExecutionPhase } from "../domain/agentexecution/phases.js";
import { ResourceNotFoundError, type Store } from "../store/interface.js";
import {
  listIndexInstantOfMillis,
  type ListIndexRow,
} from "../store/list-index.js";
import type { SessionActivity, SessionActivityReader } from "./provisioner.js";

/** Sessions read per keyset page while mapping sandboxes back to sessions. */
const SESSION_PAGE_SIZE = 500;

/** How far ahead of this server's clock an activity stamp may be and still count (module header). */
export const FUTURE_STAMP_ALLOWANCE_MS = 60_000;

/**
 * How far before its previous read the cheap read looks again: a minute of
 * clock skew between replicas (the allowance FUTURE_STAMP_ALLOWANCE_MS
 * gives a stamp ahead) and a minute for a create chain's stamp-to-save
 * (module header).
 */
export const RECENT_LOOKBACK_MS = 120_000;

/** An entry no read has touched for this long is dropped (module header). */
export const ENTRY_IDLE_EVICT_MS = 10 * 60_000;

/** What the reader remembers of one session between reads (module header). */
interface SessionEntry {
  /** Executions in an active phase when last read. */
  readonly busyIds: Set<string>;
  /** Ended executions already folded, by id, with their index instant, while the next read's bound can still return them. */
  readonly foldedIds: Map<string, string>;
  /** Stamps more than the allowance ahead when folded, counted once the clock reaches them and their execution still carries them. */
  readonly aheadStamps: Array<{ readonly id: string; readonly stamp: number }>;
  lastActiveMs: number | undefined;
  /** The execution whose stamp is lastActiveMs. */
  lastActiveId: string | undefined;
  /** When the read that left this entry began, by this server's clock. */
  readAtMs: number;
  touchedAtMs: number;
}

function newEntry(readAtMs: number): SessionEntry {
  return {
    busyIds: new Set(),
    foldedIds: new Map(),
    aheadStamps: [],
    lastActiveMs: undefined,
    lastActiveId: undefined,
    readAtMs,
    touchedAtMs: readAtMs,
  };
}

export function newStoreSessionActivityReader(
  store: Store,
  logger: Logger,
  now: () => number = Date.now,
): SessionActivityReader {
  const entries = new Map<string, SessionEntry>();

  const evictUntouched = (nowMs: number): void => {
    for (const [sessionId, entry] of entries) {
      if (nowMs - entry.touchedAtMs >= ENTRY_IDLE_EVICT_MS) {
        entries.delete(sessionId);
      }
    }
  };

  const decode = (
    sessionId: string,
    row: ListIndexRow,
  ): AgentExecution | undefined => {
    try {
      return fromBinary(AgentExecutionSchema, row.data);
    } catch (error) {
      logger.warn("Failed to unmarshal execution, skipping", {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  };

  /** Folds one read row, and remembers it when it has ended and the next read's bound can still return it. */
  const foldRow = (
    entry: SessionEntry,
    row: ListIndexRow,
    execution: AgentExecution,
    nowMs: number,
    nextBound: string,
  ): void => {
    foldExecution(entry, row.id, execution, nowMs);
    const instant = row.cursor.createdAt;
    if (
      !entry.busyIds.has(row.id) &&
      (instant === "" || instant >= nextBound)
    ) {
      entry.foldedIds.set(row.id, instant);
    }
  };

  const activity = async (sessionId: string): Promise<SessionActivity> => {
    const readAtMs = now();
    const rows = await store.queryResources(agentExecutionListIndex, {
      anyKey: [{ name: "session", value: sessionId }],
    });
    const nowMs = now();
    const entry = newEntry(readAtMs);
    const nextBound = listIndexInstantOfMillis(readAtMs - RECENT_LOOKBACK_MS);
    for (const row of rows) {
      const execution = decode(sessionId, row);
      if (execution !== undefined) {
        foldRow(entry, row, execution, nowMs, nextBound);
      }
    }
    evictUntouched(nowMs);
    entry.touchedAtMs = nowMs;
    entries.set(sessionId, entry);
    return activityOfEntry(entry);
  };

  /** The execution by id, or undefined once it is deleted. */
  const reread = async (id: string): Promise<AgentExecution | undefined> => {
    try {
      return await store.getResource(
        ApiResourceKind.agent_execution,
        id,
        AgentExecutionSchema,
      );
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return undefined;
      }
      throw error;
    }
  };

  return {
    activity,

    async recentActivity(sessionId: string): Promise<SessionActivity> {
      const readAtMs = now();
      evictUntouched(readAtMs);
      const entry = entries.get(sessionId);
      if (entry === undefined) {
        return activity(sessionId);
      }
      const rows = await store.queryResources(agentExecutionListIndex, {
        anyKey: [{ name: "session", value: sessionId }],
        createdAtOrAfter: listIndexInstantOfMillis(
          entry.readAtMs - RECENT_LOOKBACK_MS,
        ),
      });
      const nowMs = now();
      const nextBound = listIndexInstantOfMillis(readAtMs - RECENT_LOOKBACK_MS);
      // The execution holding the latest stamp is read on every pass:
      // only its delete, its Recover or a late report rewriting its
      // completion can make the full read's latest stamp earlier.
      const latest = entry.lastActiveId;
      const latestMs = entry.lastActiveMs;
      let latestNow: AgentExecution | undefined;
      let latestRead = false;
      const present = new Set<string>();
      /** Executions decoded on this read, so current as of it. */
      const current = new Set<string>();
      for (const row of rows) {
        present.add(row.id);
        if (entry.foldedIds.has(row.id) && row.id !== latest) {
          continue;
        }
        const execution = decode(sessionId, row);
        if (row.id === latest) {
          latestNow = execution;
          latestRead = true;
        }
        if (execution !== undefined) {
          current.add(row.id);
          foldRow(entry, row, execution, nowMs, nextBound);
        }
      }
      for (const id of [...entry.busyIds]) {
        if (present.has(id)) {
          continue;
        }
        const execution = await reread(id);
        if (id === latest) {
          latestNow = execution;
          latestRead = true;
        }
        if (execution === undefined) {
          entry.busyIds.delete(id);
          continue;
        }
        current.add(id);
        foldExecution(entry, id, execution, nowMs);
      }
      if (latest !== undefined && !latestRead) {
        latestNow = await reread(latest);
        if (latestNow !== undefined) {
          current.add(latest);
          foldExecution(entry, latest, latestNow, nowMs);
        }
      }
      if (
        latest !== undefined &&
        latestMs !== undefined &&
        (latestNow === undefined ||
          (latestStampOf(latestNow, nowMs) ?? -Infinity) < latestMs)
      ) {
        return activity(sessionId);
      }
      // A held-back stamp is about to count: read its execution first, so
      // a stamp it no longer carries never does.
      const reachedIds = new Set(
        entry.aheadStamps
          .filter((ahead) => reached(ahead.stamp, nowMs) && !current.has(ahead.id))
          .map((ahead) => ahead.id),
      );
      for (const id of reachedIds) {
        const execution = await reread(id);
        if (execution === undefined) {
          removeAheadStamps(entry, id);
        } else {
          foldExecution(entry, id, execution, nowMs);
        }
      }
      promoteAheadStamps(entry, nowMs);
      for (const [id, instant] of entry.foldedIds) {
        if (instant !== "" && instant < nextBound) {
          entry.foldedIds.delete(id);
        }
      }
      entry.readAtMs = readAtMs;
      entry.touchedAtMs = nowMs;
      return activityOfEntry(entry);
    },

    async *sessionIds(): AsyncIterable<string> {
      let after = "";
      for (;;) {
        const page = await store.findResourcesRawOrderedAfter(
          ApiResourceKind.session,
          after,
          SESSION_PAGE_SIZE,
        );
        for (const document of page) {
          yield document.id;
        }
        if (page.length < SESSION_PAGE_SIZE) {
          return;
        }
        after = page[page.length - 1]?.id ?? after;
      }
    },
  };
}

/** Busy and the latest trusted stamp over one session's executions (module header). */
export function sessionActivityOf(
  executions: readonly AgentExecution[],
  nowMs: number,
): SessionActivity {
  const entry = newEntry(nowMs);
  executions.forEach((execution, index) => {
    foldExecution(entry, execution.metadata?.id || `#${index}`, execution, nowMs);
  });
  return activityOfEntry(entry);
}

/**
 * Folds one execution into a session's entry: busy while it is active,
 * and its creation and completion as activity stamps, a stamp more than
 * the allowance ahead of `nowMs` held back until the clock reaches it
 * (module header). Folding an execution again only moves the entry
 * forward, so the cheap read may re-read one it has folded.
 */
function foldExecution(
  entry: SessionEntry,
  id: string,
  execution: AgentExecution,
  nowMs: number,
): void {
  const status = execution.status;
  if (status === undefined) {
    entry.busyIds.delete(id);
    removeAheadStamps(entry, id);
    return;
  }
  if (isActiveExecutionPhase(status.phase)) {
    entry.busyIds.add(id);
  } else {
    entry.busyIds.delete(id);
  }
  // The execution as read now replaces whatever it held back before.
  removeAheadStamps(entry, id);
  for (const stamp of stampsOf(execution)) {
    if (stamp > nowMs + FUTURE_STAMP_ALLOWANCE_MS) {
      entry.aheadStamps.push({ id, stamp });
      continue;
    }
    counted(entry, id, stamp);
  }
}

function removeAheadStamps(entry: SessionEntry, id: string): void {
  for (let i = entry.aheadStamps.length - 1; i >= 0; i -= 1) {
    if (entry.aheadStamps[i]?.id === id) {
      entry.aheadStamps.splice(i, 1);
    }
  }
}

/** An execution's creation and completion, each when it has a parsable one. */
function stampsOf(execution: AgentExecution): number[] {
  const status = execution.status;
  if (status === undefined) {
    return [];
  }
  const stamps: number[] = [];
  const createdAt = status.audit?.specAudit?.createdAt;
  if (createdAt !== undefined) {
    stamps.push(timestampDate(createdAt).getTime());
  }
  if (status.completedAt !== "") {
    const completed = Date.parse(status.completedAt);
    if (!Number.isNaN(completed)) {
      stamps.push(completed);
    }
  }
  return stamps;
}

/** An execution's latest stamp that counts at `nowMs`, undefined when none does. */
function latestStampOf(
  execution: AgentExecution,
  nowMs: number,
): number | undefined {
  let latest: number | undefined;
  for (const stamp of stampsOf(execution)) {
    if (
      stamp <= nowMs + FUTURE_STAMP_ALLOWANCE_MS &&
      (latest === undefined || stamp > latest)
    ) {
      latest = stamp;
    }
  }
  return latest;
}

function counted(entry: SessionEntry, id: string, stamp: number): void {
  if (entry.lastActiveMs === undefined || stamp > entry.lastActiveMs) {
    entry.lastActiveMs = stamp;
    entry.lastActiveId = id;
  }
}

/** Whether a held-back stamp counts at `nowMs`. */
function reached(stamp: number, nowMs: number): boolean {
  return stamp <= nowMs + FUTURE_STAMP_ALLOWANCE_MS;
}

/** Counts every held-back stamp the clock has reached. */
function promoteAheadStamps(entry: SessionEntry, nowMs: number): void {
  const held = entry.aheadStamps.splice(0);
  for (const ahead of held) {
    if (!reached(ahead.stamp, nowMs)) {
      entry.aheadStamps.push(ahead);
    } else {
      counted(entry, ahead.id, ahead.stamp);
    }
  }
}

function activityOfEntry(entry: SessionEntry): SessionActivity {
  return {
    busy: entry.busyIds.size > 0,
    lastActiveAt:
      entry.lastActiveMs === undefined ? undefined : new Date(entry.lastActiveMs),
  };
}
