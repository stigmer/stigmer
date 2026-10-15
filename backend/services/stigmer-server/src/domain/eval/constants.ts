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
