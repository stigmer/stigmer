/**
 * Putting a plugin on an agent, as one spec edit: the plugin appended to
 * the agent's `plugins` unless it lists it already.
 *
 * A plugin is used whole: listing it gives the agent the plugin's skills,
 * its agents, its hooks and its MCP servers, and the plugin carries the
 * declarations of the keys they read, so nothing else on the agent changes.
 * Both ways in write this edit: the plugin page's "Add to an agent"
 * (`useAddPluginToAgent`) and the agent page's Plugins section. References
 * are compared by organization and slug; one without an organization names
 * the agent's own, as the server reads it.
 */

import type { AgentInput, ResourceRef } from "@stigmer/sdk";

/** Whether the agent's `plugins` already name this plugin. */
export function listsPlugin(input: AgentInput, ref: ResourceRef): boolean {
  return (input.plugins ?? []).some((listed) => sameRef(listed, ref, input.org));
}

/**
 * The agent's input with the plugin appended to `plugins` unless listed.
 * Everything else, the agent's other plugins and their order included, is
 * kept as it is.
 */
export function withPlugin(input: AgentInput, ref: ResourceRef): AgentInput {
  if (listsPlugin(input, ref)) return input;
  return { ...input, plugins: [...(input.plugins ?? []), { org: ref.org, slug: ref.slug }] };
}

function sameRef(listed: ResourceRef, ref: ResourceRef, agentOrg: string): boolean {
  return (listed.org || agentOrg) === (ref.org || agentOrg) && listed.slug === ref.slug;
}
