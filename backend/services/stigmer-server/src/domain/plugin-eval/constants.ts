/**
 * Plugin-eval domain constants shared by the domain, the eval's workflow
 * and the run compose steps: the reserved label that marks a try's
 * session and run (and every AI-graded check's), and the suite limits
 * create refuses past. The label's key is wire contract: the session list
 * index derives its `plugin_eval` key from it and the credential resolver
 * finds the eval's vaults through it.
 */

/**
 * The reserved label on a try's session and run, and on each vote of an
 * AI-graded check: `stigmer.ai/plugin-eval = <eval id>`. Stamped only by
 * the eval's workflow through server-composed requests; the guard refuses
 * it from clients (pipeline/steps/guard-reserved-labels.ts).
 */
export const PLUGIN_EVAL_LABEL = "stigmer.ai/plugin-eval";

/** The most cases one eval may run; create refuses a larger suite. */
export const PLUGIN_EVAL_MAX_CASES = 200;

/** The most tries one eval may run (cases x targets x arms x runs). */
export const PLUGIN_EVAL_MAX_TRIES = 1000;
