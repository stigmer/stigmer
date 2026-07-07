/**
 * The workspace `.stigmer` symlink — the bridge from the session's workspace
 * to its platform-managed directory (~/.stigmer/sessions/{id}/platform/, see
 * platform-dir.ts), shared by BOTH harnesses.
 *
 * Platform-injected content (skills, attachment inputs, the approved plan)
 * physically lives in the platform dir, outside the workspace, so a real repo
 * is never polluted with Stigmer files (issue #173). But the agent reads from
 * the workspace: the Cursor SDK resolves paths against the workspace CWD, and
 * the native (deepagents) harness's file tools resolve against a
 * `FilesystemBackend` rooted at the workspace. The symlink is what makes the
 * `.stigmer/…` paths those agents are prompted with (skill locations,
 * `.stigmer/inputs/…` attachments) actually resolve.
 *
 * Lifecycle contract (same for both harnesses):
 * - Created per turn, under the workspace turn lock — the link is a
 *   working-tree mutation, and re-pointing it while another session's turn is
 *   running on a shared tree would redirect that turn's reads mid-flight.
 *   Cursor creates it in its skill/attachment resolvers (which run after lock
 *   acquisition); the native harness creates it right after acquiring the
 *   lock (execute-deep-agent/index.ts).
 * - Removed at turn end ({@link removeStigmerSymlink} in the activity's
 *   cleanup), so a real repo is left untouched once the turn ends; a
 *   multi-turn session recreates the link on the next turn.
 * - {@link ensureStigmerSymlink} is idempotent, so multiple populaters may
 *   run in any order within a turn.
 *
 * OWNERSHIP SHARP EDGE: the platform owns the `.stigmer` name inside a
 * workspace. {@link ensureStigmerSymlink} REPLACES a real (non-symlink)
 * `.stigmer` directory it finds there — deliberate, so a directory left
 * behind by an older runner can never shadow the platform mount. (A user's
 * own `.stigmer` content is unreachable anyway: the runner's
 * `LocalWorkspaceBackend` routes every `.stigmer/…` path to the platform
 * dir.) Turn-end removal is the conservative half: it only ever removes a
 * SYMLINK.
 */

import { symlink, readlink, unlink, rm, lstat } from "node:fs/promises";
import { join } from "node:path";

/** The workspace-visible name of the platform namespace. */
export const STIGMER_LOCAL_STATE_DIR = ".stigmer";

/**
 * Ensure the workspace `.stigmer` symlink points to the platform dir.
 * Idempotent: an existing correct link is kept; a stale link (or a non-link
 * left behind by an older runner) is replaced.
 */
export async function ensureStigmerSymlink(
  workspaceDir: string,
  platformDir: string,
): Promise<void> {
  const linkPath = join(workspaceDir, STIGMER_LOCAL_STATE_DIR);

  try {
    const existing = await readlink(linkPath);
    if (existing === platformDir) return;
    await unlink(linkPath);
  } catch (err: any) {
    if (err.code === "ENOENT") {
      // No existing symlink
    } else if (err.code === "EINVAL") {
      // Exists but is not a symlink — remove the directory
      await rm(linkPath, { recursive: true, force: true });
    } else {
      throw err;
    }
  }

  await symlink(platformDir, linkPath, "dir");
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
  } catch (err: any) {
    if (err?.code !== "ENOENT") {
      console.warn(
        `removeStigmerSymlink: failed to remove ${linkPath} (non-fatal): ` +
        `${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
