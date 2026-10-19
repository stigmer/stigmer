/**
 * Holds the session's platform folder to what one turn mounted. The folder
 * outlives a turn, and the workspace `.stigmer` link reaches it on every
 * turn (the outputs folder is there on every turn, `outputs.ts`), so a
 * skill or a plugin an earlier turn mounted would otherwise stay in reach
 * after the agent stopped listing it.
 *
 *  - `skills/<name>/`: a skill folder this turn did not resolve (the main
 *    agent's or a subagent's) is removed. The next turn that lists it again
 *    fetches it again.
 *  - `plugins/<digest>/` and `plugins/<digest>.zip`: a plugin this turn did
 *    not mount, for its skills or its hooks, loses its tree and its cached
 *    archive.
 *
 * `uploads/` is the File mount's (`file-mount.ts`), `outputs/` the agent's,
 * `inputs/` an eval case's, and `plugin-data/` each plugin's own writable
 * place, kept across turns: none is touched here. Every removal goes
 * through `agent-fs.ts`.
 */

import { join } from "node:path";

import { agentFs } from "./agent-fs.js";
import { PLUGINS_SUBDIR } from "./plugin-mount.js";
import { SKILLS_SUBDIR } from "./skill-mount.js";

/** What one turn mounted under the platform folder, by the names its folders carry. */
export interface PlatformMounts {
  /** Skill folder names under `skills/`. */
  readonly skills: readonly string[];
  /** Plugin archive digests, the names of their trees under `plugins/`. */
  readonly plugins: readonly string[];
}

/** A turn that mounted nothing. */
export const NO_MOUNTS: PlatformMounts = { skills: [], plugins: [] };

/** Remove every skill and plugin under `platformDir` that `mounts` does not name. */
export async function holdPlatformMounts(platformDir: string, mounts: PlatformMounts): Promise<void> {
  const skills = new Set(mounts.skills);
  for (const name of await namesIn(join(platformDir, SKILLS_SUBDIR))) {
    if (!skills.has(name)) await agentFs().rm(join(platformDir, SKILLS_SUBDIR, name), { recursive: true, force: true });
  }
  const plugins = new Set(mounts.plugins);
  for (const name of await namesIn(join(platformDir, PLUGINS_SUBDIR))) {
    const digest = name.endsWith(".zip") ? name.slice(0, -".zip".length) : name;
    if (!plugins.has(digest)) await agentFs().rm(join(platformDir, PLUGINS_SUBDIR, name), { recursive: true, force: true });
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
