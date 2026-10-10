/**
 * The one-time handover of the agent's files to the agent user, when a
 * runner first starts separating (#2016). Before, the agent's side ran as
 * the runner's own user, so its state and its workspace are the runner's:
 *
 *  - `sessions` and `hitl-gate` under the runner's `~/.stigmer` (each
 *    session's platform directory, checkpoints, pending approvals) move
 *    into the agent's home, where the host now looks for them
 *    (`agent-identity.ts` `agentStateHome`);
 *  - that state and the workspace root become the agent's, every entry
 *    changed in place with `lchown`, never followed through a link;
 *  - the directories between the runner's home and a workspace root inside
 *    its state (the chart's `/data/.stigmer/data/workspace`) become 0711,
 *    traversable but not listable, so the agent reaches its workspace but
 *    cannot list what lies beside it. A sibling whose name it knows stays
 *    as reachable as its own mode makes it: compose's artifact volume
 *    (`/data/.stigmer/data/artifacts`, the server's, 0755) among them.
 *
 * A paused session then resumes with its workspace, checkpoints and
 * approvals; the `.stigmer` link is rebuilt each turn (`stigmer-link.ts`).
 * A marker under the runner's state makes the walk run once. Every later
 * boot only makes sure the agent's home and the workspace root exist and
 * are the agent's (the directories themselves).
 *
 * The runner does this as root, holding `CHOWN`, at boot, before the host
 * starts: no agent process runs yet, so nothing it planted can move under
 * the walk.
 */

import { existsSync, lchownSync, lstatSync, mkdirSync, readdirSync, renameSync, chmodSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";

import type { AgentIdentity } from "./agent-identity.js";

/** The marker that says the handover ran (its version, should the layout move again). */
export const HANDOVER_MARKER = "agent-handover-v1";

/** The agent's state directories under `~/.stigmer`. */
const AGENT_STATE_DIRS = ["sessions", "hitl-gate"] as const;

export interface HandoverIo {
  readonly chown: (path: string, uid: number, gid: number) => void;
}

/** Hand the agent's files to `identity`; returns what it moved, for the boot log. */
export function handOverToAgent(
  identity: AgentIdentity,
  paths: { readonly runnerHome: string; readonly workspaceRoot: string },
  io: HandoverIo = { chown: lchownSync },
): { readonly moved: readonly string[]; readonly firstTime: boolean } {
  const runnerState = join(paths.runnerHome, ".stigmer");
  const agentState = join(identity.home, ".stigmer");
  const marker = join(runnerState, HANDOVER_MARKER);

  if (runnerState === agentState) {
    throw new Error(`the agent's home (${identity.home}) is the runner's own; set STIGMER_AGENT_HOME to a directory of the agent's own`);
  }
  // The walk hands the agent's home over whole, so it may hold none of the
  // runner's own files: not the runner's home (an agent home of `/`, or a
  // volume root above it), and not a place inside the runner's state.
  if (within(identity.home, paths.runnerHome) || within(runnerState, identity.home)) {
    throw new Error(`the agent's home (${identity.home}) would hold the runner's own files (${runnerState}); set STIGMER_AGENT_HOME to a directory of the agent's own, outside the runner's state`);
  }
  mkdirSync(paths.workspaceRoot, { recursive: true });
  mkdirSync(identity.home, { recursive: true, mode: 0o700 });
  // Already handed over: the marker says so, or (where the runner's own home
  // does not persist, a sandbox's) nothing is left to move and the workspace
  // is the agent's already. Only the two directories themselves are made
  // sure of; the walk over a workspace runs once, not at every wake.
  const handedOver =
    existsSync(marker) ||
    (!AGENT_STATE_DIRS.some((name) => existsSync(join(runnerState, name))) && lstatSync(paths.workspaceRoot).uid === identity.uid);
  if (handedOver) {
    io.chown(identity.home, identity.uid, identity.gid);
    io.chown(paths.workspaceRoot, identity.uid, identity.gid);
    refuseUnreachableWorkspace(identity, paths);
    return { moved: [], firstTime: false };
  }

  // Nothing is the agent's while the walk works in it: the agent's home is
  // taken back to root first, the state moved in, and everything handed to
  // the agent last.
  const moved: string[] = [];
  io.chown(identity.home, 0, 0);
  mkdirSync(agentState, { recursive: true });
  for (const name of AGENT_STATE_DIRS) {
    const from = join(runnerState, name);
    const to = join(agentState, name);
    if (!existsSync(from) || existsSync(to)) continue;
    move(from, to);
    moved.push(name);
  }
  chownTree(identity.home, identity, io);
  chownTree(paths.workspaceRoot, identity, io);
  for (const dir of ancestorsWithin(paths.runnerHome, paths.workspaceRoot)) chmodSync(dir, 0o711);
  refuseUnreachableWorkspace(identity, paths);

  mkdirSync(runnerState, { recursive: true });
  writeFileSync(marker, `${new Date().toISOString()}\n`, { mode: 0o600 });
  return { moved, firstTime: true };
}

function move(from: string, to: string): void {
  try {
    renameSync(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    cpSync(from, to, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
    rmSync(from, { recursive: true, force: true });
  }
}

/**
 * `lchown` `root` and everything under it to the agent; a link is changed
 * itself and never followed. A directory is taken back to root before it is
 * listed (one the agent already owns, from a handover cut short, may be
 * closed to root) and handed over after its contents.
 */
function chownTree(root: string, identity: AgentIdentity, io: HandoverIo): void {
  const pending: { readonly path: string; readonly listed: boolean }[] = [{ path: root, listed: false }];
  while (pending.length > 0) {
    const { path, listed } = pending.pop()!;
    if (listed || !lstatSync(path).isDirectory()) {
      io.chown(path, identity.uid, identity.gid);
      continue;
    }
    io.chown(path, 0, 0);
    pending.push({ path, listed: true });
    for (const name of readdirSync(path)) pending.push({ path: join(path, name), listed: false });
  }
}

/**
 * A workspace root inside the runner's home must be reachable by the agent
 * through every directory from that home down: the walk opens only those
 * inside `~/.stigmer`, and the home itself is the operator's (a driver's
 * `/root` is 0700). The runner's default workspace,
 * `~/.stigmer/workspaces/runner`, lies there, so a container runner that
 * names no `WORKSPACE_ROOT_DIR` refuses to start, naming it, instead of
 * running every turn on a workspace its agent cannot open.
 */
function refuseUnreachableWorkspace(identity: AgentIdentity, paths: { readonly runnerHome: string; readonly workspaceRoot: string }): void {
  if (paths.workspaceRoot === paths.runnerHome || !within(paths.runnerHome, paths.workspaceRoot)) return;
  for (let dir = dirname(paths.workspaceRoot); ; dir = dirname(dir)) {
    const stats = lstatSync(dir);
    if (stats.uid !== identity.uid && (stats.mode & 0o001) === 0) {
      throw new Error(
        `the workspace root ${paths.workspaceRoot} is out of the agent's reach: ${dir} (mode ${(stats.mode & 0o777).toString(8).padStart(4, "0")}) is closed to it; set WORKSPACE_ROOT_DIR to a directory outside the runner's home`,
      );
    }
    if (dir === paths.runnerHome || dir === dirname(dir)) return;
  }
}

/** Whether `path` is `dir` or lies inside it (a name inside that merely starts with `..` included). */
function within(dir: string, path: string): boolean {
  const rel = relative(dir, path);
  return !(rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel));
}

/** The directories strictly between `home` and `target`, when `target` lies inside `home`'s `.stigmer`. */
function ancestorsWithin(home: string, target: string): string[] {
  const state = join(home, ".stigmer");
  if (target === state || !within(state, target)) return [];
  const dirs: string[] = [];
  for (let dir = dirname(target); dir.length >= state.length; dir = dirname(dir)) {
    dirs.push(dir);
    if (dir === state) break;
  }
  return dirs;
}
