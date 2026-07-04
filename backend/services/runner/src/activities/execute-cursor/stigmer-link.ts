/**
 * The workspace `.stigmer` symlink — the Cursor harness's bridge from the
 * user's workspace to the session's platform-managed directory
 * (~/.stigmer/sessions/{id}/platform/, see shared/workspace/platform-dir.ts).
 *
 * The Cursor SDK reads files from the workspace CWD, so platform-injected
 * content (skills, attachment inputs) must be reachable there; the symlink is
 * how, without ever writing platform files into the user's repo (issue #173).
 * This mechanism is deliberately harness-local: the native harness routes
 * `.stigmer/` paths through its WorkspaceBackend instead and never symlinks.
 *
 * Both resolvers that populate the platform dir (skills, attachments) call
 * {@link ensureStigmerSymlink}; it is idempotent, so either may run first and
 * an agent with only one kind of content still gets the link. The activity's
 * cleanup calls {@link removeStigmerSymlink} so a real repo is left untouched
 * once the turn ends; a multi-turn session recreates the link on the next turn.
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
 * Called in the activity's finally so attaching a real repo leaves no Stigmer
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
