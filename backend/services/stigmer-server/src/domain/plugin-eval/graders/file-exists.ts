/**
 * The `file_exists` grader: a file created during the run matches the
 * `path` glob, or, with `exists: false`, none does. Only files created in
 * the run count, as the format says: a file the run only modified is
 * invisible here. Where the install records no created files the grader
 * leaves the try not graded, never failed (verdict.ts).
 *
 * The glob is matched against workspace-relative paths: `*` and `?` stay
 * inside one path segment, `**` crosses segments (and `**` followed by `/`
 * also matches no directory at all), `[...]` is a class and `{a,b}` an
 * alternative. Globs are compiled here, in-thread: the compiled pattern
 * has no nested quantifier an author controls, so it needs no deadline.
 *
 * Proven by __tests__/graders.test.ts.
 */
import type { EvalGraderCheck } from "@stigmer/plugin-package";

import type { EvalTrace } from "../../score/eval/trace.js";
import type { GraderVerdict } from "./verdict.js";
import { FILES_NOT_RECORDED_REASON, normalisePath } from "./verdict.js";

type FileExistsCheck = Extract<EvalGraderCheck, { type: "file_exists" }>;

export function gradeFileExists(
  check: FileExistsCheck,
  trace: EvalTrace,
): GraderVerdict {
  if (trace.files.kind === "not-recorded") {
    return { notGraded: FILES_NOT_RECORDED_REASON };
  }
  const glob = normalisePath(check.path);
  const pattern = pathGlobToRegExp(glob);
  const matched = trace.files.created.filter((path) => pattern.test(normalisePath(path)));
  if (check.exists) {
    return matched.length > 0
      ? { passed: true, reason: `${matched.length} created file(s) match '${glob}'` }
      : { passed: false, reason: `no file created in the run matches '${glob}'` };
  }
  return matched.length === 0
    ? { passed: true, reason: `no file created in the run matches '${glob}'` }
    : { passed: false, reason: `${matched.length} created file(s) match '${glob}'` };
}

/** A path glob as an anchored regular expression (the module header's grammar). */
export function pathGlobToRegExp(glob: string): RegExp {
  let source = "";
  let braceDepth = 0;
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] ?? "";
    switch (char) {
      case "*": {
        if (glob[i + 1] === "*") {
          i++;
          if (glob[i + 1] === "/") {
            i++;
            source += "(?:.*/)?";
          } else {
            source += ".*";
          }
        } else {
          source += "[^/]*";
        }
        break;
      }
      case "?":
        source += "[^/]";
        break;
      case "[": {
        const close = glob.indexOf("]", i + 2);
        if (close === -1) {
          source += "\\[";
          break;
        }
        let body = glob.slice(i + 1, close);
        let negate = false;
        if (body.startsWith("!") || body.startsWith("^")) {
          negate = true;
          body = body.slice(1);
        }
        source += `[${negate ? "^" : ""}${body.replace(/[\\\]]/g, "\\$&")}]`;
        i = close;
        break;
      }
      case "{":
        braceDepth++;
        source += "(?:";
        break;
      case "}":
        if (braceDepth > 0) {
          braceDepth--;
          source += ")";
        } else {
          source += "\\}";
        }
        break;
      case ",":
        source += braceDepth > 0 ? "|" : ",";
        break;
      default:
        source += char.replace(/[.+^$()|\\]/g, "\\$&");
    }
  }
  source += ")".repeat(braceDepth);
  return new RegExp(`^${source}$`);
}
