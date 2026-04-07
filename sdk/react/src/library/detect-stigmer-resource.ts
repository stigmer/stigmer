import { parse as parseYaml } from "yaml";

/**
 * Resource kinds that the YAML detection logic recognizes.
 *
 * These correspond to the Stigmer resource types that can appear as
 * YAML file artifacts and be applied to an organization via `apply()`:
 *
 * - `"Agent"` — agent blueprint (`apiVersion: agentic.stigmer.ai/v1`, `kind: Agent`)
 * - `"McpServer"` — MCP server definition (`kind: McpServer`)
 *
 * Skills are **not** included here — they are package-based (directory
 * artifacts with SKILL.md) and use a separate detection path via
 * {@link isSkillPackage} / {@link detectSkillPackage}.
 */
export type StigmerResourceKind = "Agent" | "McpServer";

/**
 * Result of detecting a Stigmer resource in a YAML content string.
 *
 * Uses a discriminated union on the `detected` field so consumers
 * can narrow the type with a simple `if (result.detected)` check.
 */
export type StigmerResourceDetection =
  | {
      /** Discriminant — `false` when no recognized resource was found. */
      readonly detected: false;
    }
  | {
      /** Discriminant — always `true` when a resource was found. */
      readonly detected: true;
      /** The `apiVersion` field from the YAML (e.g. `"agentic.stigmer.ai/v1"`). */
      readonly apiVersion: string;
      /** The resource kind as it appears in the YAML. */
      readonly kind: StigmerResourceKind;
      /** Human-readable label for the resource kind (e.g. `"MCP Server"`). */
      readonly displayName: string;
      /** The `metadata.name` field from the YAML. */
      readonly resourceName: string;
      /** The `metadata.org` field from the YAML, if present. */
      readonly resourceOrg: string | undefined;
    };

const NOT_DETECTED: StigmerResourceDetection = { detected: false } as const;

const KIND_DISPLAY_NAMES: Record<StigmerResourceKind, string> = {
  Agent: "Agent",
  McpServer: "MCP Server",
};

const KNOWN_KINDS = new Set<string>(Object.keys(KIND_DISPLAY_NAMES));

const STIGMER_API_VERSION_PATTERN = /^[a-z]+\.stigmer\.ai\/v\d+$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Detects whether a YAML content string represents a Stigmer platform resource.
 *
 * Performs a best-effort structural check against the Stigmer resource
 * convention: a YAML document with `apiVersion` matching `*.stigmer.ai/*`,
 * a recognized `kind`, and `metadata.name`.
 *
 * **Resilient by design** — any parse failure, missing field, or unexpected
 * structure returns `{ detected: false }`. This function never throws.
 *
 * Only the first YAML document is inspected when the content contains
 * multiple documents separated by `---`.
 *
 * @param content - Raw YAML content string (typically from {@link useArtifactContent}).
 * @returns A discriminated union: `{ detected: true, kind, ... }` when a
 *   recognized Stigmer resource is found, `{ detected: false }` otherwise.
 *
 * @example
 * ```ts
 * const result = detectStigmerResource(yamlString);
 * if (result.detected) {
 *   console.log(`Found ${result.displayName}: ${result.resourceName}`);
 * }
 * ```
 *
 * @see {@link useDetectStigmerResource} for the React hook wrapper
 * @see {@link StigmerResourceKind} for recognized resource kinds
 */
export function detectStigmerResource(
  content: string,
): StigmerResourceDetection {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch {
    return NOT_DETECTED;
  }

  if (!isPlainObject(parsed)) {
    return NOT_DETECTED;
  }

  const { apiVersion, kind, metadata } = parsed;

  if (typeof apiVersion !== "string" || !STIGMER_API_VERSION_PATTERN.test(apiVersion)) {
    return NOT_DETECTED;
  }

  if (typeof kind !== "string" || !KNOWN_KINDS.has(kind)) {
    return NOT_DETECTED;
  }

  if (!isPlainObject(metadata)) {
    return NOT_DETECTED;
  }

  const name = metadata.name;
  if (typeof name !== "string" || name.length === 0) {
    return NOT_DETECTED;
  }

  const resourceKind = kind as StigmerResourceKind;

  return {
    detected: true,
    apiVersion,
    kind: resourceKind,
    displayName: KIND_DISPLAY_NAMES[resourceKind],
    resourceName: name,
    resourceOrg:
      typeof metadata.org === "string" && metadata.org.length > 0
        ? metadata.org
        : undefined,
  };
}
