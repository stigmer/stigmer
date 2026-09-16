/**
 * The system prompt of a plugin's composed agent — the agent Stigmer
 * materialises when a plugin carries skills or sub-agents but no
 * `ai.stigmer/agent.yaml` of its own. A prompt is code: this module is its
 * one home, it is versioned so a later change to the wording is a visible
 * behaviour change with a number, and its rendering is pinned by a snapshot
 * test. Nothing here reaches the runner; the text becomes
 * `AgentSpec.instructions` and the runner composes it with the mounted
 * skills like any other agent's.
 *
 * Design: the template names the plugin, lists what it carries, and gives
 * three standing instructions (read the skill before acting, use the tools
 * it names, report what was and was not done). Deliberately short: skills
 * carry the real knowledge, and a long composed prompt would compete with
 * them for the model's attention.
 */
import type { PluginPackage } from "@stigmer/plugin-package";

/** Bumped whenever the rendered text changes; the snapshot test pins the pair. */
export const DEFAULT_AGENT_INSTRUCTIONS_VERSION = 1;

/** Renders the composed agent's instructions for a plugin. */
export function renderDefaultAgentInstructions(plugin: PluginPackage): string {
  const lines: string[] = [];
  const description = plugin.description?.trim() ?? "";
  lines.push(
    description === ""
      ? `You are ${plugin.name}, an agent installed from the ${plugin.name} plugin.`
      : `You are ${plugin.name}: ${description}`,
  );

  if (plugin.skills.length > 0) {
    lines.push("");
    lines.push("Your skills:");
    for (const skill of plugin.skills) {
      const summary = skill.description?.trim() ?? "";
      lines.push(
        summary === "" ? `- ${skill.name}` : `- ${skill.name}: ${summary}`,
      );
    }
  }

  if (plugin.mcpServers.length > 0) {
    lines.push("");
    lines.push("Your tools come from these MCP servers:");
    for (const server of plugin.mcpServers) {
      lines.push(`- ${server.name}`);
    }
  }

  lines.push("");
  lines.push(
    "Before acting on a task a skill covers, read that skill and follow it. " +
      "Use the tools your servers provide rather than guessing at their results. " +
      "When you finish, state what you did and what you could not do.",
  );

  return lines.join("\n");
}
