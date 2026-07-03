import type { RecentActivityEntry, RecentActivityGroup } from "./types.js";

interface Bucket {
  label: string;
  entries: RecentActivityEntry[];
}

/**
 * Groups recent-activity entries by their `updatedAt` timestamp into
 * time-based buckets: "Today", "Yesterday", "Previous 7 Days",
 * "Previous 30 Days", "Older".
 *
 * Empty groups are omitted. Input order is preserved within each group.
 *
 * @param entries - Unified activity entries (from {@link useRecentActivity}).
 * @param now - Reference time; defaults to the current time.
 */
export function groupRecentActivityByTime(
  entries: readonly RecentActivityEntry[],
  now?: Date,
): readonly RecentActivityGroup[] {
  const ref = now ?? new Date();
  const todayStart = startOfDay(ref);
  const yesterdayStart = addDays(todayStart, -1);
  const sevenDaysAgo = addDays(todayStart, -6);
  const thirtyDaysAgo = addDays(todayStart, -29);

  const buckets: Bucket[] = [
    { label: "Today", entries: [] },
    { label: "Yesterday", entries: [] },
    { label: "Previous 7 Days", entries: [] },
    { label: "Previous 30 Days", entries: [] },
    { label: "Older", entries: [] },
  ];

  for (const entry of entries) {
    const date = entry.updatedAt;

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
