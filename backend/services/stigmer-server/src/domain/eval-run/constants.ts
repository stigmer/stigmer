/**
 * Eval-run domain constants shared by the domain, the eval run's workflow
 * and the run compose steps: the reserved label that marks a try's
 * session and run (and every AI-graded check's), the limits create refuses
 * past, the refusals the create, delete and cascade chains answer, and the
 * reasons a stamped plugin's cases do not run. The label's key is wire
 * contract: the session list index derives its `eval_run` key from it and
 * the credential resolver finds the eval run's vaults through it.
 */

/**
 * The reserved label on a try's session and run, and on each vote of an
 * AI-graded check: `stigmer.ai/eval-run = <eval run id>`. Stamped only by
 * the eval run's workflow through server-composed requests; the guard
 * refuses it from clients (pipeline/steps/guard-reserved-labels.ts).
 */
export const EVAL_RUN_LABEL = "stigmer.ai/eval-run";

/** The most cases one eval run may run; create refuses more. */
export const EVAL_RUN_MAX_CASES = 200;

/** The most tries one eval run may run (cases x targets x arms x runs). */
export const EVAL_RUN_MAX_TRIES = 1000;

/** The create lane's deny copy when the caller cannot edit the agent. */
export const EVAL_RUN_AGENT_DENIED_MESSAGE = "unauthorized to run evals of agent";

/** The create lane's deny copy when the caller cannot edit the plugin. */
export const EVAL_RUN_PLUGIN_DENIED_MESSAGE = "unauthorized to run evals of plugin";

/** The create lane's deny copy when the caller cannot view a compared plugin the agent does not attach. */
export const EVAL_RUN_COMPARED_DENIED_MESSAGE = "unauthorized to compare a plugin you cannot view";

/** The refusal of an eval run that names no subject. */
export const EVAL_RUN_NO_SUBJECT_MESSAGE =
  "an eval run is about an agent or a plugin: set spec.agent_id, or spec.plugin_id to run a plugin's cases on the built-in assistant";

/** The refusal of an organization that is not the subject's. */
export function evalRunOrgMismatchMessage(subject: "agent" | "plugin", org: string): string {
  return `metadata.org must be the ${subject}'s organization (${org})`;
}

/**
 * The refusal of a digest that is not the plugin's current version: the
 * with arm runs the plugin as installed now, so an earlier version's cases
 * would be graded against today's plugin.
 */
export function evalRunNotCurrentVersionMessage(current: string): string {
  return `an eval run evaluates the plugin's current version (${current}); evaluating an earlier version is not supported yet`;
}

/** The refusal of an eval run asking for real servers both beside its mocks and instead of them. */
export const EVAL_RUN_REAL_SERVERS_CONFLICT_MESSAGE =
  "spec.allow_real_servers starts real servers beside the mocks, and spec.real_mcp_servers ignores the mocks: set one of them";

/** The refusal of a case_glob that is not a glob (domain/eval-run/glob.ts). */
export function evalRunCaseGlobMessage(glob: string, error: string): string {
  return `spec.case_glob '${glob}' is not a valid glob: ${error}`;
}

/** The refusal of a plugin version with no cases to run. */
export function evalRunNoCasesMessage(dir: string): string {
  return `this plugin version has no eval cases: add a case directory under ${dir}/ holding a prompt.md or a case.yaml`;
}

/** The refusal of an eval run about an agent with nothing whose cases could run. */
export const EVAL_RUN_NO_CASE_SOURCES_MESSAGE =
  "this agent version attaches no plugin, and the eval run compares none and names no eval: run an eval with --eval, attach a plugin with eval cases, or compare one with --plugin";

/**
 * The refusal of a case source naming an eval that is not one of the
 * agent's organization the caller may view: one sentence for an eval that
 * is not there, one in another organization and one the caller cannot
 * view, so the refusal tells nobody which.
 */
export function evalRunUnreadableEvalMessage(name: string): string {
  return `spec.cases names eval '${name}', which is not an eval of the agent's organization you can view`;
}

/** The refusal of a case source naming a version its eval does not hold. */
export function evalRunEvalVersionMessage(name: string, version: string): string {
  return `spec.cases names eval '${name}' at '${version}', a version it does not hold: name a tag it holds, a digest of one of its versions, or no version for its current one`;
}

/** The refusal of case sources naming one eval at two versions: an eval run stamps one version of each eval. */
export function evalRunEvalTwoVersionsMessage(name: string): string {
  return `spec.cases names eval '${name}' at two versions; an eval run runs one version of each eval: name it once`;
}

/** The refusal of an eval run about an agent none of whose case sources has cases. */
export const EVAL_RUN_NO_CASES_MESSAGE =
  "none of the plugins whose cases this eval run runs has eval cases at the version it runs";

/** The refusal of no case matching the filters. */
export const EVAL_RUN_NO_MATCHING_CASES_MESSAGE = "no eval case matches case_glob and case_tags";

/** The refusal of a case source the try would not load. */
export function evalRunUnloadedCaseSourceMessage(plugin: string): string {
  return (
    `spec.cases names plugin '${plugin}', which this agent version does not attach and the eval run does not compare: ` +
    "a case runs with the plugin it was written for"
  );
}

/** The refusal of more cases or tries than an eval run may run. */
export function evalRunTooLargeMessage(cases: number, tries: number): string {
  return (
    `this eval run would run ${cases} case${cases === 1 ? "" : "s"} and ${tries} tr${tries === 1 ? "y" : "ies"}; ` +
    `an eval run runs at most ${EVAL_RUN_MAX_CASES} cases and ${EVAL_RUN_MAX_TRIES} tries: ` +
    "narrow it with case_glob or case_tags, or lower runs or targets"
  );
}

/** The refusal of an allow_tools entry that names MCP tools of a plugin no try loads. */
export function evalRunOtherPluginToolMessage(entry: string, server: string): string {
  return `allow_tools entry '${entry}' names MCP server '${server}', which is none of the plugins a try loads`;
}

/** The refusal of an allow_tools entry naming an MCP server the agent and its subagents do not write. */
export function evalRunUnknownServerToolMessage(entry: string, server: string): string {
  return `allow_tools entry '${entry}' names MCP server '${server}', which is none of the servers the agent or its subagents write`;
}

/** The not-run reason of a plugin whose cases the eval run does not select. */
export const PLUGIN_NOT_SELECTED_REASON = "not selected";

/** The not-run reason of a plugin with no eval cases at the version a try runs. */
export const PLUGIN_NO_CASES_REASON = "no eval cases at this version";

/** The refusal of a delete while the eval run may still start tries. */
export function evalRunActiveDeleteMessage(evalRunId: string): string {
  return `eval run ${evalRunId} is still running: cancel it first, then delete it`;
}

/** The refusal of a subject's delete while one of its eval runs runs. */
export function evalRunActiveOnSubjectDeleteMessage(subject: "agent" | "plugin", evalRunId: string): string {
  return `this ${subject} has a running eval run (${evalRunId}): cancel it first, then delete the ${subject}`;
}

/**
 * The failed eval run's error when its workflow could not start: a fixed
 * sentence, since every viewer of the subject reads it; the cause is
 * logged.
 */
export const EVAL_RUN_NOT_STARTED_ERROR = "the eval run's workflow could not be started";

/**
 * The error of an eval run whose workflow closed without writing its end:
 * its execution timeout passed, or it was stopped from outside.
 */
export const EVAL_RUN_WORKFLOW_ENDED_ERROR = "the eval run's workflow ended without finishing";

/** The failed eval run's error when its cases cannot be read. */
export const EVAL_RUN_SUITES_UNREADABLE_ERROR = "the plugins' evals could not be read";

/** The cancel's answer when no engine is connected to stop the eval run. */
export const EVAL_RUN_NO_ENGINE_MESSAGE =
  "the eval run cannot be cancelled while the server has no engine connection; try again shortly";
