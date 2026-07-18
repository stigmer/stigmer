/**
 * Compact relative-time formatter for recent-activity rows.
 *
 * The recents list sorts by LAST ACTIVITY (`statusAudit.updatedAt`), while
 * execution names embed their CREATION time — so an old run legitimately
 * re-bumped by a status change (a cancel, a late failure) sorts above
 * newer-named items and reads as "wrong order" unless the row says why it
 * is there. This stamp is that explanation: it renders the sort key the
 * user cannot otherwise see.
 *
 * Compact single-unit output — a sidebar row suffix, not prose:
 * `now`, `5m`, `3h`, `6d`, then a short date (`Jul 12`, `Jul 12, 2025`)
 * once "days ago" stops being how people think about it.
 */
export function formatRelativeTime(date: Date, now?: Date): string {
  const ref = now ?? new Date();
  const deltaMs = ref.getTime() - date.getTime();

  // Clock skew between writers can put a stamp slightly in the future;
  // render it as "now" rather than a nonsense negative age.
  if (deltaMs < 60_000) return "now";

  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  const sameYear = date.getFullYear() === ref.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
