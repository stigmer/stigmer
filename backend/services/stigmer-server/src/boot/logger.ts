/**
 * Leveled structured logger for the server process.
 *
 * Hand-rolled rather than a dependency: the repo's TS services have no
 * logging library precedent (the runner logs through raw console and
 * Temporal's runtime), and the server's needs are exactly four levels, a
 * threshold, structured fields, and two output shapes. Go's zerolog
 * behavior is the reference: NDJSON to stderr in deployed environments,
 * human-readable console output when ENV=local (server.go:939), stdout
 * untouched.
 *
 * The sink is the one seam for a structured export. A deployable that
 * ships records to a collector (the cloud composition's OTLP log export,
 * convergence entry 20260909.05; a self-hosting team's own exporter next)
 * needs the entry — level, instant, message, fields — not the formatted
 * line, and it needs it exactly for the lines the threshold let through,
 * so LOG_LEVEL governs every output from one place. The written line stays
 * the operator's `kubectl logs` view, unchanged whether a sink is present
 * or not; the sink is called after the write, so a stderr fault skips the
 * export of that line rather than the reverse. This module stays free of
 * runtime dependencies on purpose: the SDK that turns an entry into a
 * record belongs to the deployable that chose a collector.
 *
 * The level tiering CONTRACT lives in the logging interceptor
 * (pipeline/interceptors/logging.ts) — this module only provides the
 * mechanism.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

/**
 * One log line, structured, as a sink receives it: computed once per
 * emission, so the written line and the exported record carry the same
 * instant and the same fields.
 */
export interface LogEntry {
  readonly level: LogLevel;
  readonly time: Date;
  readonly message: string;
  readonly fields: LogFields | undefined;
}

/**
 * Receives every entry that passed the threshold, after the line is
 * written. A sink owns its own failure handling — the logger is called
 * from every hot path in the process and never wraps the sink in a
 * try/catch it would then have to log through itself.
 */
export type LogSink = (entry: LogEntry) => void;

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface LoggerOptions {
  /** Threshold; entries below it are dropped. Unknown values mean "info". */
  level: string;
  /** Human-readable output (ENV=local) instead of NDJSON. */
  pretty: boolean;
  /** Test seam; defaults to stderr so stdout stays clean for tooling. */
  write?: (line: string) => void;
  /** Structured export seam; absent means the written line is the only output. */
  sink?: LogSink;
}

export function createLogger(options: LoggerOptions): Logger {
  const threshold = LEVEL_RANK[options.level as LogLevel] ?? LEVEL_RANK.info;
  const write =
    options.write ?? ((line: string) => process.stderr.write(line + "\n"));
  const sink = options.sink;

  const emit = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (LEVEL_RANK[level] < threshold) {
      return;
    }
    const time = new Date();
    if (options.pretty) {
      const suffix =
        fields === undefined || Object.keys(fields).length === 0
          ? ""
          : " " + JSON.stringify(fields);
      write(
        `${time.toISOString()} ${level.toUpperCase().padEnd(5)} ${message}${suffix}`,
      );
    } else {
      write(
        JSON.stringify({ level, time: time.toISOString(), message, ...fields }),
      );
    }
    sink?.({ level, time, message, fields });
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
  };
}
