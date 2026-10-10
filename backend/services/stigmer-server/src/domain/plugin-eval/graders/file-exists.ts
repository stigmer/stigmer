/**
 * The `file_exists` grader: a file created during the run matches the
 * `path` glob, or, with `exists: false`, none does. Only files created in
 * the run count, as the format says: a file the run only modified is
 * invisible here. Where the install records no created files the grader
 * leaves the try not graded, never failed (verdict.ts).
 *
 * The glob is matched against workspace-relative paths by the evals' one
 * matcher (../glob.ts, path mode): `*` and `?` stay inside one path
 * segment, `**` crosses segments (and `**` followed by `/` also matches no
 * directory at all), `[...]` is a class and `{a,b}` an alternative. The
 * matcher is linear in the glob and the path, so it runs in-thread with no
 * deadline. The suite reader refuses a malformed glob; one that still
 * reaches the grader leaves the try not graded, never failed.
 *
 * Proven by __tests__/graders.test.ts.
 */
import type { EvalGraderCheck } from "@stigmer/plugin-package";

import type { EvalTrace } from "../../score/eval/trace.js";
import { compileGlob } from "../glob.js";
import type { GraderVerdict } from "./verdict.js";
import {
  FILES_NOT_RECORDED_REASON,
  invalidPathGlobReason,
  normalisePath,
} from "./verdict.js";

type FileExistsCheck = Extract<EvalGraderCheck, { type: "file_exists" }>;

export function gradeFileExists(
  check: FileExistsCheck,
  trace: EvalTrace,
): GraderVerdict {
  if (trace.files.kind === "not-recorded") {
    return { notGraded: FILES_NOT_RECORDED_REASON };
  }
  const glob = normalisePath(check.path);
  const pattern = compileGlob(glob, "path");
  if (!pattern.ok) {
    return { notGraded: invalidPathGlobReason(glob, pattern.error) };
  }
  const matched = trace.files.created.filter((path) =>
    pattern.matches(normalisePath(path)),
  );
  if (check.exists) {
    return matched.length > 0
      ? {
          passed: true,
          reason: `${matched.length} created file(s) match '${glob}'`,
        }
      : {
          passed: false,
          reason: `no file created in the run matches '${glob}'`,
        };
  }
  return matched.length === 0
    ? { passed: true, reason: `no file created in the run matches '${glob}'` }
    : {
        passed: false,
        reason: `${matched.length} created file(s) match '${glob}'`,
      };
}
