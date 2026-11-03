// PID-file read/write/remove helpers.
//
// PID files are how the daemon, its children, and a fresh CLI invocation find
// each other across process boundaries. Some PID files written by other tools
// (notably Temporal's) carry extra lines after the PID; readPidFile reads only
// the first line so it tolerates both single-line and multi-line formats.
//
// A PID file can outlive its process, and the OS may then give the number to
// an unrelated program (stigmer#2750). So the writer adds a second line,
// `started=<token>`, the process's start time (state/proc.ts), and every
// reader about to signal or trust a recorded PID asks recordedLiveProcess,
// which answers with the PID only while the live process is still the one
// recorded. The first line stays the bare PID every reader, an older CLI's
// included, expects.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { log } from "../../logger.js";
import { isOtherLiveProcess, processStartTime } from "./proc.js";

const STARTED_KEY = "started=";

/** What a PID file records: the PID, and when that process started if known. */
export interface PidRecord {
  pid: number;
  /** The start-time token written beside the PID; null in a file without one. */
  started: string | null;
}

/**
 * Write a PID file (creating its directory if needed), with the process's
 * start time as a second line when it can be read. Every writer is the process
 * itself or its parent right after the spawn, so the time read is that
 * process's.
 */
export function writePidFile(path: string, pid: number): void {
  mkdirSync(dirname(path), { recursive: true });
  const started = processStartTime(pid);
  writeFileSync(path, started === null ? `${pid}\n` : `${pid}\n${STARTED_KEY}${started}\n`, "utf8");
}

/**
 * Read a PID from a PID file. Returns null if the file is missing or its first
 * line is not a positive integer, so callers branch on presence rather than
 * catching exceptions.
 */
export function readPidFile(path: string): number | null {
  return readPidRecord(path)?.pid ?? null;
}

/** Read a PID file's PID and recorded start time; null like readPidFile. */
export function readPidRecord(path: string): PidRecord | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return null;
  }
  const lines = raw.split("\n");
  const pid = Number.parseInt(lines[0]?.trim() ?? "", 10);
  if (!Number.isInteger(pid) || pid <= 0) return null;
  const startedLine = lines.slice(1).find((line) => line.startsWith(STARTED_KEY));
  const started = startedLine === undefined ? null : startedLine.slice(STARTED_KEY.length).trim();
  return { pid, started: started === "" ? null : started };
}

/**
 * The recorded PID, only while it names a live process other than this one
 * that is still the process recorded; null otherwise. A record whose start
 * time no longer matches, or can no longer be read, names another program now:
 * it is logged once here and the caller treats the file as stale, signalling
 * nothing. A file with no start time, written by a CLI from before the line
 * existed, is trusted on liveness alone, as it always was.
 */
export function recordedLiveProcess(path: string): number | null {
  const record = readPidRecord(path);
  if (record === null || !isOtherLiveProcess(record.pid)) return null;
  if (record.started === null) return record.pid;
  if (processStartTime(record.pid) === record.started) return record.pid;
  log.info(`${basename(path)} names another program now; leaving it alone`, { pid: record.pid });
  return null;
}

/** Remove a PID file. Best-effort: a missing file is not an error. */
export function removePidFile(path: string): void {
  rmSync(path, { force: true });
}
