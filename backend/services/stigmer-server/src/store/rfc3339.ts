/**
 * RFC-3339 UTC, whole seconds (Go time.RFC3339) — the ledger's house
 * convention for lexicographic comparison of recorded_at / completed_at
 * strings. Both drivers stamp the same shape so a timestamp written by
 * one is comparable (and parseable) on the other.
 *
 * Lived as a private helper in sqlite/store.ts through Phase 1; promoted
 * here when the Postgres driver became the second consumer.
 */
export function rfc3339Seconds(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
