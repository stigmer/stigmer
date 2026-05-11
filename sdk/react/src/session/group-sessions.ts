import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";

/** A time-based group of sessions produced by {@link groupSessionsByTime}. */
export interface SessionGroup {
  /** Display label for this group (e.g. "Today", "Yesterday"). */
  readonly label: string;
  /** Sessions belonging to this group, in their original input order. */
  readonly sessions: readonly Session[];
}

/** A time-based group of search results produced by {@link groupSearchResultsByTime}. */
export interface SearchResultGroup {
  /** Display label for this group (e.g. "Today", "Yesterday"). */
  readonly label: string;
  /** Search results belonging to this group, in their original input order. */
  readonly entries: readonly SearchResult[];
}

interface Bucket {
  label: string;
  sessions: Session[];
}

interface SearchResultBucket {
  label: string;
  entries: SearchResult[];
}

/**
 * Groups sessions by their creation timestamp into time-based buckets:
 * "Today", "Yesterday", "Previous 7 Days", "Previous 30 Days", "Older".
 *
 * Empty groups are omitted. Sessions with missing timestamps are placed
 * in the last group. Input order is preserved within each group.
 *
 * @param sessions - List of sessions to group (typically from `useSessionList`).
 * @param now - Reference time for grouping; defaults to the current time.
 *              Accepts an explicit value for deterministic testing.
 *
 * @example
 * ```tsx
 * function GroupedSessionList() {
 *   const { sessions } = useSessionList();
 *   const groups = groupSessionsByTime(sessions);
 *
 *   return (
 *     <div>
 *       {groups.map((group) => (
 *         <section key={group.label}>
 *           <h3>{group.label}</h3>
 *           <ul>
 *             {group.sessions.map((s) => (
 *               <li key={s.metadata?.id}>{s.status?.subject}</li>
 *             ))}
 *           </ul>
 *         </section>
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function groupSessionsByTime(
  sessions: readonly Session[],
  now?: Date,
): readonly SessionGroup[] {
  const ref = now ?? new Date();
  const todayStart = startOfDay(ref);
  const yesterdayStart = addDays(todayStart, -1);
  const sevenDaysAgo = addDays(todayStart, -6);
  const thirtyDaysAgo = addDays(todayStart, -29);

  const buckets: Bucket[] = [
    { label: "Today", sessions: [] },
    { label: "Yesterday", sessions: [] },
    { label: "Previous 7 Days", sessions: [] },
    { label: "Previous 30 Days", sessions: [] },
    { label: "Older", sessions: [] },
  ];

  for (const session of sessions) {
    const ts = session.status?.audit?.specAudit?.createdAt;
    const date = ts ? timestampDate(ts) : null;

    if (!date) {
      buckets[buckets.length - 1].sessions.push(session);
      continue;
    }

    if (date >= todayStart) {
      buckets[0].sessions.push(session);
    } else if (date >= yesterdayStart) {
      buckets[1].sessions.push(session);
    } else if (date >= sevenDaysAgo) {
      buckets[2].sessions.push(session);
    } else if (date >= thirtyDaysAgo) {
      buckets[3].sessions.push(session);
    } else {
      buckets[4].sessions.push(session);
    }
  }

  return buckets.filter((b) => b.sessions.length > 0);
}

/**
 * Groups SearchResult entries by their `createdAt` timestamp into time-based
 * buckets, identical to {@link groupSessionsByTime} but for lightweight
 * search results.
 *
 * @param entries - SearchResult entries (from SearchService session search).
 * @param now - Reference time for grouping; defaults to current time.
 */
export function groupSearchResultsByTime(
  entries: readonly SearchResult[],
  now?: Date,
): readonly SearchResultGroup[] {
  const ref = now ?? new Date();
  const todayStart = startOfDay(ref);
  const yesterdayStart = addDays(todayStart, -1);
  const sevenDaysAgo = addDays(todayStart, -6);
  const thirtyDaysAgo = addDays(todayStart, -29);

  const buckets: SearchResultBucket[] = [
    { label: "Today", entries: [] },
    { label: "Yesterday", entries: [] },
    { label: "Previous 7 Days", entries: [] },
    { label: "Previous 30 Days", entries: [] },
    { label: "Older", entries: [] },
  ];

  for (const entry of entries) {
    const ts = entry.createdAt;
    const date = ts ? timestampDate(ts) : null;

    if (!date) {
      buckets[buckets.length - 1].entries.push(entry);
      continue;
    }

    if (date >= todayStart) {
      buckets[0].entries.push(entry);
    } else if (date >= yesterdayStart) {
      buckets[1].entries.push(entry);
    } else if (date >= sevenDaysAgo) {
      buckets[2].entries.push(entry);
    } else if (date >= thirtyDaysAgo) {
      buckets[3].entries.push(entry);
    } else {
      buckets[4].entries.push(entry);
    }
  }

  return buckets.filter((b) => b.entries.length > 0);
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}
