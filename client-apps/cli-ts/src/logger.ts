// Diagnostic logger for the CLI. Writes only to stderr so structured command
// output on stdout stays clean for piping. Silent unless `--debug` is set, so
// scripts never see diagnostics on the happy path.

import { isDebug } from "./runtime.js";

function emit(msg: string, fields?: Record<string, unknown>): void {
  const suffix = fields
    ? " " +
      Object.entries(fields)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(" ")
    : "";
  process.stderr.write(`debug ${msg}${suffix}\n`);
}

export const log = {
  /** Emit a diagnostic line; a no-op unless `--debug` is active. */
  debug(msg: string, fields?: Record<string, unknown>): void {
    if (isDebug()) emit(msg, fields);
  },
};
