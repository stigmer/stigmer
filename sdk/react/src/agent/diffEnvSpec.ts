import type { AgentEnvFormVariable } from "./AgentEnvForm";

/**
 * Computes the list of environment variables an agent requires that the
 * user has not yet provided.
 *
 * Compares the agent's declared `env_spec.data` keys against a set of
 * keys already present in the user's personal environment. Variables
 * whose keys are missing from `existingKeys` are returned as
 * {@link AgentEnvFormVariable} entries suitable for rendering in
 * {@link AgentEnvForm}.
 *
 * This is a pure function with no side effects — it can be unit-tested
 * independently of hooks, providers, or API calls.
 *
 * @param agentEnvSpecData - The agent's `spec.envSpec.data` record.
 *   Each entry declares a variable the agent needs, with `isSecret`
 *   and an optional `description`.
 * @param existingKeys - Keys already present in the user's personal
 *   environment (or any environment being checked against).
 * @returns Variables from `agentEnvSpecData` not found in `existingKeys`.
 */
export function diffEnvSpec(
  agentEnvSpecData: Record<string, { isSecret: boolean; description?: string }>,
  existingKeys: Set<string>,
): AgentEnvFormVariable[] {
  const missing: AgentEnvFormVariable[] = [];

  for (const [key, value] of Object.entries(agentEnvSpecData)) {
    if (!existingKeys.has(key)) {
      missing.push({
        key,
        isSecret: value.isSecret,
        ...(value.description && { description: value.description }),
      });
    }
  }

  return missing;
}
