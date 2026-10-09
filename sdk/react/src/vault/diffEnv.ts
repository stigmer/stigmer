/**
 * The variables a blueprint declares that the user still has to provide,
 * by name: the gap a credential form asks to fill.
 */
import type { EnvVarFormVariable } from "./EnvVarForm.js";

/**
 * Computes the list of environment variables a resource requires that
 * the user has not yet provided.
 *
 * Compares a resource's declared `env` keys against a set of
 * keys already saved in the vaults being checked **and** an optional
 * pool of keys filled elsewhere (the platform's own, which the runner
 * sets). A plain setting whose declaration carries its
 * own value needs nothing from the user. Variables whose keys are missing from both
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
 * @param existingKeys - Secret names already saved in the user's My vault
 *   (or any vault being checked against).
 * @param poolKeys - Optional additional keys filled elsewhere. When
 *   provided, variables satisfied by the pool are also excluded from the
 *   "missing" list.
 * @returns Variables from `envDeclarations` not found in either key set.
 */
export function diffEnv(
  envDeclarations: Record<
    string,
    { isSecret: boolean; description?: string; optional?: boolean; value?: string }
  >,
  existingKeys: Set<string>,
  poolKeys?: Set<string>,
): EnvVarFormVariable[] {
  const missing: EnvVarFormVariable[] = [];

  for (const [key, value] of Object.entries(envDeclarations)) {
    if (existingKeys.has(key)) continue;
    if (!value.isSecret && (value.value ?? "") !== "") continue;
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
