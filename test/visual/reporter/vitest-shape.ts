// A Playwright reporter that writes vitest's JSON report shape, so the UX
// scorecard (scripts/ux-scorecard.mjs) reads the visual suite's results as it
// reads vitest's and node's (test/install/lib/json-reporter.mjs writes the
// same shape for node:test).
//
// Each case is keyed as the integrity tool's inventory keys it from source:
// its describe chain (`ancestorTitles`) and its own title. Playwright's title
// path also carries the root suite, the project and the file, which are
// stripped. The report goes to the file `STIGMER_VISUAL_REPORT` names;
// without it the reporter writes nothing, so it can sit beside the human
// reporter in any run:
//
//   STIGMER_VISUAL_REPORT=<report.json> npx playwright test \
//     --reporter=list,./reporter/vitest-shape.ts
import { writeFileSync } from "node:fs";
import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

/** One case as vitest reports it. */
export interface ReportedCase {
  readonly ancestorTitles: readonly string[];
  readonly title: string;
  readonly fullName: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly failureMessages: readonly string[];
}

/** One finished case, as the fold takes it: its file, describe chain, title, outcome and errors. */
export interface FinishedCase {
  readonly file: string;
  readonly describes: readonly string[];
  readonly title: string;
  readonly outcome: TestResult["status"];
  readonly errors: readonly string[];
}

/** Playwright's outcome as vitest's status: a timeout or an interruption is a failure. */
export function statusOf(outcome: TestResult["status"]): ReportedCase["status"] {
  if (outcome === "passed") return "passed";
  if (outcome === "skipped") return "skipped";
  return "failed";
}

/** The finished cases folded into vitest's report shape, files in the order their first case finished. Pure. */
export function collectReport(finished: readonly FinishedCase[]) {
  const files = new Map<string, ReportedCase[]>();
  for (const c of finished) {
    const cases = files.get(c.file) ?? [];
    files.set(c.file, cases);
    const status = statusOf(c.outcome);
    cases.push({
      ancestorTitles: c.describes,
      title: c.title,
      fullName: [...c.describes, c.title].join(" "),
      status,
      failureMessages: status === "failed" ? c.errors : [],
    });
  }
  const testResults = [...files].map(([name, assertionResults]) => ({
    name,
    status: assertionResults.some((r) => r.status === "failed") ? "failed" : "passed",
    assertionResults,
  }));
  const all = testResults.flatMap((file) => file.assertionResults);
  const count = (status: ReportedCase["status"]) => all.filter((r) => r.status === status).length;
  return {
    numTotalTests: all.length,
    numPassedTests: count("passed"),
    numFailedTests: count("failed"),
    numPendingTests: count("skipped"),
    success: count("failed") === 0,
    testResults,
  };
}

/** A case's describe chain: the suites between its file and itself. */
export function describesOf(test: TestCase): string[] {
  const chain: string[] = [];
  for (let suite = test.parent; suite.type === "describe"; suite = suite.parent) {
    chain.unshift(suite.title);
    if (suite.parent === undefined) break;
  }
  return chain;
}

export default class VitestShapeReporter implements Reporter {
  private readonly finished: FinishedCase[] = [];

  onTestEnd(test: TestCase, result: TestResult): void {
    this.finished.push({
      file: test.location.file,
      describes: describesOf(test),
      title: test.title,
      outcome: result.status,
      errors: result.errors.map((error) => error.message ?? String(error.value ?? "")),
    });
  }

  onEnd(): void {
    const path = process.env.STIGMER_VISUAL_REPORT;
    if (path) writeFileSync(path, `${JSON.stringify(collectReport(this.finished), null, 2)}\n`);
  }

  printsToStdio(): boolean {
    return false;
  }
}
