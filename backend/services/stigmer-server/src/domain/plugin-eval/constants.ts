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

/** The create lane's deny copy when the caller cannot edit the plugin. */
export const PLUGIN_EVAL_CREATE_DENIED_MESSAGE =
  "unauthorized to run evals of plugin";

/** The refusal of an organization that is not the plugin's. */
export function pluginEvalOrgMismatchMessage(pluginOrg: string): string {
  return `metadata.org must be the plugin's organization (${pluginOrg})`;
}

/**
 * The refusal of a digest that is not the plugin's current version: the
 * with-plugin arm runs the plugin as installed now, so an earlier
 * version's cases would be graded against today's plugin.
 */
export function pluginEvalNotCurrentVersionMessage(current: string): string {
  return `an eval runs the plugin's current version (${current}); evaluating an earlier version is not supported yet`;
}

/** The refusal of a case_glob that is not a glob (domain/plugin-eval/glob.ts). */
export function pluginEvalCaseGlobMessage(glob: string, error: string): string {
  return `spec.case_glob '${glob}' is not a valid glob: ${error}`;
}

/** The refusal of a plugin version with no cases to run. */
export function pluginEvalNoCasesMessage(dir: string): string {
  return `this plugin version has no eval cases: add a case directory under ${dir}/ holding a prompt.md or a case.yaml`;
}

/** The refusal of a suite larger than an eval may run. */
export function pluginEvalTooLargeMessage(cases: number, tries: number): string {
  return (
    `this eval would run ${cases} case${cases === 1 ? "" : "s"} and ${tries} tr${tries === 1 ? "y" : "ies"}; ` +
    `an eval runs at most ${PLUGIN_EVAL_MAX_CASES} cases and ${PLUGIN_EVAL_MAX_TRIES} tries: ` +
    "narrow it with case_glob or case_tags, or lower runs or targets"
  );
}

/** The refusal of a delete while the eval may still start tries. */
export function pluginEvalActiveDeleteMessage(evalId: string): string {
  return `plugin eval ${evalId} is still running: cancel it first, then delete it`;
}

/** The refusal of a plugin delete while one of its evals runs. */
export function pluginEvalActiveOnPluginDeleteMessage(evalId: string): string {
  return `this plugin has a running eval (${evalId}): cancel it first, then delete the plugin`;
}

/** The failed eval's error when its workflow could not start. */
export function pluginEvalNotStartedMessage(cause: string): string {
  return `the eval could not start: ${cause}`;
}

/** The cancel's answer when no engine is connected to stop the eval. */
export const PLUGIN_EVAL_NO_ENGINE_MESSAGE =
  "the eval cannot be cancelled while the server has no engine connection; try again shortly";

/** The refusal of an allow_tools entry that names another plugin's MCP tools. */
export function pluginEvalOtherPluginToolMessage(entry: string, named: string, plugin: string): string {
  return `allow_tools entry '${entry}' names plugin '${named}', but this eval runs '${plugin}'; a try attaches no other plugin`;
}
