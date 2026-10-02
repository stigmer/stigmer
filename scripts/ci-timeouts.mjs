/**
 * Every job the merge queue waits on carries a time limit that can fire before the queue gives up.
 *
 * A job without `timeout-minutes` runs under GitHub's default of 360 minutes.
 * When a step in it hangs (a mirror that stops answering mid-download, a
 * process that never exits), nothing stops it: a pull request's `Gate` stays
 * pending for six hours, the runner is held as long, and a merge-queue entry
 * waits until the queue's own check timeout ejects it, a change that broke
 * nothing (#1703). A job that carries a cap fails at the cap, red and named:
 * #1663's hang was in `ci.e2e-interactive.yaml`'s interactive job, which
 * stopped itself at its 30 minutes.
 *
 * The set is derived, never listed. It is every workflow that runs on
 * `merge_group`, and every workflow those call through a local
 * `uses: ./.github/workflows/<file>`, followed transitively. A required check
 * has to run on `merge_group` or the queue could never land anything, so the
 * roots are exactly the required checks (on 2026-10-02: `Gate`,
 * `Test integrity` and `Review verdict`) and the set is everything they wait
 * on. A job that calls a reusable workflow cannot set `timeout-minutes`; the
 * workflow it calls is judged instead. A remote reusable workflow cannot be
 * judged from here, and a local one that does not exist cannot run, so both
 * are findings rather than silent skips.
 *
 * What each job in the set must declare: `timeout-minutes` as a literal whole
 * number from 1 to MAX_TIMEOUT_MINUTES. An expression cannot be judged. The
 * ceiling comes from the queue: the ruleset gives a required check 60 minutes
 * to report (`check_response_timeout_minutes`, read 2026-10-02), and a job's
 * own clock starts only when a runner picks it up, after the jobs it needs.
 * Over the 77 green merge-queue runs of 2026-09-30 to 2026-10-02 the latest
 * a job started was 15 minutes after its entry's run was created
 * (`desktop-rust`, under load; the median was under 2). So 45 = 60 - 15 is
 * the largest cap that can fire by the queue's hour at all. At a typical
 * start it fires well inside it, and the red names the job that hung. At the
 * worst start it fires at about the hour, racing the queue's generic timeout
 * and the `gate` job that reports the check after it; the run still shows
 * the job red at its cap. A job that needs longer is sharded
 * (scripts/ci-shards.mjs), not given more time.
 *
 * How a cap is sized, so that a slow green run is never turned red: the
 * larger of 3 x the job's median wall time and 2 x its slowest green run,
 * rounded up to a multiple of 5, and at least 10 minutes, measured over the
 * job's recent successful runs (the jobs API's `started_at` and
 * `completed_at`). A job that calls a step whose slow path it does not own is
 * sized from that step's worst measurement too: the two jobs that install
 * Tauri's packages (.github/actions/tauri-linux-deps) carry 45, because an
 * archive-cache miss has spent 20 min 17 s downloading from Ubuntu's mirror
 * (#1529). A cap is raised the same way, with the run that showed it was too
 * tight.
 *
 * Pure: it reads parsed workflow documents, `[{ file, doc }]`, and returns
 * findings as sentences; scripts/ci-timeouts.test.mjs runs it over
 * .github/workflows and over fixtures of each drift.
 */

/** The largest cap a job in the set may carry: the queue's 60 minutes less the latest job start measured in it. */
export const MAX_TIMEOUT_MINUTES = 45;

const LOCAL_WORKFLOW = /^\.\/\.github\/workflows\/([^/]+)$/;

/** The events a workflow's `on:` names, whichever of its three shapes it takes. */
function triggers(doc) {
  const on = doc?.on;
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on ?? {});
}

/**
 * The workflows the merge queue waits on: the `merge_group` roots and every
 * local workflow they call, transitively. `findings` names each call that
 * cannot be followed.
 */
export function queueWorkflows(workflows) {
  const byFile = new Map(workflows.map((workflow) => [workflow.file, workflow]));
  const reached = [];
  const findings = [];
  const pending = workflows.filter(({ doc }) => triggers(doc).includes("merge_group")).map(({ file }) => file);
  const seen = new Set(pending);
  while (pending.length > 0) {
    const file = pending.shift();
    reached.push(file);
    for (const [job, def] of Object.entries(byFile.get(file)?.doc?.jobs ?? {})) {
      if (def?.uses === undefined) continue;
      const local = LOCAL_WORKFLOW.exec(String(def.uses));
      if (!local) {
        findings.push(`${file} ${job} calls \`${def.uses}\`, a workflow outside this repository whose jobs' caps cannot be judged here`);
        continue;
      }
      const callee = local[1];
      if (!byFile.has(callee)) {
        findings.push(`${file} ${job} calls \`${def.uses}\`, which is not a workflow in .github/workflows`);
        continue;
      }
      if (!seen.has(callee)) {
        seen.add(callee);
        pending.push(callee);
      }
    }
  }
  return { reached: reached.sort(), findings };
}

/** Why a job the merge queue waits on could run past its usefulness; empty when none could. */
export function timeoutFindings(workflows) {
  const { reached, findings } = queueWorkflows(workflows);
  const byFile = new Map(workflows.map((workflow) => [workflow.file, workflow]));
  for (const file of reached) {
    for (const [job, def] of Object.entries(byFile.get(file).doc?.jobs ?? {})) {
      if (def?.uses !== undefined) continue;
      const at = `${file} ${job}`;
      const cap = def?.["timeout-minutes"];
      if (cap === undefined) {
        findings.push(
          `${at} sets no \`timeout-minutes\`: a hung step would hold its runner for GitHub's six-hour default and its merge-queue entry until the queue gives up; size a cap as scripts/ci-timeouts.mjs's header says`,
        );
      } else if (!Number.isInteger(cap) || cap < 1 || cap > MAX_TIMEOUT_MINUTES) {
        findings.push(
          `${at}: \`timeout-minutes: ${cap}\` is not a whole number of minutes from 1 to ${MAX_TIMEOUT_MINUTES}; above ${MAX_TIMEOUT_MINUTES} the cap may not fire before the merge queue's 60-minute check timeout (scripts/ci-timeouts.mjs's header)`,
        );
      }
    }
  }
  return findings;
}
