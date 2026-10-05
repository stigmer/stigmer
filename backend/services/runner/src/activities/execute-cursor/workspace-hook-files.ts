/**
 * The hook files a workspace carries, kept from running for the Cursor
 * engine's agent, so only the agent's own hooks run on this engine as on
 * the native one.
 *
 * WHY. `@cursor/sdk` loads project hooks through its `project` setting
 * source, which the gate needs for its own `.cursor/hooks.json`, and that
 * source loads, with no option to separate them, `<cwd>/.cursor/hooks.json`,
 * `<cwd>/.claude/settings.json` and `<cwd>/.claude/settings.local.json` (live
 * probe, 2026-10-05: a Claude Code hook in either settings file ran on a
 * shell call; a second workspace folder contributed none).
 *
 * WHAT IS DONE. A repository's own `.cursor/hooks.json` entries are set aside
 * for the turn: the gate writes the file with its own entries only
 * (`workspace-setup.ts`). A `.claude` settings file's `hooks` key is set
 * aside for the turn in a folder the runner owns, one it cloned (`git_repo`)
 * or created (a session's own directory); every other key is kept. A
 * person's own folder (`local_path`) is never touched: Claude Code reloads
 * hooks when the file changes, so stripping them would switch a team's
 * hooks off in the person's open tools for as long as the turn runs.
 * Instead the Cursor engine refuses the turn when either file there has a
 * non-empty `hooks` object, naming the file ({@link CursorWorkspaceHooksRefusal}).
 * The rule is simpler than the SDK's own load test on purpose, so an SDK
 * bump cannot quietly widen what loads; a file that does not parse refuses
 * nothing, since the SDK loads no hooks from it. Every folder is checked,
 * not only the one the SDK reads today. A runner-owned folder's settings
 * file reached through a link (one that is a link, or resolves outside the
 * folder) is never edited either, since the file it reaches may be a
 * person's own; carrying hooks, it refuses the turn the same way.
 *
 * RESTORING. Every file the gate rewrites is snapshotted under the gate
 * directory, its original bytes beside the bytes the gate wrote, before it
 * is written ({@link rewriteWorkspaceFiles}). At the turn's end
 * ({@link restoreWorkspaceFiles}) `.cursor/hooks.json` gets its original
 * back whatever the agent did to it: it is the gate's file, left out of the
 * turn's file review (`CURSOR_RUNNER_OWNED_PATHS`), so no change to it may
 * outlive the turn unseen. A `.claude` settings file, which the review does
 * see, gets its original back when it still holds what the gate wrote,
 * stays deleted when the agent deleted it, and otherwise keeps the agent's
 * edit with the set-aside hooks put back (any the agent added kept beside
 * them), with a log line.
 * A snapshot a crashed runner left behind is restored when the next runner
 * boots ({@link restoreAbandonedWorkspaceFiles}), before any turn pins the
 * tree its file review compares against; restored later, the files would
 * read as the agent's change. A snapshot names the runner that wrote it, so
 * a booting runner leaves alone one whose writer still runs (another runner
 * on the same machine, mid-turn). The next install restores any snapshot
 * still left, before anything else. The snapshot is the owner's alone (mode
 * 0600): a settings file can carry tokens in its `env`.
 */

import { execFileSync } from "node:child_process";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import type { ProvisionResult } from "../../shared/workspace/types.js";

const CLAUDE_DIR = ".claude";
const CLAUDE_SETTINGS_FILES = ["settings.json", "settings.local.json"] as const;
const SNAPSHOT_FILE = "workspace-files.json";

/** One workspace folder, and whether the runner owns it. */
export interface WorkspaceFolder {
  readonly dir: string;
  readonly runnerOwned: boolean;
}

/**
 * Each folder of the turn, owned by the runner unless provisioning mounted
 * it from a person's own directory (`local_path`). A session's own
 * directory has no provision result and is the runner's.
 */
export function workspaceFolders(dirs: readonly string[], provisionResults: readonly ProvisionResult[]): WorkspaceFolder[] {
  return dirs.map((dir) => ({
    dir,
    runnerOwned: !provisionResults.some((result) => result.rootDir === dir && result.sourceType === "local_path"),
  }));
}

/**
 * A Cursor turn the workspace's hook files would leave unsafe:
 *  - `own-folder`: a person's own folder's `.claude` settings carry hooks
 *    the SDK would run, and the runner does not edit a person's folder;
 *  - `linked`: `.claude` settings that carry hooks are reached through a
 *    link (a file that is one, or that resolves outside its folder), which
 *    the runner never edits;
 *  - `gate-link`: the gate's own `.cursor/hooks.json`, or `.cursor`, is a
 *    link. `@cursor/sdk` 1.0.31 loads no project hook file through a link,
 *    so the gate would not run at all.
 */
export class CursorWorkspaceHooksRefusal extends Error {
  constructor(files: readonly string[], why: "own-folder" | "linked" | "gate-link" = "own-folder") {
    super(refusalMessage(files, why));
    this.name = "CursorWorkspaceHooksRefusal";
  }
}

function refusalMessage(files: readonly string[], why: "own-folder" | "linked" | "gate-link"): string {
  const named = files.join(" and ");
  const carry = files.length === 1 ? "carries" : "carry";
  switch (why) {
    case "own-folder":
      return (
        `${named} ${carry} Claude Code hooks, which the Cursor engine would run beside the agent's own. ` +
        "Stigmer does not edit a folder of yours, so it cannot set them aside for the turn. " +
        "Run this session on Stigmer's native engine, or move the hooks out of the folder's .claude settings."
      );
    case "linked":
      return (
        `${named} ${carry} Claude Code hooks and ${files.length === 1 ? "is" : "are"} reached through a link. ` +
        "Stigmer does not edit a file through a link, so it cannot set those hooks aside for the turn. " +
        "Run this session on Stigmer's native engine, or replace the link with a file."
      );
    case "gate-link":
      return (
        `${named} is a link. The Cursor engine loads no hook file through a link, so Stigmer's approval gate would not run. ` +
        "Replace the link with a file, or run this session on Stigmer's native engine."
      );
  }
}

/** Refuse the turn when the gate's `.cursor/hooks.json`, or `.cursor`, is a link. Throws {@link CursorWorkspaceHooksRefusal}. */
export async function refuseLinkedGateFile(workspaceRoot: string): Promise<void> {
  if (workspaceRoot === "") return;
  for (const path of [join(workspaceRoot, ".cursor"), join(workspaceRoot, ".cursor", "hooks.json")]) {
    if (await isLink(path)) throw new CursorWorkspaceHooksRefusal([path], "gate-link");
  }
}

/** The `.claude` settings files under `dir` that carry a non-empty `hooks` object. */
export async function claudeSettingsWithHooks(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of CLAUDE_SETTINGS_FILES) {
    const path = join(dir, CLAUDE_DIR, name);
    const parsed = parseObject(await readOrNull(path));
    const hooks = parsed?.["hooks"];
    if (isObject(hooks) && Object.keys(hooks).length > 0) found.push(path);
  }
  return found;
}

/**
 * Refuse the turn when `.claude` hooks would run that the runner may not set
 * aside: a person's own folder's, or a runner-owned folder's reached through
 * a link. Throws {@link CursorWorkspaceHooksRefusal}.
 */
export async function refuseOwnFolderHooks(folders: readonly WorkspaceFolder[]): Promise<void> {
  const own: string[] = [];
  const linked: string[] = [];
  for (const folder of folders) {
    for (const path of await claudeSettingsWithHooks(folder.dir)) {
      if (!folder.runnerOwned) own.push(path);
      else if (await linkedOut(folder.dir, path)) linked.push(path);
    }
  }
  if (own.length > 0) throw new CursorWorkspaceHooksRefusal(own);
  if (linked.length > 0) throw new CursorWorkspaceHooksRefusal(linked, "linked");
}

/**
 * Whether a settings file is reached through a link: it is one, or it
 * resolves outside its folder (a linked `.claude` directory). Editing it
 * would edit a file the folder does not hold, a person's own settings
 * perhaps.
 */
async function linkedOut(dir: string, path: string): Promise<boolean> {
  if ((await lstat(path)).isSymbolicLink()) return true;
  const root = await realpath(dir);
  return !(await realpath(path)).startsWith(`${root}${sep}`);
}

/** How a rewritten file's original is put back over an agent's edit. */
export type RewriteKind = "cursor-hooks" | "claude-settings";

/** One file the gate rewrites for the turn. */
export interface WorkspaceFileRewrite {
  readonly path: string;
  readonly kind: RewriteKind;
  /** The bytes to restore; `null` when the file did not exist. */
  readonly original: string | null;
  /** The bytes the gate writes. */
  readonly written: string;
}

/** The `.claude` settings rewrites for the runner-owned folders: each file with a `hooks` key, without it. */
export async function claudeSettingsRewrites(folders: readonly WorkspaceFolder[]): Promise<WorkspaceFileRewrite[]> {
  const rewrites: WorkspaceFileRewrite[] = [];
  for (const folder of folders) {
    if (!folder.runnerOwned) continue;
    for (const name of CLAUDE_SETTINGS_FILES) {
      const path = join(folder.dir, CLAUDE_DIR, name);
      const original = await readOrNull(path);
      const parsed = parseObject(original);
      if (original === null || parsed === undefined || !("hooks" in parsed) || (await linkedOut(folder.dir, path))) continue;
      const { hooks: _hooks, ...rest } = parsed;
      rewrites.push({ path, kind: "claude-settings", original, written: `${JSON.stringify(rest, null, 2)}\n` });
    }
  }
  return rewrites;
}

/**
 * Snapshot the rewrites under the gate directory, then write each file. The
 * install restores any earlier snapshot first, so this one is the turn's own.
 */
export async function rewriteWorkspaceFiles(gateDir: string, rewrites: readonly WorkspaceFileRewrite[]): Promise<void> {
  const snapshotPath = join(gateDir, SNAPSHOT_FILE);
  await mkdir(gateDir, { recursive: true });
  const tmp = `${snapshotPath}.${process.pid}.tmp`;
  const snapshot: Snapshot = { writer: process.pid, writerStarted: PROCESS_STARTED, rewrites: [...rewrites] };
  await writeFile(tmp, JSON.stringify(snapshot), { encoding: "utf-8", mode: 0o600 });
  await rename(tmp, snapshotPath);
  for (const rewrite of rewrites) await writeFile(rewrite.path, rewrite.written, "utf-8");
}

/**
 * Put every snapshotted file back (see the header) and drop the snapshot.
 * Never throws: a file that cannot be restored is logged and the rest
 * still are.
 */
export async function restoreWorkspaceFiles(gateDir: string): Promise<void> {
  const snapshotPath = join(gateDir, SNAPSHOT_FILE);
  const { rewrites } = await readSnapshot(snapshotPath);
  for (const rewrite of rewrites) {
    try {
      await restoreOne(rewrite);
    } catch (err) {
      console.warn(`[workspace hooks] could not restore ${rewrite.path} (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  await rm(snapshotPath, { force: true });
}

/**
 * At a runner's boot: restore every gate directory's snapshot whose writer no
 * longer runs (see the header). Never throws: a gate directory that cannot be
 * read is logged and the rest still are.
 */
export async function restoreAbandonedWorkspaceFiles(gatesRoot: string): Promise<void> {
  let dirs: string[];
  try {
    dirs = await readdir(gatesRoot);
  } catch {
    return;
  }
  for (const dir of dirs) {
    const gateDir = join(gatesRoot, dir);
    const { writer, writerStarted, rewrites } = await readSnapshot(join(gateDir, SNAPSHOT_FILE));
    if (rewrites.length === 0 || (writer !== process.pid && isRunning(writer, writerStarted))) continue;
    console.log(`[workspace hooks] restoring the workspace files a stopped runner set aside (${gateDir})`);
    await restoreWorkspaceFiles(gateDir);
  }
}

/** When this process started, in epoch milliseconds. */
const PROCESS_STARTED = Date.now() - Math.round(process.uptime() * 1000);

/**
 * Whether the runner that wrote a snapshot still runs: its process lives and,
 * where `ps` can tell, started when the snapshot says (a process id can be
 * taken again by another process once its runner stopped). One this user may
 * not signal still runs.
 */
function isRunning(pid: number | undefined, started: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  return started === undefined || startedNear(pid, started);
}

/** Whether `ps` reports the process started within two seconds of `started`; true when it cannot tell. */
function startedNear(pid: number, started: number): boolean {
  try {
    const at = Date.parse(execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf-8" }).trim());
    return Number.isNaN(at) || Math.abs(at - started) <= 2000;
  } catch {
    return true;
  }
}

/** The snapshot file: the rewrites, and the runner process that wrote them, with when it started. */
interface Snapshot {
  readonly writer?: number;
  readonly writerStarted?: number;
  readonly rewrites: readonly WorkspaceFileRewrite[];
}

async function restoreOne(rewrite: WorkspaceFileRewrite): Promise<void> {
  // A link put in the file's place, or its directory's, during the turn
  // reaches a file the folder does not hold: never written through.
  if ((await isLink(rewrite.path)) || (await isLink(dirname(rewrite.path)))) {
    console.warn(`[workspace hooks] ${rewrite.path} became a link during the turn; it is left as it is`);
    return;
  }
  const current = await readOrNull(rewrite.path);
  if (rewrite.kind === "cursor-hooks") {
    if (current !== rewrite.written && current !== rewrite.original) {
      console.warn(`[workspace hooks] ${rewrite.path} was changed during the turn; it is outside the turn's review, so its original returns`);
    }
    await putBack(rewrite);
    return;
  }
  if (current === null) {
    // The agent deleted it: its edit, kept for the turn's review to show.
    if (rewrite.original !== null) console.log(`[workspace hooks] ${rewrite.path} was deleted during the turn; the deletion is kept`);
    return;
  }
  // The gate never got to write it: the file is as its owners left it.
  if (current === rewrite.original) return;
  if (current === rewrite.written) {
    await putBack(rewrite);
    return;
  }
  const edited = parseObject(current);
  if (edited === undefined) {
    console.warn(`[workspace hooks] ${rewrite.path} was changed during the turn and no longer parses; the change is kept as it is`);
    return;
  }
  const merged = withOriginalHooks(edited, parseObject(rewrite.original) ?? {});
  await writeFile(rewrite.path, `${JSON.stringify(merged, null, 2)}\n`, "utf-8");
  console.log(`[workspace hooks] ${rewrite.path} was changed during the turn; the change is kept, with the gate's own change undone`);
}

/**
 * The agent's edit of a settings file, with the `hooks` the gate set aside
 * put back (the gate rewrites only a file that has one) and any the agent
 * added kept beside them.
 */
function withOriginalHooks(edited: Record<string, unknown>, original: Record<string, unknown>): Record<string, unknown> {
  const originalHooks = original["hooks"];
  const editedHooks = edited["hooks"];
  if (!isObject(originalHooks) || !isObject(editedHooks)) return { ...edited, hooks: originalHooks };
  return { ...edited, hooks: mergedEntries(editedHooks, originalHooks) };
}

/** The original bytes back, or the file gone when there was none. */
async function putBack(rewrite: WorkspaceFileRewrite): Promise<void> {
  if (rewrite.original === null) await rm(rewrite.path, { force: true });
  else await writeFile(rewrite.path, rewrite.original, "utf-8");
}

/** Each event's original entries, then the edit's new ones. */
function mergedEntries(editedHooks: Record<string, unknown>, originalHooks: Record<string, unknown>): Record<string, unknown> {
  const hooks: Record<string, unknown> = {};
  for (const event of new Set([...Object.keys(originalHooks), ...Object.keys(editedHooks)])) {
    const kept = Array.isArray(originalHooks[event]) ? (originalHooks[event] as unknown[]) : [];
    const added = (Array.isArray(editedHooks[event]) ? (editedHooks[event] as unknown[]) : []).filter(
      (entry) => !kept.some((k) => JSON.stringify(k) === JSON.stringify(entry)),
    );
    if (kept.length > 0 || added.length > 0 || event in originalHooks) hooks[event] = [...kept, ...added];
  }
  return hooks;
}

async function readSnapshot(path: string): Promise<Snapshot> {
  const parsed = parseObject(await readOrNull(path));
  const rewrites = parsed !== undefined && Array.isArray(parsed["rewrites"]) ? (parsed["rewrites"].filter(isRewrite) as WorkspaceFileRewrite[]) : [];
  const writer = parsed?.["writer"];
  const writerStarted = parsed?.["writerStarted"];
  return {
    rewrites,
    ...(typeof writer === "number" ? { writer } : {}),
    ...(typeof writerStarted === "number" ? { writerStarted } : {}),
  };
}

function isRewrite(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value["path"] === "string" &&
    (value["kind"] === "cursor-hooks" || value["kind"] === "claude-settings") &&
    (value["original"] === null || typeof value["original"] === "string") &&
    typeof value["written"] === "string"
  );
}

async function isLink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false;
  }
}

async function readOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

function parseObject(text: string | null): Record<string, unknown> | undefined {
  if (text === null) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
