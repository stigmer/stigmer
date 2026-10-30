// Master switch for the SDK's dev-only performance instrumentation (the
// `[stgm:perf:*]` logs emitted by useStreamRate, useRenderTracer, useDomNodeCount,
// useKeyStability, and DevProfiler).
//
// Off by default in every environment. These logs are pure noise for anyone not
// actively profiling, and in a non-browser TTY consumer — notably the `stigmer`
// CLI's Ink UI — console output is not filtered by a devtools log level, so it
// corrupts the rendered terminal. The old `NODE_ENV !== "production"` gate
// assumed a browser devtools context (where `console.debug` is hidden by
// default), which does not hold for Node consumers.
//
// Opt in without a rebuild:
//   - Node (CLI, tests):              STIGMER_PERF=1 stigmer run ...
//   - Browser (web/desktop devtools): globalThis.__STIGMER_PERF__ = true
//
// Still hard-gated on non-production so production bundles dead-code-eliminate
// the instrumentation entirely (bundlers inline `process.env.NODE_ENV`).

/** Reads the Node opt-in env var, guarding environments without `process`. */
function envFlagEnabled(): boolean {
  const env = typeof process !== "undefined" ? process.env : undefined;
  const value = env?.STIGMER_PERF;
  return value === "1" || value === "true";
}

/** Reads the browser runtime opt-in (toggle live from devtools). */
function globalFlagEnabled(): boolean {
  return (globalThis as { __STIGMER_PERF__?: unknown }).__STIGMER_PERF__ === true;
}

/**
 * Whether the SDK's dev-perf instrumentation may emit output. Evaluated per call
 * (not cached) so a browser runtime toggle takes effect without a remount.
 * Always `false` in production.
 */
export function isPerfLoggingEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  return envFlagEnabled() || globalFlagEnabled();
}
