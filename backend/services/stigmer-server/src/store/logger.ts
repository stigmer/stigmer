/**
 * Minimal logging seam shared by the store drivers — structurally
 * compatible with boot/logger.ts, declared here so the store layer never
 * imports upward from boot/. Lived inline in sqlite/store.ts through
 * Phase 1; promoted when the Postgres driver became the second consumer.
 */
export interface StoreLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
}

/** Default for tests and tools that want a silent store. */
export const NOOP_STORE_LOGGER: StoreLogger = { debug() {}, warn() {} };
