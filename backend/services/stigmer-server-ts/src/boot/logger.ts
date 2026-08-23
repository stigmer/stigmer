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
}

export function createLogger(options: LoggerOptions): Logger {
  const threshold = LEVEL_RANK[options.level as LogLevel] ?? LEVEL_RANK.info;
  const write = options.write ?? ((line: string) => process.stderr.write(line + "\n"));

  const emit = (level: LogLevel, message: string, fields?: LogFields): void => {
    if (LEVEL_RANK[level] < threshold) {
      return;
    }
    const time = new Date().toISOString();
    if (options.pretty) {
      const suffix =
        fields === undefined || Object.keys(fields).length === 0
          ? ""
          : " " + JSON.stringify(fields);
      write(`${time} ${level.toUpperCase().padEnd(5)} ${message}${suffix}`);
      return;
    }
    write(JSON.stringify({ level, time, message, ...fields }));
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
  };
}
