/**
 * Switching a plugin's hooks on for an agent, as one spec edit.
 *
 * Both ways in write the same spec: the plugin page's "Add to an agent"
 * (`useAddPluginToAgent`) and the agent page's Hooks section. The agent's
 * `hooks` gains the plugin as a source unless it already lists it, and every
 * `${user_config.KEY}` the plugin's hooks read is declared in the agent's
 * `env`, as a required secret, unless the agent declares it already. That
 * is what install does for the agent it composes (a variable the plugin did
 * not declare becomes a required secret), and without it the runner refuses
 * the agent's next turn for an undeclared variable. A declared variable is
 * asked for when a session starts. The names come from the plugin library's
 * `hookVariableReferences`, the rule install reads.
 */

import type { HookConfig } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { hookVariableReferences } from "@stigmer/plugin-package";
import type { AgentInput, HookSourceInput, ResourceRef } from "@stigmer/sdk";

/**
 * The variables a plugin's hooks read that the agent does not declare yet,
 * in first-seen order: what switching the hooks on adds to its `env`.
 */
export function hookVariablesToDeclare(input: AgentInput, config: HookConfig | undefined): readonly string[] {
  if (config === undefined) return [];
  const declared = input.env ?? {};
  return hookVariableReferences(config).filter((name) => !Object.hasOwn(declared, name));
}

/** Whether the agent's hooks already name this plugin, compared by org and slug. */
export function listsPluginHooks(input: AgentInput, ref: ResourceRef): boolean {
  return (input.hooks ?? []).some((source) => sameRef(source, ref));
}

/**
 * The agent's input with the plugin's hooks switched on: the plugin
 * appended to `hooks` unless listed, and the variables its hooks read
 * declared as required secrets unless declared. Everything else, the
 * inline block and other plugins included, is kept as it is.
 */
export function withPluginHooks(input: AgentInput, ref: ResourceRef, config: HookConfig | undefined): AgentInput {
  const hooks: HookSourceInput[] = listsPluginHooks(input, ref)
    ? [...(input.hooks ?? [])]
    : [...(input.hooks ?? []), { plugin: { org: ref.org, slug: ref.slug } }];
  const missing = hookVariablesToDeclare(input, config);
  if (missing.length === 0) return { ...input, hooks };
  const env = { ...(input.env ?? {}) };
  for (const name of missing) env[name] = { isSecret: true };
  return { ...input, hooks, env };
}

function sameRef(source: HookSourceInput, ref: ResourceRef): boolean {
  return source.plugin !== undefined && source.plugin.org === ref.org && source.plugin.slug === ref.slug;
}
