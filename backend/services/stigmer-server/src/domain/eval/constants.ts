/**
 * Eval domain constants — every wire-visible string and pinned value in
 * one place: the CLI, the SDK and the console show these verbatim. The
 * archive budgets are the platform's (src/archive/limits.ts).
 */

/** Storage key prefix for eval archives: "evals/<digest>.zip". */
export const EVAL_ARTIFACT_KEY_PREFIX = "evals/";

/** The noun in every sentence the shared steps write about an eval. */
export const EVAL_NOUN = "eval";

/** PermissionDenied copy for a push or an upload mint, whichever question refused it. */
export const EVAL_PUSH_DENIED =
  "unauthorized to push eval: creating one needs permission to create evals in the organization, and adding a version needs edit access to it";

/** FailedPrecondition copy when the upload or download lane was not configured. */
export const EVAL_TRANSFER_LANE_NOT_CONFIGURED =
  "eval artifact transfer lane is not configured on this server";

/** The most mock servers a stored eval lists, as it lists at most this many cases. */
export const EVAL_MAX_LISTED_MOCK_SERVERS = 200;

/** The largest case archive buildCaseFromRun answers inline: room under the transport's 10 MB message. */
export const MAX_CASE_ARCHIVE_BYTES = 8 * 1024 * 1024;

/** PermissionDenied copy when the caller may not view the run a case is built from. */
export const EVAL_CASE_RUN_DENIED = "unauthorized to build an eval case from run: viewing the run is required";

/** FailedPrecondition copy for a run that has not ended: its events are not the conversation yet. */
export function evalCaseRunNotEndedMessage(runId: string): string {
  return `run ${runId} has not ended; a case is built from a finished turn`;
}

/** InvalidArgument copy for a case name the suite's root keeps for itself. */
export function evalCaseReservedNameMessage(name: string): string {
  return `case_name '${name}' is a name an eval's root keeps for its mocks and run output; name the case otherwise`;
}

/** ResourceExhausted copy for a case too large to answer inline. */
export function evalCaseTooLargeMessage(sizeBytes: number, limitBytes: number): string {
  return `the case is ${sizeBytes} bytes zipped, more than ${limitBytes} can travel inline; add it to an eval with addCaseFromRun, which writes it on the server`;
}

/** FailedPrecondition copy for an eval named in another organization than the run's. */
export const EVAL_CASE_OTHER_ORGANIZATION =
  "the eval is not of the run's organization; a run's case is added to an eval of its own organization";

/** AlreadyExists copy for a case name the eval already holds. */
export function evalCaseExistsMessage(name: string, slug: string): string {
  return `eval '${slug}' already holds a case named '${name}'; name this one otherwise`;
}

/** The new version's message when the request names none. */
export function evalCaseVersionMessage(name: string, runId: string): string {
  return `case ${name} from run ${runId}`;
}

/** InvalidArgument copy for a skill not named as `<plugin>:<skill>` on one line. */
export function evalCaseSkillMessage(raw: string): string {
  return `skill '${raw}' names no skill: write <plugin>:<skill> on one line, as in thermos:review`;
}

/** The one PermissionDenied every caller of the runner's eval-case door gets but the run's runner. */
export const RUN_EVAL_CASE_NOT_THE_RUNS_RUNNER = "only the runner acting for this run may fetch its eval case";

/** FailedPrecondition copy for a finished run asking for its eval case. */
export function runEvalCaseFinishedMessage(runId: string): string {
  return `run '${runId}' is finished; it fetches no eval case`;
}

/** FailedPrecondition copy for a run whose spec names no Eval's case: none at all, or a plugin's. */
export function runEvalCaseNoneMessage(runId: string, pluginCase: boolean): string {
  return pluginCase
    ? `run '${runId}' tries a plugin's eval case; it is fetched from the plugin's archive`
    : `run '${runId}' tries no eval case`;
}
