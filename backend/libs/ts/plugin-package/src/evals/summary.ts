/**
 * The eval suite as a plugin stores it: what the plugin page and the CLI
 * list before anyone runs it, bounded so the plugin's row stays within one
 * API message.
 *
 * An archive may hold up to its entry limit of files with long names, and
 * every case and finding would otherwise ride on the plugin's status. So
 * the summary keeps the first {@link EVAL_SUMMARY_MAX_CASES} cases and the
 * first {@link EVAL_SUMMARY_MAX_FINDINGS} findings, in the reader's order,
 * and cuts each finding's path to {@link EVAL_SUMMARY_MAX_PATH} characters
 * and an ellipsis, in its `path` and where its message starts with it.
 * `caseCount` still counts every case, and the tags are every case's. The
 * eval itself reads the archive again, so nothing a run needs is cut.
 *
 * Pinned by `__tests__/eval-summary.test.ts`.
 */

import { excerpt, QUOTED_TEXT_LIMIT } from "./fields.js";
import type { EvalSuite, EvalSuiteFinding } from "./types.js";

/** The most cases a stored summary lists. */
export const EVAL_SUMMARY_MAX_CASES = 200;

/** The most findings a stored summary keeps. */
export const EVAL_SUMMARY_MAX_FINDINGS = 50;

/** The most characters of a finding's path a stored summary keeps, then an ellipsis. */
export const EVAL_SUMMARY_MAX_PATH = QUOTED_TEXT_LIMIT;

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
    caseTags: [...new Set(suite.cases.flatMap((c) => c.tags))].sort(),
    cases: suite.cases.slice(0, EVAL_SUMMARY_MAX_CASES).map((c) => ({
      name: c.name,
      dir: c.dir,
      tags: c.tags,
      ...(c.unsupported !== undefined && { unsupported: c.unsupported }),
    })),
    findings: suite.findings.slice(0, EVAL_SUMMARY_MAX_FINDINGS).map(cutPath),
  };
}

/** A finding with its path cut, in the field and at the start of its message. */
function cutPath(finding: EvalSuiteFinding): EvalSuiteFinding {
  const path = excerpt(finding.path);
  if (path === finding.path) return finding;
  const prefix = `${finding.path}: `;
  const message = finding.message.startsWith(prefix) ? `${path}: ${finding.message.slice(prefix.length)}` : finding.message;
  return { ...finding, path, message };
}
