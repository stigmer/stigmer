/**
 * The shape a sharded CI job must have, so a split suite still runs whole.
 *
 * A long suite is split across parallel jobs with its runner's own
 * `--shard=<index>/<count>` (vitest and Playwright both take it), the index
 * coming from the job's matrix. The split is only safe when the matrix lists
 * every index from 1 to <count>: with `shard: [1, 2]` under `/3`, or a fixed
 * `--shard=1/3`, a part of the suite never runs and every job is green. That
 * is the quiet pass this rule refuses, read from the workflow files as they
 * are, so the shape cannot drift with a later edit:
 *
 *   - every `--shard` argument is `${{ matrix.shard }}/<count>`, and one job
 *     splits by one count;
 *   - the job's `strategy.matrix.shard` is exactly [1, ..., <count>], and no
 *     `exclude` or `include` entry names a shard, since either changes which
 *     shards run after the list says all of them do;
 *   - neither the job nor a step that passes `--shard` is conditional on the
 *     shard: an `if:` over `matrix.shard` or `strategy.job-index` there skips
 *     that shard, green (a step that runs no part of the suite, a one-off
 *     check, may run in one shard only);
 *   - neither carries `continue-on-error`, which turns a red shard green
 *     whether it is `true` or an expression over the shard;
 *   - `strategy.fail-fast` is false, so one red shard does not cancel its
 *     siblings before they report what they found;
 *   - every artifact the job uploads names the shard, so the shards' uploads
 *     neither collide nor overwrite each other;
 *   - a job with a shard matrix shards something: otherwise each instance
 *     would run the whole suite, and the matrix would only cost runners.
 *
 * Pure: it reads parsed workflow documents, `[{ file, doc }]`, and returns
 * findings as sentences; scripts/ci-shards.test.mjs runs it over
 * .github/workflows and over fixtures of each drift.
 */

// An expression (`${{ matrix.shard }}/3`) holds spaces, so it is read whole.
const SHARD_ARG = /--shard(?:=|\s+)(["']?\$\{\{[^}]*\}\}\S*|\S+)/g;
const MATRIX_SHARD = /^\$\{\{\s*matrix\.shard\s*\}\}\/(\d+)$/;
// Both name the instance of the matrix a job is: a condition over either can single out a shard.
const MENTIONS_SHARD = /\bmatrix\.shard\b|\bstrategy\.job-index\b/;

/** Whether a `continue-on-error` value is set at all: `true`, or any expression. */
const forgives = (value) => value !== undefined && value !== false && value !== "false";

/** The `--shard` arguments of a step's command, quotes stripped. */
function shardArgs(run) {
  return [...String(run ?? "").matchAll(SHARD_ARG)].map((m) => m[1].replace(/^["']|["']$/g, ""));
}

/** Every job that passes `--shard` or carries a shard matrix, with what it declares. */
export function shardedJobs(workflows) {
  const jobs = [];
  for (const { file, doc } of workflows) {
    for (const [job, def] of Object.entries(doc?.jobs ?? {})) {
      const steps = def?.steps ?? [];
      const args = steps.flatMap((step) => shardArgs(step.run));
      const matrix = def?.strategy?.matrix?.shard;
      if (args.length === 0 && matrix === undefined) continue;
      const counts = [...new Set(args.map((arg) => MATRIX_SHARD.exec(arg)?.[1]).filter(Boolean).map(Number))];
      jobs.push({ file, job, def, steps, args, matrix, count: counts.length === 1 ? counts[0] : undefined, counts });
    }
  }
  return jobs;
}

/** Why each sharded job could run less than its whole suite; empty when none could. */
export function shardFindings(workflows) {
  const findings = [];
  for (const { file, job, def, steps, args, matrix, count, counts } of shardedJobs(workflows)) {
    const at = `${file} ${job}`;
    if (args.length === 0) {
      findings.push(`${at} has a shard matrix but no step passes \`--shard\`: every instance would run the whole suite`);
      continue;
    }
    for (const arg of args) {
      if (!MATRIX_SHARD.test(arg)) findings.push(`${at}: \`--shard=${arg}\` is not \`\${{ matrix.shard }}/<count>\`, so the job runs one fixed part of the suite`);
    }
    if (counts.length > 1) findings.push(`${at} splits by /${counts.join(" and /")}: one job splits its suite one way`);
    if (count !== undefined) {
      const want = Array.from({ length: count }, (_, i) => i + 1);
      if (JSON.stringify(matrix) !== JSON.stringify(want)) {
        findings.push(`${at}: the matrix's shard list is ${JSON.stringify(matrix ?? null)}, but the commands split the suite /${count}, which needs ${JSON.stringify(want)}`);
      }
    }
    for (const key of ["exclude", "include"]) {
      const entries = def?.strategy?.matrix?.[key] ?? [];
      if (entries.some((entry) => entry !== null && typeof entry === "object" && "shard" in entry)) {
        findings.push(`${at}: \`strategy.matrix.${key}\` names a shard, so the shards that run are no longer the list's`);
      }
    }
    if (MENTIONS_SHARD.test(String(def?.if ?? ""))) {
      findings.push(`${at}: the job is conditional on the shard (\`if: ${def.if}\`), so a listed shard can be skipped green`);
    }
    if (forgives(def?.["continue-on-error"])) {
      findings.push(`${at}: \`continue-on-error\` on the job (\`${def["continue-on-error"]}\`) lets a red shard pass`);
    }
    for (const step of steps) {
      if (shardArgs(step.run).length === 0) continue;
      if (MENTIONS_SHARD.test(String(step.if ?? ""))) {
        findings.push(`${at}: the step running \`--shard\` is conditional on the shard (\`if: ${step.if}\`), so a listed shard can be skipped green`);
      }
      if (forgives(step["continue-on-error"])) {
        findings.push(`${at}: \`continue-on-error\` on the step running \`--shard\` (\`${step["continue-on-error"]}\`) lets a red shard pass`);
      }
    }
    if (def?.strategy?.["fail-fast"] !== false) {
      findings.push(`${at}: \`strategy.fail-fast\` must be false, or one red shard cancels the others before they report`);
    }
    for (const step of steps) {
      if (!String(step.uses ?? "").startsWith("actions/upload-artifact@")) continue;
      const name = String(step.with?.name ?? "");
      if (!/\$\{\{\s*matrix\.shard\s*\}\}/.test(name)) {
        findings.push(`${at} uploads the artifact \`${name}\`, which does not name the shard: the shards' uploads would collide`);
      }
    }
  }
  return findings;
}
