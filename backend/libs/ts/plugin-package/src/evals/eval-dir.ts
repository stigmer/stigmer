/**
 * Where a plugin's eval suite lives: the one rule the suite reader and the
 * skill listing share, so a suite the reader grades from is exactly what
 * the skill archives leave out.
 *
 * The directory is `evals/`, or a Claude-shaped manifest's
 * `experimental.evals` when that is a relative path of plain directory
 * names (the first manifest in the set's order that carries the key) that
 * does not overlap the plugin's skills. Any other value is unusable and
 * `evals/` is used, the format's rule; the resolution says why, and the
 * suite reader turns it into its finding.
 *
 * Overlapping means the directory is `skills/` or a path any manifest
 * declares for skills, lies inside one, or holds one: the skill listing
 * leaves the suite out of every skill's files, so a suite there would strip
 * a skill, its `SKILL.md` included. A path declared as the plugin's root
 * (`./`, the whole plugin as one skill) is not counted, since every
 * directory lies inside it and the default `evals/` is left out of it the
 * same way. The runner's mount applies this rule to the archive's own
 * manifests (`runner` `shared/plugin-mount.ts` `manifestEvalDir`).
 * Pinned through `__tests__/eval-suite.test.ts` and `__tests__/skills.test.ts`.
 */

import type { ManifestSet } from "../detect.js";
import { isContainedPath } from "../files.js";

/** The suite's directory when the manifest names none. */
export const DEFAULT_EVAL_DIR = "evals";

/** The open format's fixed skills directory, read whatever the manifests declare. */
export const DEFAULT_SKILLS_DIR = "skills";

/** Why a manifest's `experimental.evals` was not used. */
export type EvalDirUnusableReason = "not-a-plain-path" | "overlaps-skills";

export interface EvalDirResolution {
  /** The plugin-relative suite directory. */
  readonly dir: string;
  /** The manifest's value when it was present and unusable, so `dir` fell back to `evals/`. */
  readonly unusable?: { readonly value: unknown; readonly manifest: string; readonly reason: EvalDirUnusableReason };
}

export function resolveEvalDir(set: ManifestSet | undefined): EvalDirResolution {
  const declared = set?.manifests.find((manifest) => manifest.evalsDir !== undefined)?.evalsDir;
  if (set === undefined || declared === undefined) return { dir: DEFAULT_EVAL_DIR };
  const { value, manifest } = declared;
  if (typeof value !== "string" || !isContainedPath(value)) {
    return { dir: DEFAULT_EVAL_DIR, unusable: { value, manifest, reason: "not-a-plain-path" } };
  }
  const skillDirs = [DEFAULT_SKILLS_DIR, ...set.manifests.flatMap((m) => m.skillPaths.map((p) => p.path))];
  if (skillDirs.some((skillDir) => skillDir !== "" && pathsOverlap(value, skillDir))) {
    return { dir: DEFAULT_EVAL_DIR, unusable: { value, manifest, reason: "overlaps-skills" } };
  }
  return { dir: value };
}

/** Whether one plugin-relative directory is the other or lies inside it. */
function pathsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
