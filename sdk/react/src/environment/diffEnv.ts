import type { EnvVarFormVariable } from "./EnvVarForm.js";

/**
 * Computes the list of environment variables a resource requires that
 * the user has not yet provided.
 *
 * Compares a resource's declared `env` keys against a set of
 * keys already present in the user's personal environment **and** an
 * optional session-level env pool (manual secrets, one-time env vars
 * from other components). Variables whose keys are missing from both
 * sources are returned as {@link EnvVarFormVariable} entries suitable
 * for rendering in {@link EnvVarForm}.
 *
 * Works with any resource that declares env var declarations — Agents,
 * MCP servers, or future resource types.
 *
 * This is a pure function with no side effects — it can be unit-tested
 * independently of hooks, providers, or API calls.
 *
 * @param envDeclarations - The resource's `spec.env` record.
 *   Each entry declares a variable the resource needs, with `isSecret`,
 *   an optional `description`, and an `optional` flag.
 * @param existingKeys - Keys already present in the user's personal
 *   environment (or any environment being checked against).
 * @param poolKeys - Optional additional keys from the session env pool
 *   (manual secrets, one-time env vars from other agents/MCP servers).
 *   When provided, variables satisfied by the pool are also excluded
 *   from the "missing" list.
 * @returns Variables from `envDeclarations` not found in either key set.
 */
export function diffEnv(
  envDeclarations: Record<string, { isSecret: boolean; description?: string; optional?: boolean }>,
  existingKeys: Set<string>,
  poolKeys?: Set<string>,
): EnvVarFormVariable[] {
  const missing: EnvVarFormVariable[] = [];

  for (const [key, value] of Object.entries(envDeclarations)) {
    if (existingKeys.has(key)) continue;
    if (poolKeys?.has(key)) continue;

    missing.push({
      key,
      isSecret: value.isSecret,
      ...(value.description && { description: value.description }),
      ...(value.optional && { optional: true }),
    });
  }

  return missing;
}
