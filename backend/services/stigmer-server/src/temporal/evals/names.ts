/**
 * Plugin evals' Temporal wire identifiers. Every value is a byte-pinned
 * wire constant from its first commit: a workflow in flight across a
 * release is addressed by these exact strings, and a rename strands it.
 *
 * Imported by BOTH the workflow bundle and host code: no node built-ins,
 * no framework imports (the workflow-bundle import discipline,
 * temporal/README.md).
 */

/** The suite workflow's registered type: one PluginEval, run whole. */
export const RUN_PLUGIN_EVAL_WORKFLOW_TYPE = "stigmer/evals/run-plugin-eval";

/**
 * The suite workflow's id, `plugin-eval/<eval id>`. Create starts it under
 * this id, so a retried start finds the workflow already running.
 */
export function runPluginEvalWorkflowId(evalId: string): string {
  return `plugin-eval/${evalId}`;
}

/** The case workflow's registered type: one try, started, polled, graded. */
export const RUN_CASE_WORKFLOW_TYPE = "stigmer/evals/run-case";

/**
 * A try's workflow id, unique per eval and cell:
 * `plugin-eval/<eval id>/<case index>/<target index>/<arm>/<try index>`.
 */
export function runCaseWorkflowId(
  evalId: string,
  caseIndex: number,
  targetIndex: number,
  arm: "with" | "without",
  tryIndex: number,
): string {
  return `plugin-eval/${evalId}/${caseIndex}/${targetIndex}/${arm}/${tryIndex}`;
}
