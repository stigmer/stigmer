// Log rotation, run once at the start of every `up`.
//
// Each non-empty component log is renamed with a timestamp suffix so a fresh
// run starts clean while the previous run's output is preserved for diagnosis.
// Archived logs older than the retention window are then pruned. This mirrors
// the Go CLI's `rotateLogsIfNeeded` + `cleanupOldLogs`.

import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

/** Component log files eligible for rotation. */
const ROTATABLE_LOGS = [
  "daemon.log",
  "stigmer-server.log",
  "stigmer-server.err",
  "runner.log",
  "runner.err",
  "temporal.log",
  "llm.log",
];

/** Default retention for archived logs, in days. */
export const DEFAULT_LOG_RETENTION_DAYS = 7;

/**
 * Rotate non-empty component logs in `logDir`, returning the number rotated.
 * Creates the directory if needed and prunes archives past the retention
 * window. A clock can be injected for deterministic tests.
 */
export function rotateLogs(
  logDir: string,
  options: { now?: Date; retentionDays?: number } = {},
): number {
  const now = options.now ?? new Date();
  mkdirSync(logDir, { recursive: true });

  const suffix = timestampSuffix(now);
  let rotated = 0;
  for (const name of ROTATABLE_LOGS) {
    const oldPath = join(logDir, name);
    let size: number;
    try {
      size = statSync(oldPath).size;
    } catch {
      continue; // missing log — nothing to rotate
    }
    if (size === 0) continue; // empty log — leave it in place

    try {
      renameSync(oldPath, `${oldPath}.${suffix}`);
      rotated += 1;
    } catch {
      // A rotation failure must not block startup; leave the log and move on.
    }
  }

  cleanupOldLogs(logDir, options.retentionDays ?? DEFAULT_LOG_RETENTION_DAYS, now);
  return rotated;
}

/**
 * Delete archived logs (`*.log.*` / `*.err.*`) older than `keepDays`, returning
 * the count removed.
 */
export function cleanupOldLogs(
  logDir: string,
  keepDays: number = DEFAULT_LOG_RETENTION_DAYS,
  now: Date = new Date(),
): number {
  const cutoff = now.getTime() - keepDays * 24 * 60 * 60 * 1000;
  let entries: string[];
  try {
    entries = readdirSync(logDir);
  } catch {
    return 0;
  }

  let deleted = 0;
  for (const entry of entries) {
    if (!isArchivedLog(entry)) continue;
    const path = join(logDir, entry);
    let mtimeMs: number;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs >= cutoff) continue;
    try {
      rmSync(path, { force: true });
      deleted += 1;
    } catch {
      // Best-effort cleanup; a stuck file does not fail startup.
    }
  }
  return deleted;
}

// Archived logs are the rotated copies: a base ending in `.log` or `.err`
// followed by a timestamp suffix (e.g. `runner.log.2026-06-13-141502`).
function isArchivedLog(name: string): boolean {
  return /\.(log|err)\..+$/.test(name);
}

// Matches the Go layout "2006-01-02-150405" (local time): YYYY-MM-DD-HHmmss.
function timestampSuffix(date: Date): string {
  const p = (n: number, width = 2): string => String(n).padStart(width, "0");
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-` +
    `${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  );
}
