/**
 * The workspace `.stigmer` symlink — the bridge from the session's workspace
 * to its platform-managed directory (~/.stigmer/sessions/{id}/platform/, see
 * platform-dir.ts), shared by BOTH harnesses.
 *
 * Platform-injected content (skills, the conversation's Files, eval inputs)
 * physically lives in the platform dir, outside the workspace, so a real repo
 * is never polluted with Stigmer files (issue #173). But the agent reads from
 * the workspace: the Cursor SDK resolves paths against the workspace CWD, and
 * shell commands on both harnesses run there. The symlink is what makes the
 * `.stigmer/…` paths those agents are prompted with (skill locations,
 * `.stigmer/uploads/…` Files) actually resolve. The native harness's
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
 *   the turn runtime creates it in its skill and File phases (which
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
 *
 * GIT: the link is made on every turn (the outputs folder is reached through
 * it), so in a workspace that is a git work tree it is kept out of the
 * person's repository: {@link ensureStigmerSymlink} adds `.stigmer` to the
 * repository's local exclude file (`info/exclude`), which git never commits
 * or pushes, as a cloned repository's provisioning already does
 * (`sources/git.ts`). A person's own folder would otherwise show the link as
 * untracked, and an agent's `git add -A` would commit it.
 */

import { agentFs, type AgentStats } from "../agent-fs.js";
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

  let entry: AgentStats | undefined;
  try {
    entry = await agentFs().lstat(linkPath);
  } catch (err) {
    if (errnoCode(err) !== "ENOENT") throw err;
  }

  if (entry?.isSymbolicLink()) {
    if ((await agentFs().readlink(linkPath)) === platformDir) return;
    await agentFs().unlink(linkPath);
  } else if (entry !== undefined) {
    await displaceRealEntry(linkPath, platformDir, entry);
  }

  await excludeFromGit(workspaceDir);
  await agentFs().symlink(platformDir, linkPath);
}

/**
 * Add `.stigmer` to the local exclude file of the git repository holding
 * `workspaceDir`, once (the module header, GIT). A workspace that is no git
 * work tree needs nothing; a repository whose exclude file cannot be written
 * is warned about and the link made all the same, since the platform's name
 * is more use to the turn than a clean `git status`.
 */
async function excludeFromGit(workspaceDir: string): Promise<void> {
  let reported: string;
  try {
    reported = (await agentFs().execFile("git", ["-C", workspaceDir, "rev-parse", "--git-path", "info/exclude"])).stdout
      .toString("utf8")
      .trim();
  } catch {
    return;
  }
  const excludePath = isAbsolute(reported) ? reported : join(workspaceDir, reported);
  try {
    let current = "";
    try {
      current = (await agentFs().readFile(excludePath)).toString("utf8");
    } catch (err) {
      if (errnoCode(err) !== "ENOENT") throw err;
    }
    if (current.split(/\r?\n/).some((line) => line.trim() === STIGMER_LOCAL_STATE_DIR)) return;
    await agentFs().mkdir(dirname(excludePath), { recursive: true });
    const separator = current === "" || current.endsWith("\n") ? "" : "\n";
    await agentFs().appendFile(excludePath, Buffer.from(`${separator}${STIGMER_LOCAL_STATE_DIR}\n`, "utf8"));
  } catch (err) {
    console.warn(
      `ensureStigmerSymlink: could not add ${STIGMER_LOCAL_STATE_DIR} to ${excludePath}, so git may show the link as untracked: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Clear a real `.stigmer` entry out of the link's place without losing it:
 * refuse the Stigmer home, remove an empty directory, move anything else.
 */
async function displaceRealEntry(linkPath: string, platformDir: string, entry: AgentStats): Promise<void> {
  if (entry.isDirectory()) {
    await refuseDirHoldingPlatform(linkPath, platformDir);
    if ((await agentFs().readdir(linkPath)).length === 0) {
      await agentFs().rmdir(linkPath);
      return;
    }
  }
  const destination = getDisplacedDir(platformDir, displacementStamp(new Date()));
  await agentFs().mkdir(dirname(destination), { recursive: true });
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
  const [realLink, realPlatform] = await Promise.all([agentFs().realpath(linkPath), agentFs().realpath(platformDir)]);
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
    await agentFs().rename(source, destination);
  } catch (err) {
    if (errnoCode(err) !== "EXDEV") throw err;
    await agentFs().cp(source, destination, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    await agentFs().rm(source, { recursive: true, force: true });
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
 * skill and no File creates no link, so this is also "does this turn
 * expose platform content at all" — the native harness mounts its read-only
 * `.stigmer/` route on exactly the turns where the link would resolve.
 */
export async function stigmerSymlinkPointsAt(workspaceDir: string, platformDir: string): Promise<boolean> {
  try {
    return (await agentFs().readlink(join(workspaceDir, STIGMER_LOCAL_STATE_DIR))) === platformDir;
  } catch {
    return false;
  }
}

/**
 * The real path an excluded `Read` may still reach files inside: the
 * platform dir's, on a turn whose workspace `.stigmer` is the link to it
 * ({@link stigmerSymlinkPointsAt}), else "". A turn that mounted no skill and
 * no File made no link and has no platform content, so a `.stigmer` there is
 * the repository's own and admits nothing. Read once per turn by the engines
 * that read real paths (Cursor's hook, `execute-cursor/hook-scope.ts`
 * `readRoot`; Claude's gate, `execute-claude/gate.ts`); the native engine
 * admits the platform's content by its own route instead
 * (`execute-deep-agent/platform-route.ts` `admitsRoutedRead`).
 */
export async function platformReadRoot(workspaceDir: string, platformDir: string): Promise<string> {
  if (!(await stigmerSymlinkPointsAt(workspaceDir, platformDir))) return "";
  return agentFs().realpath(platformDir);
}

/**
 * Whether a read of `absolutePath` opens the platform's content: its REAL
 * path lies inside `readRoot` ({@link platformReadRoot}). Real path, not
 * prefix: a repository's own `.stigmer` on an unlinked turn, or a link inside
 * platform content pointing out, would otherwise stretch the confinement to
 * any target. A missing file, or a turn with no root, admits nothing.
 * Cursor's hook runs the same test inline, in a process that cannot load
 * this module (`execute-cursor/hook-script.ts`).
 */
export async function readsPlatformContent(readRoot: string, absolutePath: string): Promise<boolean> {
  if (readRoot === "") return false;
  try {
    return (await agentFs().realpath(absolutePath)).startsWith(readRoot + sep);
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
    const stat = await agentFs().lstat(linkPath);
    if (stat.isSymbolicLink()) {
      await agentFs().unlink(linkPath);
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
