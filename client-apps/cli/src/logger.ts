// Diagnostic logger for the CLI. Writes only to stderr so structured command
// output on stdout stays clean for piping. `debug` is silent unless `--debug`
// is set, so scripts never see diagnostics on the happy path; `info`/`warn`/
// `error` always emit, which is what the supervised daemon relies on to record
// its lifecycle into daemon.log (its stderr is redirected there).

import { isDebug } from "./runtime.js";

function emit(level: string, msg: string, fields?: Record<string, unknown>): void {
  const suffix = fields
    ? " " +
      Object.entries(fields)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(" ")
    : "";
  process.stderr.write(`${level} ${msg}${suffix}\n`);
}

export const log = {
  /** Emit a diagnostic line; a no-op unless `--debug` is active. */
  debug(msg: string, fields?: Record<string, unknown>): void {
    if (isDebug()) emit("debug", msg, fields);
  },
  /** Emit an informational line (always). */
  info(msg: string, fields?: Record<string, unknown>): void {
    emit("info", msg, fields);
  },
  /** Emit a warning line (always). */
  warn(msg: string, fields?: Record<string, unknown>): void {
    emit("warn", msg, fields);
  },
  /** Emit an error line (always). */
  error(msg: string, fields?: Record<string, unknown>): void {
    emit("error", msg, fields);
  },
};

/** The logger interface, for dependency injection in tests. */
export type Logger = typeof log;
