/**
 * A `node:test` reporter that writes vitest's JSON report shape, so a tool
 * that reads test results (the UX scorecard, scripts/ux-scorecard.mjs) reads
 * one format whether a case ran under vitest or under Node's own runner.
 *
 * Node's built-in reporters are spec, tap, dot, junit and lcov; junit is the
 * only machine-readable one with every case's title, and reading it would
 * mean parsing XML by pattern. This reporter keeps what the reader needs and
 * nothing else: each file's cases, each with its describe chain
 * (`ancestorTitles`), its own `title`, the two joined with " " as vitest
 * joins them (`fullName`), and its status. The case's key, describe chain
 * and title joined with " > ", is the same key the integrity tool's
 * inventory gives a case read from source (scripts/test-integrity.mjs).
 *
 * Status: a pass is "passed", a failure "failed", a skip "skipped" and a
 * todo "pending". A suite is not a case and is not listed; a failure inside a
 * suite's own hook fails its cases, which Node reports as failures. A file
 * that throws before it registers a case reports no case at all: the reader
 * then finds its cases missing, which it reads as "not run", never a pass.
 *
 * It applies to a plain script too, not only to `node --test` (checked on
 * Node 22.22.1, the `.nvmrc` line), so the install smokes, which run as
 * scripts, report through it unchanged. Keep the human reporter beside it:
 *
 *   node --test-reporter=spec --test-reporter-destination=stdout \
 *        --test-reporter=./test/install/lib/json-reporter.mjs \
 *        --test-reporter-destination=<report.json> test/install/smoke-libs.mjs
 */

/** The event types this reporter reads; every other event is ignored. */
const CASE_EVENTS = new Set(["test:start", "test:pass", "test:fail"]);

/**
 * Folds `node:test` events into vitest's report shape. Pure: the caller
 * supplies the events in the order the runner emits them (a test's start,
 * its children, then its own pass or fail, each in definition order).
 */
export function collectReport(events) {
  /** The titles of the open suites at each nesting level, per file. */
  const open = new Map();
  /** Each file's cases, in the order they finished. */
  const files = new Map();
  for (const event of events) {
    if (!CASE_EVENTS.has(event.type)) continue;
    const { name, nesting = 0, file = "", details, skip, todo } = event.data;
    const chain = open.get(file) ?? [];
    open.set(file, chain);
    if (event.type === "test:start") {
      chain.length = nesting;
      chain[nesting] = name;
      continue;
    }
    if (details?.type === "suite") continue;
    const ancestorTitles = chain.slice(0, nesting);
    const status = event.type === "test:fail" ? "failed" : todo ? "pending" : skip ? "skipped" : "passed";
    const failureMessages = event.type === "test:fail" ? [messageOf(details?.error)] : [];
    const cases = files.get(file) ?? [];
    files.set(file, cases);
    cases.push({ ancestorTitles, title: name, fullName: [...ancestorTitles, name].join(" "), status, failureMessages });
  }
  const testResults = [...files].map(([name, assertionResults]) => ({
    name,
    status: assertionResults.some((c) => c.status === "failed") ? "failed" : "passed",
    assertionResults,
  }));
  const all = testResults.flatMap((file) => file.assertionResults);
  const count = (status) => all.filter((c) => c.status === status).length;
  return {
    numTotalTests: all.length,
    numPassedTests: count("passed"),
    numFailedTests: count("failed"),
    numPendingTests: count("skipped") + count("pending"),
    success: count("failed") === 0,
    testResults,
  };
}

/** A failure's message: the assertion's own, or the error that wraps it in a test failure. */
function messageOf(error) {
  if (error === undefined || error === null) return "";
  const cause = error.cause;
  if (cause instanceof Error) return cause.message;
  if (cause !== undefined && cause !== null) return String(cause);
  return error instanceof Error ? error.message : String(error);
}

/** The reporter Node loads: reads every event, then writes the report once. */
export default async function* jsonReporter(source) {
  const events = [];
  for await (const event of source) events.push(event);
  yield `${JSON.stringify(collectReport(events), null, 2)}\n`;
}
