/**
 * Finds a Plan-mode turn's plan among the conversation's Files.
 *
 * A Plan-mode turn returns its plan as a File it saved in its outputs folder,
 * named by the plan filename convention (`<slug>_<id>.plan.md`). Detection is
 * by that name on a File the turn produced (its `run_id`), on a run that ran
 * in Plan mode — content-free, so no surface needs a read to know a plan
 * exists. A person's upload carries no run id, so an edited copy of a plan
 * is never taken for the plan itself.
 *
 * The filename constants mirror the runner's (shared/plan-file.ts): the
 * runner and the browser SDK have disjoint module graphs, so they are
 * duplicated by design.
 */

import type { File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

/**
 * The session's current plan: the plan File of the most recent Plan-mode run
 * that returned one, plus that run's id.
 */
export interface SessionPlan {
  /** ID of the run that returned the plan. */
  readonly runId: string;
  /** The plan File (`*.plan.md`). */
  readonly file: StigmerFile;
}

/**
 * Suffix every named plan carries (`<slug>_<id>.plan.md`, or a bare
 * `<id>.plan.md` when untitled). The runner derives the slug from the plan's
 * title and the `<id>` from its content hash; detection keys on this suffix.
 */
export const PLAN_FILE_SUFFIX = ".plan.md";

/** Returns `true` when a filename is a plan's: any `*.plan.md`. */
export function isPlanFileName(name: string): boolean {
  return name.endsWith(PLAN_FILE_SUFFIX);
}

/**
 * Returns `true` when a File is a turn's plan: a File some run returned
 * (`status.run_id` set) whose filename satisfies {@link isPlanFileName}.
 * Whether that run ran in Plan mode is {@link findPlanFile}'s check, which
 * has the run.
 */
export function isPlanFile(file: StigmerFile): boolean {
  return !!file.status?.runId && isPlanFileName(file.spec?.filename ?? "");
}

/**
 * Finds the plan File a Plan-mode run returned, or `undefined` when the run
 * is not a Plan-mode run or returned no plan.
 *
 * @param files - The conversation's Files, newest first (the server's list
 *   order, as `useSessionFiles` keeps it).
 * @param run - The run whose plan to find.
 */
export function findPlanFile(
  files: readonly StigmerFile[],
  run: Run | null | undefined,
): StigmerFile | undefined {
  const runId = run?.metadata?.id;
  if (!runId || run?.spec?.interactionMode !== InteractionMode.PLAN) return undefined;
  return files.find((file) => file.status?.runId === runId && isPlanFile(file));
}

/**
 * Finds the session's LATEST plan across all runs — the plan the panel's
 * plan document tab edits and the "Build" action implements. Runs are
 * scanned newest-first (the array is chronological), mirroring the thread's
 * latest-plan-owns-the-build-action rule so every surface agrees on which
 * plan is current.
 *
 * Returns `undefined` when no run in the session returned a plan.
 */
export function findLatestSessionPlan(
  files: readonly StigmerFile[],
  runs: readonly Run[],
): SessionPlan | undefined {
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i];
    const file = findPlanFile(files, run);
    const runId = run.metadata?.id;
    if (file && runId) return { runId, file };
  }
  return undefined;
}

/**
 * Each Plan-mode run's plan File, by run id: what the message thread takes
 * as its `planFiles` so a completed plan collapses into its card.
 */
export function planFilesByRun(
  files: readonly StigmerFile[],
  runs: readonly Run[],
): ReadonlyMap<string, StigmerFile> {
  const byRun = new Map<string, StigmerFile>();
  for (const run of runs) {
    const file = findPlanFile(files, run);
    const runId = run.metadata?.id;
    if (file && runId) byRun.set(runId, file);
  }
  return byRun;
}
