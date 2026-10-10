/**
 * What a grader answers, and the copy shared by every grader: a verdict
 * (passed or failed, with a reason the author reads beside the try), or
 * not graded with the reason the try is left out of every mean. A grader
 * is not graded only when the platform could not judge (a pattern past
 * its deadline, an install that records no files, a judge that failed),
 * never because the run did badly, so not graded is never a zero.
 *
 * Also the one reader of what a grader looks at (`focusText`): the final
 * message, the trace, the created paths, or one file's content after the
 * run, as the format's `target` and `focus` name them.
 *
 * Reasons count and name tools, paths and steps; they never quote what
 * the run wrote, which the author reads on the try's own page.
 */
import type { EvalFocus } from "@stigmer/plugin-package";

import type { EvalTrace } from "../../score/eval/trace.js";

/** A grader's answer (the module header). */
export type GraderVerdict =
  | { readonly passed: boolean; readonly reason: string }
  | { readonly notGraded: string };

/** Whether `verdict` left its grader not graded. */
export function isNotGraded(
  verdict: GraderVerdict,
): verdict is { readonly notGraded: string } {
  return "notGraded" in verdict;
}

/** The not-graded reason of a pattern that ran past its deadline. */
export const PATTERN_TIME_LIMIT_REASON = "pattern exceeded its time limit";

/** The not-graded reason of a file grader where no created file is recorded. */
export const FILES_NOT_RECORDED_REASON =
  "this install does not record created files";

/** The not-graded reason of a grader over mock calls, which Stigmer does not run yet. */
export const MOCK_CALLS_NOT_RUN_REASON = "mock_calls are not run yet";

/** The not-graded reason of a pattern JavaScript refuses. */
export function invalidPatternReason(message: string): string {
  return `the pattern is not a valid JavaScript regular expression: ${message}`;
}

/** The not-graded reason of a file a grader cannot read as text. */
export function binaryFileReason(path: string): string {
  return `'${path}' is a binary file, which this check cannot read`;
}

/** The failed reason of a file target that was not there after the run. */
export function fileAbsentReason(path: string): string {
  return `'${path}' does not exist after the run`;
}

/** How a focus is named in a reason. */
export function focusLabel(focus: EvalFocus): string {
  switch (focus.kind) {
    case "last_message":
      return "the final message";
    case "trace":
      return "the trace";
    case "files":
      return "the created paths";
    case "file":
      return `'${focus.path}'`;
    case "mock_calls":
      return "the mock calls";
    default: {
      const exhausted: never = focus;
      return exhausted;
    }
  }
}

/** A workspace-relative path as the capture records it: no leading "./". */
export function normalisePath(path: string): string {
  let normalised = path.trim();
  while (normalised.startsWith("./")) {
    normalised = normalised.slice(2);
  }
  return normalised;
}

/**
 * The text a focus names in `trace`, or the verdict when there is none to
 * read: a file that was not created fails, a binary or unreadable file and
 * an install that records no files leave the grader not graded.
 */
export function focusText(
  focus: EvalFocus,
  trace: EvalTrace,
): { readonly text: string } | GraderVerdict {
  switch (focus.kind) {
    case "last_message":
      return { text: trace.lastMessage };
    case "trace":
      return { text: trace.traceLines.join("\n") };
    case "files":
      if (trace.files.kind === "not-recorded") {
        return { notGraded: FILES_NOT_RECORDED_REASON };
      }
      return { text: trace.files.created.join("\n") };
    case "file": {
      if (trace.files.kind === "not-recorded") {
        return { notGraded: FILES_NOT_RECORDED_REASON };
      }
      const path = normalisePath(focus.path);
      const content = trace.files.contents.get(path) ?? { kind: "absent" };
      switch (content.kind) {
        case "text":
          return { text: content.text };
        case "absent":
          return { passed: false, reason: fileAbsentReason(path) };
        case "binary":
          return { notGraded: binaryFileReason(path) };
        case "unreadable":
          return { notGraded: content.reason };
        default: {
          const exhausted: never = content;
          return exhausted;
        }
      }
    }
    case "mock_calls":
      return { notGraded: MOCK_CALLS_NOT_RUN_REASON };
    default: {
      const exhausted: never = focus;
      return exhausted;
    }
  }
}
