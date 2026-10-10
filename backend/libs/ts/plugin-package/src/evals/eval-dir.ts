/**
 * Where a plugin's eval suite lives: the one rule the suite reader and the
 * skill listing share, so a suite the reader grades from is exactly what
 * the skill archives leave out.
 *
 * The directory is `evals/`, or a Claude-shaped manifest's
 * `experimental.evals` when that is a relative path of plain directory
 * names (the first manifest in the set's order that carries the key) that
 * does not overlap the plugin's skills. The value is written with or
 * without a `./` prefix, which is stripped, and may be an array, whose
 * first entry is used, as Claude Code's manifest reference reads it. A
 * path longer than {@link EVAL_DIR_MAX_LENGTH} characters is refused, since
 * the plugin stores it whole. Any other value is unusable and
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
 * manifests (`runner` `shared/plugin-mount.ts` `manifestEvalDir`), and
 * both run one shared table (`__tests__/fixtures/eval-dir-parity.json`).
 *
 * The default can overlap too: a manifest may declare skills under
 * `./evals/`. Then the plugin has no usable suite directory (unless a
 * usable `experimental.evals` moves it clear), the resolution names the
 * skill path that holds it, the skill listing strips nothing, so no skill
 * loses its files, and the suite reader reads no case.
 * Pinned through `__tests__/eval-suite.test.ts` and `__tests__/skills.test.ts`.
 */

import type { ManifestSet } from "../detect.js";
import { isContainedPath } from "../files.js";

/** The suite's directory when the manifest names none. */
export const DEFAULT_EVAL_DIR = "evals";

/** The open format's fixed skills directory, read whatever the manifests declare. */
export const DEFAULT_SKILLS_DIR = "skills";

/** The longest suite directory a manifest may name, in UTF-16 code units: the longest case directory the reader takes. */
export const EVAL_DIR_MAX_LENGTH = 1024;

/** Why a manifest's `experimental.evals` was not used. */
export type EvalDirUnusableReason = "not-a-plain-path" | "overlaps-skills";

export interface EvalDirResolution {
  /** The plugin-relative suite directory. */
  readonly dir: string;
  /** The manifest's value when it was present and unusable, so `dir` fell back to `evals/`. */
  readonly unusable?: { readonly value: unknown; readonly manifest: string; readonly reason: EvalDirUnusableReason };
  /** The declared skill path the default `dir` overlaps, and its manifest: the plugin then has no suite. */
  readonly heldBySkills?: { readonly path: string; readonly manifest: string };
}

export function resolveEvalDir(set: ManifestSet | undefined): EvalDirResolution {
  const declared = set?.manifests.find((manifest) => manifest.evalsDir !== undefined)?.evalsDir;
  if (set === undefined) return { dir: DEFAULT_EVAL_DIR };
  if (declared === undefined) return defaultDir(set);
  const { value, manifest } = declared;
  const dir = declaredEvalDir(value);
  if (dir === undefined) {
    return defaultDir(set, { value, manifest, reason: "not-a-plain-path" });
  }
  const skillDirs = [DEFAULT_SKILLS_DIR, ...set.manifests.flatMap((m) => m.skillPaths.map((p) => p.path))];
  if (skillDirs.some((skillDir) => skillDir !== "" && pathsOverlap(dir, skillDir))) {
    return defaultDir(set, { value, manifest, reason: "overlaps-skills" });
  }
  return { dir };
}

/**
 * The plugin-relative directory a manifest's `experimental.evals` names:
 * an array's first entry, one `./` prefix stripped, then a path of plain
 * directory names no longer than {@link EVAL_DIR_MAX_LENGTH}; `undefined`
 * for anything else.
 */
function declaredEvalDir(value: unknown): string | undefined {
  const entry: unknown = Array.isArray(value) ? value[0] : value;
  if (typeof entry !== "string") return undefined;
  const path = entry.startsWith("./") ? entry.slice(2) : entry;
  return path.length <= EVAL_DIR_MAX_LENGTH && isContainedPath(path) ? path : undefined;
}

/** `evals/`, with why the manifest's value was not used, and the declared skill path that holds it, if any. */
function defaultDir(set: ManifestSet, unusable?: EvalDirResolution["unusable"]): EvalDirResolution {
  const held = set.manifests.flatMap((m) => m.skillPaths).find((p) => p.path !== "" && pathsOverlap(DEFAULT_EVAL_DIR, p.path));
  return {
    dir: DEFAULT_EVAL_DIR,
    ...(unusable !== undefined && { unusable }),
    ...(held !== undefined && { heldBySkills: { path: held.path, manifest: held.manifest } }),
  };
}

/** Whether one plugin-relative directory is the other or lies inside it. */
function pathsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
