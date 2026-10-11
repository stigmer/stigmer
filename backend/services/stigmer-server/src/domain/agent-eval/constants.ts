/**
 * Agent-eval domain constants: the refusals the create, delete and cascade
 * chains answer, and the reasons a stamped plugin's cases do not run. An
 * agent eval's tries carry the plugin eval's reserved label, valued with
 * the agent eval's id (domain/plugin-eval/constants.ts PLUGIN_EVAL_LABEL),
 * and are held to the plugin eval's suite limits across every plugin.
 */

/** The create lane's deny copy when the caller cannot edit the agent. */
export const AGENT_EVAL_CREATE_DENIED_MESSAGE = "unauthorized to run evals of agent";

/** The refusal of an organization that is not the agent's. */
export function agentEvalOrgMismatchMessage(agentOrg: string): string {
  return `metadata.org must be the agent's organization (${agentOrg})`;
}

/** The refusal of an agent version that attaches no plugin: its cases live in plugins. */
export const AGENT_EVAL_NO_PLUGINS_MESSAGE =
  "this agent version attaches no plugin, and an agent's eval cases are its plugins': attach a plugin with eval cases, then run the eval";

/** The refusal of a spec.plugins entry the agent does not attach. */
export function agentEvalUnknownPluginMessage(slug: string): string {
  return `spec.plugins names '${slug}', which this agent version does not attach`;
}

/** The refusal of an eval none of whose plugins has cases to run. */
export const AGENT_EVAL_NO_CASES_MESSAGE =
  "none of the plugins this eval runs has eval cases at the version the agent attaches";

/** The refusal of an allow_tools entry that names MCP tools of a plugin the agent does not attach. */
export function agentEvalOtherPluginToolMessage(entry: string, server: string): string {
  return `allow_tools entry '${entry}' names MCP server '${server}', which is none of the agent's plugins'`;
}

/** The not-run reason of a plugin spec.plugins leaves out. */
export const PLUGIN_NOT_SELECTED_REASON = "not selected";

/** The not-run reason of a plugin with no eval cases at the version the agent attaches. */
export const PLUGIN_NO_CASES_REASON = "no eval cases at this version";

/** The refusal of a delete while the eval may still start tries. */
export function agentEvalActiveDeleteMessage(evalId: string): string {
  return `agent eval ${evalId} is still running: cancel it first, then delete it`;
}

/** The refusal of an agent delete while one of its evals runs. */
export function agentEvalActiveOnAgentDeleteMessage(evalId: string): string {
  return `this agent has a running eval (${evalId}): cancel it first, then delete the agent`;
}

/** The failed eval's error when its suite cannot be read. */
export const AGENT_EVAL_SUITES_UNREADABLE_ERROR = "the plugins' evals could not be read";
