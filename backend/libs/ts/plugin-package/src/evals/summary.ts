/**
 * The eval suite as a plugin stores it: what the plugin page and the CLI
 * list before anyone runs it, bounded so the plugin's row stays within one
 * API message.
 *
 * An archive may hold up to its entry limit of files with long names, and
 * every case and finding would otherwise ride on the plugin's status. So
 * the summary keeps the first {@link EVAL_SUMMARY_MAX_CASES} cases and the
 * first {@link EVAL_SUMMARY_MAX_FINDINGS} findings, in the reader's order,
 * the first {@link EVAL_SUMMARY_MAX_CASE_TAGS} tags of each case, and cuts
 * every text it copies from the suite (a case's name, directory and tags,
 * a finding's path) to {@link EVAL_SUMMARY_MAX_TEXT} characters and an
 * ellipsis. A finding's path is cut in its message too, where the message
 * starts with it, and the message is then cut to
 * {@link EVAL_SUMMARY_MAX_MESSAGE}: longer than the other texts, since it
 * holds the cut path and then the problem, which quotes up to
 * {@link EVAL_SUMMARY_MAX_TEXT} characters of a value itself. The
 * suite's tags are every case's kept tags, cut, once each. `caseCount`
 * still counts every case, and the suite's directory is copied whole: the
 * runner leaves it out of every mount, and the reader bounds it. The eval
 * itself reads the archive again, so nothing a run needs is cut.
 *
 * Pinned by `__tests__/eval-summary.test.ts`.
 */

import { cutText, excerpt, QUOTED_TEXT_LIMIT } from "./fields.js";
import type { EvalSuite, EvalSuiteFinding } from "./types.js";

/** The most cases a stored summary lists. */
export const EVAL_SUMMARY_MAX_CASES = 200;

/** The most findings a stored summary keeps. */
export const EVAL_SUMMARY_MAX_FINDINGS = 50;

/** The most characters of any text a stored summary copies, then an ellipsis. */
export const EVAL_SUMMARY_MAX_TEXT = QUOTED_TEXT_LIMIT;

/** The most characters of a finding's path a stored summary keeps, then an ellipsis. */
export const EVAL_SUMMARY_MAX_PATH = EVAL_SUMMARY_MAX_TEXT;

/** The most characters of a finding's message a stored summary keeps, then an ellipsis. */
export const EVAL_SUMMARY_MAX_MESSAGE = 1000;

/** The most tags a stored summary lists for one case. */
export const EVAL_SUMMARY_MAX_CASE_TAGS = 32;

/** One case as the summary lists it. */
export interface EvalSuiteSummaryCase {
  readonly name: string;
  readonly dir: string;
  readonly tags: readonly string[];
  /** The feature Stigmer does not run yet; absent when the case runs. */
  readonly unsupported?: string;
}

/** The suite as a plugin stores it. */
export interface EvalSuiteSummary {
  readonly dir: string;
  /** Every case the suite holds, listed or not. */
  readonly caseCount: number;
  /** Every case's tags, once each, sorted. */
  readonly caseTags: readonly string[];
  readonly cases: readonly EvalSuiteSummaryCase[];
  readonly findings: readonly EvalSuiteFinding[];
}

/** The suite, bounded for storage on the plugin. */
export function summariseEvalSuite(suite: EvalSuite): EvalSuiteSummary {
  return {
    dir: suite.dir,
    caseCount: suite.cases.length,
    caseTags: [...new Set(suite.cases.flatMap(keptTags))].sort(),
    cases: suite.cases.slice(0, EVAL_SUMMARY_MAX_CASES).map((c) => ({
      name: excerpt(c.name),
      dir: excerpt(c.dir),
      tags: keptTags(c),
      ...(c.unsupported !== undefined && { unsupported: c.unsupported }),
    })),
    findings: suite.findings.slice(0, EVAL_SUMMARY_MAX_FINDINGS).map(cutFinding),
  };
}

/** A case's tags as the summary keeps them: the first few, each cut. */
function keptTags(evalCase: EvalSuite["cases"][number]): readonly string[] {
  return evalCase.tags.slice(0, EVAL_SUMMARY_MAX_CASE_TAGS).map(excerpt);
}

/** A finding with its path cut, in the field and at the start of its message, then its message cut. */
function cutFinding(finding: EvalSuiteFinding): EvalSuiteFinding {
  const path = excerpt(finding.path);
  const prefix = `${finding.path}: `;
  const named = path !== finding.path && finding.message.startsWith(prefix) ? `${path}: ${finding.message.slice(prefix.length)}` : finding.message;
  const message = cutText(named, EVAL_SUMMARY_MAX_MESSAGE);
  return path === finding.path && message === finding.message ? finding : { ...finding, path, message };
}
