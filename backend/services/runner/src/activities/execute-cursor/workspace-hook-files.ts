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
 * not only the one the SDK reads today.
 *
 * RESTORING. Every file the gate rewrites is snapshotted under the gate
 * directory, its original bytes beside the bytes the gate wrote, before it
 * is written ({@link rewriteWorkspaceFiles}). At the turn's end
 * ({@link restoreWorkspaceFiles}) a file that still holds what the gate
 * wrote gets its original back; a file the agent edited keeps the agent's
 * edit with the gate's own change undone (the set-aside hook entries
 * returned, any the agent added kept beside them, and the gate's removed),
 * with a log line; the turn's file review then sees what the agent changed.
 * A snapshot a crashed runner left behind is restored when the next runner
 * boots ({@link restoreAbandonedWorkspaceFiles}), before any turn pins the
 * tree its file review compares against; restored later, the files would
 * read as the agent's change. A snapshot names the runner that wrote it, so
 * a booting runner leaves alone one whose writer still runs (another runner
 * on the same machine, mid-turn). The next install restores any snapshot
 * still left, before anything else. The snapshot is the owner's alone (mode
 * 0600): a settings file can carry tokens in its `env`.
 */

import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

/** A Cursor turn on a person's own folder whose `.claude` settings carry hooks the SDK would run. */
export class CursorWorkspaceHooksRefusal extends Error {
  constructor(files: readonly string[]) {
    super(
      `${files.join(" and ")} ${files.length === 1 ? "carries" : "carry"} Claude Code hooks, which the Cursor engine ` +
        "would run beside the agent's own. Stigmer does not edit a folder of yours, so it cannot set them aside for the turn. " +
        "Run this session on Stigmer's native engine, or move the hooks out of the folder's .claude settings.",
    );
    this.name = "CursorWorkspaceHooksRefusal";
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

/** Refuse the turn when a person's own folder carries `.claude` hooks. Throws {@link CursorWorkspaceHooksRefusal}. */
export async function refuseOwnFolderHooks(folders: readonly WorkspaceFolder[]): Promise<void> {
  const files: string[] = [];
  for (const folder of folders) {
    if (!folder.runnerOwned) files.push(...(await claudeSettingsWithHooks(folder.dir)));
  }
  if (files.length > 0) throw new CursorWorkspaceHooksRefusal(files);
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
      if (original === null || parsed === undefined || !("hooks" in parsed)) continue;
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
  const snapshot: Snapshot = { writer: process.pid, rewrites: [...rewrites] };
  await writeFile(tmp, JSON.stringify(snapshot), { encoding: "utf-8", mode: 0o600 });
  await rename(tmp, snapshotPath);
  for (const rewrite of rewrites) await writeFile(rewrite.path, rewrite.written, "utf-8");
}

/**
 * Put every snapshotted file back (see the header) and drop the snapshot.
 * `isGateEntry` tells the gate's own `.cursor/hooks.json` entries from a
 * repository's. Never throws: a file that cannot be restored is logged and
 * the rest still are.
 */
export async function restoreWorkspaceFiles(gateDir: string, isGateEntry: (entry: unknown) => boolean): Promise<void> {
  const snapshotPath = join(gateDir, SNAPSHOT_FILE);
  const { rewrites } = await readSnapshot(snapshotPath);
  for (const rewrite of rewrites) {
    try {
      await restoreOne(rewrite, isGateEntry);
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
export async function restoreAbandonedWorkspaceFiles(gatesRoot: string, isGateEntry: (entry: unknown) => boolean): Promise<void> {
  let dirs: string[];
  try {
    dirs = await readdir(gatesRoot);
  } catch {
    return;
  }
  for (const dir of dirs) {
    const gateDir = join(gatesRoot, dir);
    const { writer, rewrites } = await readSnapshot(join(gateDir, SNAPSHOT_FILE));
    if (rewrites.length === 0 || (writer !== process.pid && isRunning(writer))) continue;
    console.log(`[workspace hooks] restoring the workspace files a stopped runner set aside (${gateDir})`);
    await restoreWorkspaceFiles(gateDir, isGateEntry);
  }
}

/** Whether a process runs; one this user may not signal still does. */
function isRunning(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The snapshot file: the rewrites, and the runner process that wrote them. */
interface Snapshot {
  readonly writer?: number;
  readonly rewrites: readonly WorkspaceFileRewrite[];
}

async function restoreOne(rewrite: WorkspaceFileRewrite, isGateEntry: (entry: unknown) => boolean): Promise<void> {
  const current = await readOrNull(rewrite.path);
  if (current === rewrite.written || current === null) {
    if (rewrite.original === null) await rm(rewrite.path, { force: true });
    else await writeFile(rewrite.path, rewrite.original, "utf-8");
    return;
  }
  const edited = parseObject(current);
  if (edited === undefined) {
    console.warn(`[workspace hooks] ${rewrite.path} was changed during the turn and no longer parses; the change is kept as it is`);
    return;
  }
  const original = parseObject(rewrite.original) ?? {};
  const merged = rewrite.kind === "claude-settings" ? withOriginalHooks(edited, original) : withRepositoryEntries(edited, original, isGateEntry);
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
  return { ...edited, hooks: mergedEntries(editedHooks, originalHooks, () => false) };
}

/** The agent's edit of `.cursor/hooks.json`, the gate's entries removed and the repository's set-aside ones returned. */
function withRepositoryEntries(
  edited: Record<string, unknown>,
  original: Record<string, unknown>,
  isGateEntry: (entry: unknown) => boolean,
): Record<string, unknown> {
  const editedHooks = isObject(edited["hooks"]) ? edited["hooks"] : {};
  const originalHooks = isObject(original["hooks"]) ? original["hooks"] : {};
  return { ...edited, hooks: mergedEntries(editedHooks, originalHooks, isGateEntry) };
}

/** Each event's original entries, then the edit's new ones that are not the gate's. */
function mergedEntries(
  editedHooks: Record<string, unknown>,
  originalHooks: Record<string, unknown>,
  isGateEntry: (entry: unknown) => boolean,
): Record<string, unknown> {
  const hooks: Record<string, unknown> = {};
  for (const event of new Set([...Object.keys(originalHooks), ...Object.keys(editedHooks)])) {
    const kept = Array.isArray(originalHooks[event]) ? (originalHooks[event] as unknown[]) : [];
    const added = (Array.isArray(editedHooks[event]) ? (editedHooks[event] as unknown[]) : []).filter(
      (entry) => !isGateEntry(entry) && !kept.some((k) => JSON.stringify(k) === JSON.stringify(entry)),
    );
    if (kept.length > 0 || added.length > 0 || event in originalHooks) hooks[event] = [...kept, ...added];
  }
  return hooks;
}

async function readSnapshot(path: string): Promise<Snapshot> {
  const parsed = parseObject(await readOrNull(path));
  const rewrites = parsed !== undefined && Array.isArray(parsed["rewrites"]) ? (parsed["rewrites"].filter(isRewrite) as WorkspaceFileRewrite[]) : [];
  const writer = parsed?.["writer"];
  return typeof writer === "number" ? { writer, rewrites } : { rewrites };
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
