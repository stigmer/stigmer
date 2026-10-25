// Finds the processes an attempt left running and stops them, so no attempt
// answers for another and none outlives the run.
// Domain: conformance benchmark (the live half's hygiene, and a reading).
//
// A process is left behind when it works in the attempt's workspace (its
// current directory is the seeded workspace or under it) or listens on the
// background fixture's port, and it is no longer a descendant of the runner.
// That is exactly what a shell command's lone `&` leaves: the command's
// shell exits, and the child it backgrounded is re-parented away from the
// runner, still running (a dev server keeps its port for the next attempt).
// A command the agent started in the background is the runner's child until
// its invocation ends, when the runner stops it, so on that arm the count
// should read zero. The runner's own children (its per-turn `stigmer
// mcp-server`) are descendants, and are never touched.
//
// The count is of process GROUPS: the runner starts every shell command in a
// group of its own (runner shared/shell/run-command.ts), so one `go run
// ./cmd/server &` (the `go` process and the server it built) is one group,
// one thing the agent left running. Each group is stopped whole, SIGKILL,
// unless it is the runner's or this process's own, when only the found
// processes are.
//
// The table, the working directories and the listeners come from `ps` and
// `lsof`, read once per attempt; the parsing and the decision are pure, so
// the unit arms drive them directly.
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** How long a sweep waits for what it stopped to be gone. */
export const SWEEP_SETTLE_MS = 5_000;

export interface ProcessRow {
  pid: number;
  ppid: number;
  pgid: number;
}

/** Rows of `ps -A -o pid=,ppid=,pgid=`; anything else is skipped. */
export function parseProcessTable(text: string): ProcessRow[] {
  return text.split("\n").flatMap((line) => {
    const fields = line.trim().split(/\s+/).map(Number);
    if (fields.length !== 3 || fields.some((field) => !Number.isInteger(field))) return [];
    const [pid, ppid, pgid] = fields as [number, number, number];
    return [{ pid, ppid, pgid }];
  });
}

/**
 * The pids in `lsof -F pn` output whose name field is `dir` or a path under
 * it (with `-d cwd`, the processes working there).
 */
export function pidsUnder(lsofFields: string, dir: string): number[] {
  const pids = new Set<number>();
  let pid: number | undefined;
  for (const line of lsofFields.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n") && pid !== undefined) {
      const name = line.slice(1);
      if (name === dir || name.startsWith(`${dir}/`)) pids.add(pid);
    }
  }
  return [...pids];
}

/** The pids in `lsof -t` output. */
export function parsePids(text: string): number[] {
  return text.split("\n").map((line) => Number(line.trim())).filter((pid) => Number.isInteger(pid) && pid > 0);
}

/** `root` and every process below it in the table. */
export function descendantsOf(table: readonly ProcessRow[], root: number): Set<number> {
  const children = new Map<number, number[]>();
  for (const row of table) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row.pid]);
  const found = new Set<number>([root]);
  const queue = [root];
  while (queue.length > 0) {
    for (const child of children.get(queue.pop()!) ?? []) {
      if (found.has(child)) continue;
      found.add(child);
      queue.push(child);
    }
  }
  return found;
}

/** What to stop: each group left behind, with the found processes to signal when the group is a protected one. */
export interface Leftover {
  pgid: number;
  pids: number[];
  /** Signal the group whole; false when the group is the runner's or this process's own. */
  wholeGroup: boolean;
}

/**
 * The groups left behind (the header): every candidate (`working`, `listening`)
 * that is not the runner or below it, nor this process, grouped by its
 * process group. A candidate gone from the table has nothing left to stop.
 */
export function leftovers(input: {
  table: readonly ProcessRow[];
  runnerPid: number;
  selfPid: number;
  working: readonly number[];
  listening: readonly number[];
}): Leftover[] {
  const keep = descendantsOf(input.table, input.runnerPid);
  keep.add(input.selfPid);
  const rows = new Map(input.table.map((row) => [row.pid, row]));
  const protectedGroups = new Set<number>([0, 1]);
  for (const pid of [input.runnerPid, input.selfPid]) {
    const group = rows.get(pid)?.pgid;
    if (group !== undefined) protectedGroups.add(group);
  }
  const groups = new Map<number, number[]>();
  for (const pid of new Set([...input.working, ...input.listening])) {
    const row = rows.get(pid);
    if (row === undefined || keep.has(pid)) continue;
    groups.set(row.pgid, [...(groups.get(row.pgid) ?? []), pid]);
  }
  return [...groups].map(([pgid, pids]) => ({ pgid, pids: pids.sort((a, b) => a - b), wholeGroup: !protectedGroups.has(pgid) }));
}

/**
 * Finds what the attempt left behind in `workspaceDir` or on `port`, stops
 * it, waits for it to be gone, and returns the number of groups.
 */
/* v8 ignore start -- @preserve: drives `ps`, `lsof` and signals; the live benchmark and the readers smoke run it, the unit arms cover the parsing and the decision */
export async function sweepLeftovers(options: { workspaceDir: string; port: number; runnerPid: number }): Promise<number> {
  const dir = await realpath(options.workspaceDir).catch(() => options.workspaceDir);
  const table = parseProcessTable(await run("ps", ["-A", "-o", "pid=,ppid=,pgid="]));
  const working = pidsUnder(await run("lsof", ["-a", "-d", "cwd", "-F", "pn"]), dir);
  const listening = await listenersOn(options.port);
  const found = leftovers({ table, runnerPid: options.runnerPid, selfPid: process.pid, working, listening });
  const pids = found.flatMap((group) => group.pids);
  for (const group of found) {
    for (const target of group.wholeGroup ? [-group.pgid] : group.pids) {
      try {
        process.kill(target, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
  const deadline = Date.now() + SWEEP_SETTLE_MS;
  while (pids.some(alive) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
  return found.length;
}

/** The processes listening on `port` on this machine. */
export async function listenersOn(port: number): Promise<number[]> {
  return parsePids(await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]));
}

// `lsof` exits 1 when it finds nothing, with an empty answer: that is an
// answer, not a failure. Anything it could not read for permission is
// skipped by `lsof` itself.
async function run(command: string, args: readonly string[]): Promise<string> {
  try {
    return (await execFileAsync(command, args, { maxBuffer: 64 * 1024 * 1024 })).stdout;
  } catch (error) {
    const stdout = (error as { stdout?: unknown }).stdout;
    if ((error as { code?: unknown }).code === 1 && typeof stdout === "string") return stdout;
    throw error;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
/* v8 ignore stop */
