/**
 * Holds the session's platform folder to what one turn mounted. The folder
 * outlives a turn, and the workspace `.stigmer` link reaches it on every
 * turn (the outputs folder is there on every turn, `outputs.ts`), so a
 * skill or a plugin an earlier turn mounted would otherwise stay in reach
 * after the agent stopped listing it.
 *
 *  - `skills/<name>`: a skill tree (or the link to it) this turn did not
 *    mount (the main agent's or a subagent's) is removed. The next turn that
 *    lists it again mounts it again.
 *  - `plugins/<digest>`: a plugin tree (or link) this turn did not mount,
 *    for its skills or its hooks, is removed.
 *  - `archives/<sha256>.zip`: a cached archive this turn did not use.
 *  - The session's runner-owned trees under `/runner/mounts`
 *    (`archive-tree.ts`): a tree this turn did not mount, removed by the
 *    runner with its own rights.
 *
 * A conversation without a computer mounts nothing, so its folder holds
 * none of them. `uploads/` is the File mount's (`file-mount.ts`), `outputs/`
 * the agent's, `inputs/` an eval case's, and `plugin-data/` each plugin's
 * own writable place, kept across turns: none is touched here. Every
 * removal in the platform folder goes through `agent-fs.ts`.
 */

import { join } from "node:path";

import { agentFs } from "./agent-fs.js";
import { ARCHIVES_SUBDIR, holdSessionTrees } from "./archive-tree.js";
import { PLUGINS_SUBDIR } from "./plugin-mount.js";
import { SKILLS_SUBDIR } from "./skill-mount.js";

/** What one turn mounted under the platform folder, by the names its folders carry. */
export interface PlatformMounts {
  /** Skill folder names under `skills/`. */
  readonly skills: readonly string[];
  /** Plugin archive digests, the names of their trees under `plugins/`. */
  readonly plugins: readonly string[];
  /** Content hashes of the archives kept under `archives/`. */
  readonly archives: readonly string[];
  /** Keys of the trees mounted (`archive-tree.ts`), the names of the runner-owned ones. */
  readonly trees: readonly string[];
}

/** A turn that mounted nothing. */
export const NO_MOUNTS: PlatformMounts = { skills: [], plugins: [], archives: [], trees: [] };

/** Every mount of `mounts`, as one. */
export function mergeMounts(mounts: readonly PlatformMounts[]): PlatformMounts {
  return {
    skills: mounts.flatMap((mount) => mount.skills),
    plugins: mounts.flatMap((mount) => mount.plugins),
    archives: mounts.flatMap((mount) => mount.archives),
    trees: mounts.flatMap((mount) => mount.trees),
  };
}

/** Remove every skill, plugin, cached archive and runner-owned tree of the session that `mounts` does not name. */
export async function holdPlatformMounts(sessionId: string, platformDir: string, mounts: PlatformMounts): Promise<void> {
  await keepOnly(join(platformDir, SKILLS_SUBDIR), new Set(mounts.skills));
  await keepOnly(join(platformDir, PLUGINS_SUBDIR), new Set(mounts.plugins));
  await keepOnly(join(platformDir, ARCHIVES_SUBDIR), new Set(mounts.archives.map((sha) => `${sha}.zip`)));
  await holdSessionTrees(sessionId, mounts.trees);
}

/** Remove every entry directly in `dir` that `keep` does not name. */
async function keepOnly(dir: string, keep: ReadonlySet<string>): Promise<void> {
  for (const name of await namesIn(dir)) {
    if (!keep.has(name)) await agentFs().rm(join(dir, name), { recursive: true, force: true });
  }
}

/** The entries directly in `dir`; none when it is absent. */
async function namesIn(dir: string): Promise<string[]> {
  try {
    return (await agentFs().readdir(dir)).map((entry) => entry.name);
  } catch {
    return [];
  }
}
