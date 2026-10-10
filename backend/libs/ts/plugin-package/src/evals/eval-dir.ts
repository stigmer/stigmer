/**
 * Where a plugin's eval suite lives: the one rule the suite reader and the
 * skill listing share, so a suite the reader grades from is exactly what
 * the skill archives leave out.
 *
 * The directory is `evals/`, or a Claude-shaped manifest's
 * `experimental.evals` when that is a relative path of plain directory
 * names (the first manifest in the set's order that carries the key). Any
 * other value is unusable and `evals/` is used, the format's rule; the
 * resolution says so, and the suite reader turns it into its finding.
 * Pinned through `__tests__/eval-suite.test.ts` and `__tests__/skills.test.ts`.
 */

import type { ManifestSet } from "../detect.js";
import { isContainedPath } from "../files.js";

/** The suite's directory when the manifest names none. */
export const DEFAULT_EVAL_DIR = "evals";

export interface EvalDirResolution {
  /** The plugin-relative suite directory. */
  readonly dir: string;
  /** The manifest's value when it was present and unusable, so `dir` fell back to `evals/`. */
  readonly unusable?: { readonly value: unknown; readonly manifest: string };
}

export function resolveEvalDir(set: ManifestSet | undefined): EvalDirResolution {
  const declared = set?.manifests.find((manifest) => manifest.evalsDir !== undefined)?.evalsDir;
  if (declared === undefined) return { dir: DEFAULT_EVAL_DIR };
  const { value, manifest } = declared;
  if (typeof value === "string" && isContainedPath(value)) return { dir: value };
  return { dir: DEFAULT_EVAL_DIR, unusable: { value, manifest } };
}
