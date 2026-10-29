/**
 * RFC-3339 UTC, whole seconds — the ledger's house
 * convention for lexicographic comparison of recorded_at / completed_at
 * strings. Both drivers stamp the same shape so a timestamp written by
 * one is comparable (and parseable) on the other.
 *
 * Lived as a private helper in sqlite/store.ts while SQLite was the only
 * driver; promoted here when the Postgres driver became the second consumer.
 * `instantNotBefore` is the logs' stamp (the session event log, the
 * permission history), lifted here when the history became its second user.
 */
export function rfc3339Seconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/**
 * The instant a log stamps an entry with: fixed-width UTC with
 * milliseconds, never before `newest`, the log's latest stamp, so a log's
 * times never go back when the clock does.
 */
export function instantNotBefore(nowMillis: number, newest: string | undefined): string {
  const now = new Date(nowMillis).toISOString();
  return newest !== undefined && newest > now ? newest : now;
}
