/**
 * Every job the merge queue waits on that checks out without file contents signs in git's fetches of them.
 *
 * A checkout with a `filter` (`blob:none` in the Gate's jobs), or with
 * `sparse-checkout` and no `filter` (which actions/checkout fetches as
 * `blob:none`), is a partial clone: the commit graph arrives, and git downloads each file's contents only
 * when a later step reads them (`git show`, `git diff -U0`, and the inexact
 * rename detection plain `git diff --name-only` runs). With
 * `persist-credentials: false` those downloads go out with no sign-in, and
 * GitHub refuses anonymous git traffic now and then: #2322's Coverage job
 * failed on a 403 before it judged anything, and its author could not tell
 * the failure was not theirs. Re-checking out with contents costs about
 * 300 MB per job, and persisting the token writes it to `.git/config`.
 *
 * So the step right after such a checkout puts the job's read-only token in
 * an `http.https://github.com/.extraheader` that git reads from the
 * environment (`GIT_CONFIG_COUNT`, `GIT_CONFIG_KEY_0`, `GIT_CONFIG_VALUE_0`,
 * written to `$GITHUB_ENV`): the header `actions/checkout` itself uses, reaching
 * every later git in the job, and never written to disk. "Right after" is the
 * rule because a step placed later leaves the steps before it unsigned, and
 * the next step to read a file would not know it had to sign in. The step is
 * recognized by the `GIT_CONFIG_KEY_0=http.https://github.com/.extraheader`
 * line its `run` writes; its text is in each of the jobs, not in a composite
 * action, because ci.review.yaml runs the base branch's checkout, where an
 * action added in the same change does not exist yet.
 *
 * The set judged is the one scripts/ci-timeouts.mjs judges, reused rather than
 * re-derived: every workflow that runs on `merge_group` and every local
 * workflow those call, since only those block a change. A call that cannot be
 * followed is that rule's finding and is not reported twice here. Release and
 * publish workflows are outside the set.
 *
 * Pure: it reads parsed workflow documents, `[{ file, doc }]`, and returns
 * findings as sentences; scripts/ci-lazy-fetch.test.mjs runs it over
 * .github/workflows and over fixtures of each drift.
 */

import { queueWorkflows } from "./ci-timeouts.mjs";

/** The line the sign-in step's `run` writes to `$GITHUB_ENV`, by which the step is recognized. */
export const SIGN_IN_MARK = "GIT_CONFIG_KEY_0=http.https://github.com/.extraheader";

const CHECKOUT = /^actions\/checkout@/;

const set = (value) => value !== undefined && value !== null && value !== "";

/**
 * How a checkout's inputs make it a partial clone, or null when they do not.
 * actions/checkout fetches with its `filter` when one is given, and with
 * `blob:none` when `sparse-checkout` is given without one.
 */
function partialClone(inputs) {
  if (set(inputs?.filter)) return `\`filter: ${inputs.filter}\``;
  if (set(inputs?.["sparse-checkout"])) return "`sparse-checkout` (a `blob:none` clone)";
  return null;
}

/** Each step of the queue's workflows that checks out without file contents, with the step after it. */
function lazyCheckouts(workflows) {
  const byFile = new Map(workflows.map((workflow) => [workflow.file, workflow]));
  const found = [];
  for (const file of queueWorkflows(workflows).reached) {
    for (const [job, def] of Object.entries(byFile.get(file)?.doc?.jobs ?? {})) {
      const steps = Array.isArray(def?.steps) ? def.steps : [];
      steps.forEach((step, index) => {
        if (!CHECKOUT.test(String(step?.uses ?? ""))) return;
        const how = partialClone(step.with);
        if (how !== null) found.push({ file, job, how, next: steps[index + 1] });
      });
    }
  }
  return found;
}

/** The jobs this rule judges, as `<file> <job>`: those the queue waits on that check out without file contents. */
export function lazyFetchJobs(workflows) {
  return [...new Set(lazyCheckouts(workflows).map(({ file, job }) => `${file} ${job}`))];
}

/** Why a job the queue waits on could fetch file contents unsigned; empty when none could. */
export function lazyFetchFindings(workflows) {
  return lazyCheckouts(workflows)
    .filter(({ next }) => !(typeof next?.run === "string" && next.run.includes(SIGN_IN_MARK)))
    .map(
      ({ file, job, how }) =>
        `${file} ${job} checks out with ${how}, but its next step does not sign in git's fetches of the contents it left out; a refused anonymous fetch would fail the job (#2322). Put the sign-in step scripts/ci-lazy-fetch.mjs's header describes right after the checkout`,
    );
}
