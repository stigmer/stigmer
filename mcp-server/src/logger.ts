// Process-wide structured logger for mcp-server-stigmer.
//
// All output goes to stderr: in stdio transport mode, stdout is reserved for
// the MCP JSON-RPC stream, so any stray stdout write would corrupt the
// protocol. This mirrors the Go server's `initLogger` (slog → stderr).

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "text" | "json";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

let minLevel: LogLevel = "info";
let format: LogFormat = "text";

/**
 * Configure the default logger. Called once at startup from the resolved config.
 *
 * Tolerant of invalid inputs (falls back to info/text) so that configuration
 * validation can still emit a precise error about the bad value through a
 * working logger, rather than the logger itself crashing first.
 */
export function configureLogger(opts: { level: string; format: string }): void {
  minLevel = opts.level in LEVEL_ORDER ? (opts.level as LogLevel) : "info";
  format = opts.format === "json" ? "json" : "text";
}

function emit(level: LogLevel, msg: string, fields?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

  if (format === "json") {
    process.stderr.write(JSON.stringify({ level, msg, ...fields }) + "\n");
    return;
  }

  const suffix = fields
    ? " " +
      Object.entries(fields)
        .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
        .join(" ")
    : "";
  process.stderr.write(`${level.toUpperCase()} ${msg}${suffix}\n`);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
