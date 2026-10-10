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
 *    traversable but not listable, so the agent reaches its workspace and
 *    nothing beside it.
 *
 * A paused session then resumes with its workspace, checkpoints and
 * approvals; the `.stigmer` link is rebuilt each turn (`stigmer-link.ts`).
 * A marker under the runner's state makes the walk run once. Every later
 * boot only makes sure the workspace root exists and is the agent's.
 *
 * The runner does this as root, holding `CHOWN`, at boot, before the host
 * starts: no agent process runs yet, so nothing it planted can move under
 * the walk.
 */

import { existsSync, lchownSync, lstatSync, mkdirSync, readdirSync, renameSync, chmodSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

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

  mkdirSync(paths.workspaceRoot, { recursive: true });
  if (existsSync(marker)) {
    io.chown(paths.workspaceRoot, identity.uid, identity.gid);
    return { moved: [], firstTime: false };
  }

  const moved: string[] = [];
  if (runnerState !== agentState) {
    mkdirSync(agentState, { recursive: true });
    for (const name of AGENT_STATE_DIRS) {
      const from = join(runnerState, name);
      const to = join(agentState, name);
      if (!existsSync(from) || existsSync(to)) continue;
      move(from, to);
      moved.push(name);
    }
  }
  chownTree(agentState, identity, io);
  chownTree(paths.workspaceRoot, identity, io);
  for (const dir of ancestorsWithin(paths.runnerHome, paths.workspaceRoot)) chmodSync(dir, 0o711);

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

/** `lchown` `root` and everything under it; a link is changed itself and never followed. */
function chownTree(root: string, identity: AgentIdentity, io: HandoverIo): void {
  if (!existsSync(root)) return;
  const pending = [root];
  while (pending.length > 0) {
    const path = pending.pop()!;
    io.chown(path, identity.uid, identity.gid);
    if (lstatSync(path).isDirectory()) {
      for (const name of readdirSync(path)) pending.push(join(path, name));
    }
  }
}

/** The directories strictly between `home` and `target`, when `target` lies inside `home`'s `.stigmer`. */
function ancestorsWithin(home: string, target: string): string[] {
  const state = join(home, ".stigmer");
  const rel = relative(state, target);
  if (rel === "" || rel.startsWith("..") || rel.startsWith(sep)) return [];
  const dirs: string[] = [];
  for (let dir = dirname(target); dir.length >= state.length; dir = dirname(dir)) {
    dirs.push(dir);
    if (dir === state) break;
  }
  return dirs;
}
