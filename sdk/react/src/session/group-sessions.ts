import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";

export interface SessionGroup {
  /** Display label for this group (e.g. "Today", "Yesterday"). */
  readonly label: string;
  /** Sessions belonging to this group, in their original input order. */
  readonly sessions: readonly Session[];
}

interface Bucket {
  label: string;
  sessions: Session[];
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
