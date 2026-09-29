/**
 * The workspace `.stigmer` symlink — the bridge from the session's workspace
 * to its platform-managed directory (~/.stigmer/sessions/{id}/platform/, see
 * platform-dir.ts), shared by BOTH harnesses.
 *
 * Platform-injected content (skills, attachment inputs, the approved plan)
 * physically lives in the platform dir, outside the workspace, so a real repo
 * is never polluted with Stigmer files (issue #173). But the agent reads from
 * the workspace: the Cursor SDK resolves paths against the workspace CWD, and
 * shell commands on both harnesses run there. The symlink is what makes the
 * `.stigmer/…` paths those agents are prompted with (skill locations,
 * `.stigmer/inputs/…` attachments) actually resolve. The native harness's
 * FILE tools are the exception: their virtual-rooted backend refuses a path
 * whose real location leaves the workspace, so they reach `.stigmer/` through
 * a route instead (`activities/execute-deep-agent/platform-route.ts`),
 * mounted on every turn and exposing the platform dir on exactly the turns
 * this link exists ({@link stigmerSymlinkPointsAt}).
 *
 * Lifecycle contract (same for both harnesses):
 * - Created per turn, under the workspace turn lock — the link is a
 *   working-tree mutation, and re-pointing it while another session's turn is
 *   running on a shared tree would redirect that turn's reads mid-flight.
 *   the turn runtime creates it in its skill and attachment phases (which
 *   run after lock acquisition), for both harnesses; until #1096 the native
 *   orchestrator created it unconditionally right after the lock.
 * - Removed at turn end ({@link removeStigmerSymlink} in the activity's
 *   cleanup), so a real repo is left untouched once the turn ends; a
 *   multi-turn session recreates the link on the next turn.
 * - {@link ensureStigmerSymlink} is idempotent, so multiple populaters may
 *   run in any order within a turn.
 *
 * OWNERSHIP: the platform owns the `.stigmer` name inside a workspace, but
 * never deletes what it did not make. A real (non-symlink) `.stigmer` entry
 * found where the link goes — left by an older runner, or written by a shell
 * command or a Cursor edit on a turn with no link, where nothing sits between
 * those tools and the disk (#1123) — is MOVED out of the workspace to the
 * session's `displaced/` dir (platform-dir.ts `getDisplacedDir`) and named in
 * a warning; an empty directory is simply removed. Out of the workspace
 * because a write-back commits everything the tree holds (`git add -A`) and
 * git excludes only the exact `.stigmer` name. One case is refused outright:
 * a `.stigmer` that is, or holds, the platform dir itself — a workspace
 * rooted at the home directory, whose `.stigmer` is the Stigmer home (#1424).
 * Turn-end removal is the conservative half: it only ever removes a SYMLINK.
 */

import { cp, lstat, mkdir, readdir, readlink, realpath, rename, rm, rmdir, symlink, unlink } from "node:fs/promises";
import type { Stats } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { getDisplacedDir } from "./platform-dir.js";

/** The workspace-visible name of the platform namespace. */
export const STIGMER_LOCAL_STATE_DIR = ".stigmer";

/**
 * Ensure the workspace `.stigmer` symlink points to the platform dir.
 * Idempotent: an existing correct link is kept and a stale link is
 * re-pointed. A real entry in the link's place is moved to the session's
 * `displaced/` dir first (an empty directory is removed); a real `.stigmer`
 * that holds the platform dir is refused with an error naming it, before
 * anything is touched. See the module header, OWNERSHIP.
 */
export async function ensureStigmerSymlink(
  workspaceDir: string,
  platformDir: string,
): Promise<void> {
  const linkPath = join(workspaceDir, STIGMER_LOCAL_STATE_DIR);

  let entry: Stats | undefined;
  try {
    entry = await lstat(linkPath);
  } catch (err) {
    if (errnoCode(err) !== "ENOENT") throw err;
  }

  if (entry?.isSymbolicLink()) {
    if ((await readlink(linkPath)) === platformDir) return;
    await unlink(linkPath);
  } else if (entry !== undefined) {
    await displaceRealEntry(linkPath, platformDir, entry);
  }

  await symlink(platformDir, linkPath, "dir");
}

/**
 * Clear a real `.stigmer` entry out of the link's place without losing it:
 * refuse the Stigmer home, remove an empty directory, move anything else.
 */
async function displaceRealEntry(linkPath: string, platformDir: string, entry: Stats): Promise<void> {
  if (entry.isDirectory()) {
    await refuseDirHoldingPlatform(linkPath, platformDir);
    if ((await readdir(linkPath)).length === 0) {
      await rmdir(linkPath);
      return;
    }
  }
  const destination = getDisplacedDir(platformDir, displacementStamp(new Date()));
  await mkdir(dirname(destination), { recursive: true });
  await moveEntry(linkPath, destination);
  console.warn(
    `ensureStigmerSymlink: moved the real ${linkPath} out of the workspace to ${destination}; ` +
    "the platform owns the .stigmer name, so the link to the session's platform dir takes its place",
  );
}

/**
 * Throw when the real `.stigmer` directory is, or contains, the platform dir:
 * a workspace rooted at the home directory resolves `.stigmer` to the Stigmer
 * home, where the platform dir, the CLI's config and every session live.
 * Compared by real path, so a symlinked or `HOME`-overridden spelling of
 * either side cannot slip past.
 */
async function refuseDirHoldingPlatform(linkPath: string, platformDir: string): Promise<void> {
  const [realLink, realPlatform] = await Promise.all([realpath(linkPath), realpath(platformDir)]);
  const fromLink = relative(realLink, realPlatform);
  const outside = fromLink === ".." || fromLink.startsWith(`..${sep}`) || isAbsolute(fromLink);
  if (!outside) {
    throw new Error(
      `The workspace's ${linkPath} is the Stigmer home (it holds this session's platform dir, ${platformDir}); ` +
      "use a project directory as the workspace, not the home directory",
    );
  }
}

/** Rename, or copy then remove when the destination is on another filesystem (a cloud workspace volume and `$HOME` are). */
async function moveEntry(source: string, destination: string): Promise<void> {
  try {
    await rename(source, destination);
  } catch (err) {
    if (errnoCode(err) !== "EXDEV") throw err;
    await cp(source, destination, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    await rm(source, { recursive: true, force: true });
  }
}

/** A compact UTC stamp with milliseconds (`20260929T101500123Z`): sortable, and free of the colons a path should not carry. */
function displacementStamp(now: Date): string {
  return now.toISOString().replace(/[-:.]/g, "");
}

/** The errno code of a Node filesystem error, or `undefined` for anything else. */
function errnoCode(err: unknown): string | undefined {
  if (typeof err !== "object" || err === null || !("code" in err)) return undefined;
  return typeof err.code === "string" ? err.code : undefined;
}

/**
 * Whether the workspace's `.stigmer` is, right now, the link
 * {@link ensureStigmerSymlink} makes to `platformDir`. A turn that mounts no
 * skill and no attachment creates no link, so this is also "does this turn
 * expose platform content at all" — the native harness mounts its read-only
 * `.stigmer/` route on exactly the turns where the link would resolve.
 */
export async function stigmerSymlinkPointsAt(workspaceDir: string, platformDir: string): Promise<boolean> {
  try {
    return (await readlink(join(workspaceDir, STIGMER_LOCAL_STATE_DIR))) === platformDir;
  } catch {
    return false;
  }
}

/**
 * Remove the workspace `.stigmer` symlink created by
 * {@link ensureStigmerSymlink}.
 *
 * Called in the activity's cleanup so attaching a real repo leaves no Stigmer
 * symlink behind once the turn ends (issue #173). Only ever removes a
 * SYMLINK — a real `.stigmer` directory (which would be the user's own, not
 * ours) is left untouched. Best-effort.
 */
export async function removeStigmerSymlink(workspaceDir: string): Promise<void> {
  const linkPath = join(workspaceDir, STIGMER_LOCAL_STATE_DIR);
  try {
    const stat = await lstat(linkPath);
    if (stat.isSymbolicLink()) {
      await unlink(linkPath);
    }
  } catch (err) {
    if (errnoCode(err) !== "ENOENT") {
      console.warn(
        `removeStigmerSymlink: failed to remove ${linkPath} (non-fatal): ` +
        `${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
