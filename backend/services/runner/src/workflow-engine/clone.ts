/**
 * Sandbox-safe deep clone. Prefers `structuredClone` when available
 * (Node 17+), falls back to JSON round-trip for environments that
 * lack it — notably the Temporal deterministic V8 isolate which
 * patches many global APIs but omits `structuredClone`.
 *
 * Safe for all JSON-serializable values (workflow definitions,
 * config objects, state snapshots). Not suitable for values
 * containing functions, Dates, or circular references.
 */
export function deepClone<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (typeof globalThis.structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}
