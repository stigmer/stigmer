import { parse as parseYaml } from "yaml";
import type {
  AgentInput,
  McpServerInput,
  McpServerUsageInput,
  ToolApprovalOverrideInput,
  SubAgentInput,
  McpAccessInput,
  StdioServerConfigInput,
  HttpServerConfigInput,
  ToolApprovalPolicyInput,
  ResourceRef,
} from "@stigmer/sdk";
import type { StigmerResourceKind } from "./detect-stigmer-resource.js";

/**
 * Result of parsing a Stigmer resource YAML into an SDK input type.
 *
 * Discriminated on `kind` so consumers can narrow to the specific input:
 *
 * ```ts
 * const parsed = parseResourceYaml(content, "my-org");
 * if (parsed.kind === "Agent") {
 *   // parsed.input is AgentInput
 * }
 * ```
 */
export type ParsedResource =
  | {
      /** The parsed resource is an Agent blueprint. */
      readonly kind: "Agent";
      /** SDK input suitable for `stigmer.agent.apply()`. */
      readonly input: AgentInput;
    }
  | {
      /** The parsed resource is an MCP server definition. */
      readonly kind: "McpServer";
      /** SDK input suitable for `stigmer.mcpServer.apply()`. */
      readonly input: McpServerInput;
    };

/**
 * Parses a Stigmer resource YAML string into the corresponding SDK input
 * type for use with `stigmer.agent.apply()` or `stigmer.mcpServer.apply()`.
 *
 * Handles the conversion from proto-style snake_case YAML field names to
 * the camelCase TypeScript SDK input types, including nested structures
 * like `mcp_server_usages`, `sub_agents`, and `env`.
 *
 * The `org` parameter **always overrides** `metadata.org` in the YAML.
 * This matches the UX intent of "Apply to [my-org]" — the user explicitly
 * chooses the target organization.
 *
 * **Throws** with descriptive, user-facing error messages when the YAML
 * is malformed or missing required fields. These messages are designed
 * for display in error UI components.
 *
 * @param content - Raw YAML content string (typically from {@link useArtifactContent}).
 * @param org - Target organization slug. Overrides `metadata.org` in the YAML.
 * @returns A discriminated union with the parsed SDK input.
 * @throws {Error} When the content is not valid YAML, not a recognized
 *   Stigmer resource, or is missing required fields.
 *
 * @example
 * ```ts
 * import { parseResourceYaml } from "@stigmer/react";
 *
 * const parsed = parseResourceYaml(yamlContent, "my-org");
 * if (parsed.kind === "Agent") {
 *   await stigmer.agent.apply(parsed.input);
 * } else {
 *   await stigmer.mcpServer.apply(parsed.input);
 * }
 * ```
 *
 * @see {@link useApplyResource} for the React hook that wraps this function
 * @see {@link detectStigmerResource} for lightweight detection without full parsing
 */
export function parseResourceYaml(
  content: string,
  org: string,
): ParsedResource {
  const doc = parseYamlDocument(content);
  const { kind, metadata, spec } = validateResourceStructure(doc);

  const name = extractRequiredString(metadata, "name", "metadata.name");
  const slug = extractOptionalString(metadata, "slug");
  const labels = extractOptionalStringRecord(metadata, "labels");

  switch (kind) {
    case "Agent":
      return {
        kind: "Agent",
        input: buildAgentInput(name, slug, org, labels, spec),
      };
    case "McpServer":
      return {
        kind: "McpServer",
        input: buildMcpServerInput(name, slug, org, labels, spec),
      };
    default:
      throw new Error(
        `Unsupported resource kind: "${kind}". ` +
          "Only Agent and McpServer can be applied from artifacts.",
      );
  }
}

// ---------------------------------------------------------------------------
// YAML parsing
// ---------------------------------------------------------------------------

function parseYamlDocument(content: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseYaml(content);
  } catch {
    throw new Error("Failed to parse artifact content as YAML.");
  }

  if (!isPlainObject(parsed)) {
    throw new Error(
      "Failed to parse artifact content as YAML: expected a mapping document.",
    );
  }

  return parsed;
}

// ---------------------------------------------------------------------------
// Structure validation
// ---------------------------------------------------------------------------

interface ValidatedStructure {
  readonly kind: string;
  readonly metadata: Record<string, unknown>;
  readonly spec: Record<string, unknown>;
}

const STIGMER_API_VERSION_PATTERN = /^[a-z]+\.stigmer\.ai\/v\d+$/;

const APPLICABLE_KINDS: ReadonlySet<string> = new Set<StigmerResourceKind>([
  "Agent",
  "McpServer",
]);

function validateResourceStructure(
  doc: Record<string, unknown>,
): ValidatedStructure {
  const apiVersion = doc.apiVersion ?? doc.api_version;
  if (
    typeof apiVersion !== "string" ||
    !STIGMER_API_VERSION_PATTERN.test(apiVersion)
  ) {
    throw new Error(
      "Resource YAML is missing required field: apiVersion " +
        "(expected pattern: *.stigmer.ai/v*).",
    );
  }

  const kind = doc.kind;
  if (typeof kind !== "string" || kind.length === 0) {
    throw new Error("Resource YAML is missing required field: kind.");
  }

  if (!APPLICABLE_KINDS.has(kind)) {
    throw new Error(
      `Unsupported resource kind: "${kind}". ` +
        "Only Agent and McpServer can be applied from artifacts.",
    );
  }

  const metadata = doc.metadata;
  if (!isPlainObject(metadata)) {
    throw new Error("Resource YAML is missing required field: metadata.");
  }

  const spec = doc.spec;
  if (!isPlainObject(spec)) {
    throw new Error("Resource YAML is missing required field: spec.");
  }

  return { kind, metadata, spec };
}

// ---------------------------------------------------------------------------
// Agent conversion
// ---------------------------------------------------------------------------

function buildAgentInput(
  name: string,
  slug: string | undefined,
  org: string,
  labels: Record<string, string> | undefined,
  spec: Record<string, unknown>,
): AgentInput {
  return {
    name,
    org,
    ...(slug !== undefined && { slug }),
    ...(labels !== undefined && { labels }),
    ...optionalString(spec, "description", "description"),
    ...optionalSnakeToCamel(spec, "icon_url", "iconUrl"),
    ...optionalString(spec, "instructions", "instructions"),
    ...optionalField("mcpServerUsages", extractMcpServerUsages(spec)),
    ...optionalField("skillRefs", extractResourceRefs(spec, "skill_refs")),
    ...optionalField("subAgents", extractSubAgents(spec)),
    ...optionalField("env", extractEnv(spec)),
  };
}

function extractMcpServerUsages(
  spec: Record<string, unknown>,
): McpServerUsageInput[] | undefined {
  const raw = spec.mcp_server_usages ?? spec.mcpServerUsages;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  return raw.filter(isPlainObject).map(
    (entry): McpServerUsageInput => {
      const refObj = entry.mcp_server_ref ?? entry.mcpServerRef;
      if (!isPlainObject(refObj)) {
        throw new Error(
          "Agent YAML: each mcp_server_usages entry must have a mcp_server_ref.",
        );
      }

      return {
        mcpServerRef: extractResourceRef(refObj),
        ...optionalStringArray(entry, "enabled_tools", "enabledTools"),
        ...optionalMappedArray(
          entry,
          "tool_approval_overrides",
          "toolApprovalOverrides",
          extractToolApprovalOverride,
        ),
      };
    },
  );
}

function extractToolApprovalOverride(
  raw: Record<string, unknown>,
): ToolApprovalOverrideInput {
  return {
    ...optionalSnakeToCamel(raw, "tool_name", "toolName"),
    ...optionalSnakeToCamelBool(raw, "requires_approval", "requiresApproval"),
    ...optionalString(raw, "message", "message"),
  };
}

function extractSubAgents(
  spec: Record<string, unknown>,
): SubAgentInput[] | undefined {
  const raw = spec.sub_agents ?? spec.subAgents;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  return raw.filter(isPlainObject).map((entry): SubAgentInput => {
    const entryName = entry.name;
    if (typeof entryName !== "string" || entryName.length === 0) {
      throw new Error(
        "Agent YAML: each sub_agents entry must have a non-empty name.",
      );
    }

    return {
      name: entryName,
      ...optionalString(entry, "description", "description"),
      ...optionalString(entry, "instructions", "instructions"),
      ...optionalSnakeToCamel(entry, "model_override", "modelOverride"),
      ...optionalMappedArray(
        entry,
        "mcp_access",
        "mcpAccess",
        extractMcpAccess,
      ),
      ...optionalField(
        "skillRefs",
        extractResourceRefs(entry as Record<string, unknown>, "skill_refs"),
      ),
    };
  });
}

function extractMcpAccess(raw: Record<string, unknown>): McpAccessInput {
  const mcpServer = raw.mcp_server ?? raw.mcpServer;
  if (typeof mcpServer !== "string" || mcpServer.length === 0) {
    throw new Error(
      "Agent YAML: each mcp_access entry must have a non-empty mcp_server.",
    );
  }

  return {
    mcpServer,
    ...optionalStringArray(raw, "enabled_tools", "enabledTools"),
  };
}

// ---------------------------------------------------------------------------
// McpServer conversion
// ---------------------------------------------------------------------------

function buildMcpServerInput(
  name: string,
  slug: string | undefined,
  org: string,
  labels: Record<string, string> | undefined,
  spec: Record<string, unknown>,
): McpServerInput {
  const stdio = extractStdioConfig(spec);
  const http = extractHttpConfig(spec);

  if (!stdio && !http) {
    throw new Error(
      "McpServer YAML must specify either spec.stdio or spec.http.",
    );
  }

  return {
    name,
    org,
    ...(slug !== undefined && { slug }),
    ...(labels !== undefined && { labels }),
    ...optionalString(spec, "description", "description"),
    ...optionalSnakeToCamel(spec, "icon_url", "iconUrl"),
    ...optionalField("stdio", stdio),
    ...optionalField("http", http),
    ...optionalStringArrayFromSnake(spec, "default_enabled_tools", "defaultEnabledTools"),
    ...optionalMappedArray(
      spec,
      "pinned_tool_approvals",
      "pinnedToolApprovals",
      extractToolApprovalPolicy,
    ),
    ...optionalField("env", extractEnv(spec)),
  };
}

function extractStdioConfig(
  spec: Record<string, unknown>,
): StdioServerConfigInput | undefined {
  const raw = spec.stdio;
  if (!isPlainObject(raw)) return undefined;

  const command = raw.command;
  if (typeof command !== "string" || command.length === 0) {
    throw new Error(
      "McpServer YAML: spec.stdio must have a non-empty command.",
    );
  }

  return {
    command,
    ...optionalStringArray(raw, "args", "args"),
    ...optionalSnakeToCamel(raw, "working_dir", "workingDir"),
  };
}

function extractHttpConfig(
  spec: Record<string, unknown>,
): HttpServerConfigInput | undefined {
  const raw = spec.http;
  if (!isPlainObject(raw)) return undefined;

  const url = raw.url;
  if (typeof url !== "string" || url.length === 0) {
    throw new Error("McpServer YAML: spec.http must have a non-empty url.");
  }

  return {
    url,
    ...optionalStringRecord(raw, "headers", "headers"),
    ...optionalStringRecordSnake(raw, "query_params", "queryParams"),
    ...optionalSnakeToCamelNumber(raw, "timeout_seconds", "timeoutSeconds"),
  };
}

function extractToolApprovalPolicy(
  raw: Record<string, unknown>,
): ToolApprovalPolicyInput {
  return {
    ...optionalSnakeToCamel(raw, "tool_name", "toolName"),
    ...optionalString(raw, "message", "message"),
  };
}

// ---------------------------------------------------------------------------
// Shared extractors
// ---------------------------------------------------------------------------

function extractEnv(
  spec: Record<string, unknown>,
): Record<string, { isSecret?: boolean; description?: string; optional?: boolean }> | undefined {
  // Support both new flat `env` and legacy nested `env_spec.data` / `envSpec.data`.
  let envMap: Record<string, unknown> | undefined;

  const envRaw = spec.env;
  if (isPlainObject(envRaw)) {
    envMap = envRaw;
  } else {
    const envSpecRaw = spec.env_spec ?? spec.envSpec;
    if (isPlainObject(envSpecRaw)) {
      const data = envSpecRaw.data ?? envSpecRaw.variables;
      if (isPlainObject(data)) {
        envMap = data;
      }
    }
  }

  if (!envMap) return undefined;

  const result: Record<string, { isSecret?: boolean; description?: string; optional?: boolean }> = {};
  let hasEntries = false;

  for (const [key, val] of Object.entries(envMap)) {
    if (!isPlainObject(val)) continue;

    const isSecret = val.is_secret ?? val.isSecret;
    const description = val.description;
    const optional = val.optional;

    result[key] = {
      ...(typeof isSecret === "boolean" && { isSecret }),
      ...(typeof description === "string" && { description }),
      ...(typeof optional === "boolean" && { optional }),
    };
    hasEntries = true;
  }

  return hasEntries ? result : undefined;
}

function extractResourceRef(raw: Record<string, unknown>): ResourceRef {
  const org = raw.org;
  const slug = raw.slug;

  if (typeof org !== "string" || org.length === 0) {
    throw new Error("Resource reference must have a non-empty org.");
  }
  if (typeof slug !== "string" || slug.length === 0) {
    throw new Error("Resource reference must have a non-empty slug.");
  }

  return {
    org,
    slug,
    ...(typeof raw.version === "string" &&
      raw.version.length > 0 && { version: raw.version }),
    ...(typeof raw.kind === "number" && { kind: raw.kind }),
  };
}

function extractResourceRefs(
  container: Record<string, unknown>,
  snakeKey: string,
): ResourceRef[] | undefined {
  const camelKey = snakeToCamel(snakeKey);
  const raw = container[snakeKey] ?? container[camelKey];
  if (!Array.isArray(raw) || raw.length === 0) return undefined;

  return raw.filter(isPlainObject).map(extractResourceRef);
}

// ---------------------------------------------------------------------------
// Field extraction helpers — return spreadable partials
// ---------------------------------------------------------------------------

function optionalField<K extends string, V>(
  key: K,
  value: V | undefined,
): { [P in K]: V } | undefined {
  if (value === undefined) return undefined;
  return { [key]: value } as { [P in K]: V };
}

function optionalString<K extends string>(
  obj: Record<string, unknown>,
  sourceKey: string,
  targetKey: K,
): { [P in K]: string } | undefined {
  const val = obj[sourceKey];
  if (typeof val !== "string") return undefined;
  return { [targetKey]: val } as { [P in K]: string };
}

function optionalSnakeToCamel<K extends string>(
  obj: Record<string, unknown>,
  snakeKey: string,
  camelKey: K,
): { [P in K]: string } | undefined {
  const val = obj[snakeKey] ?? obj[camelKey];
  if (typeof val !== "string") return undefined;
  return { [camelKey]: val } as { [P in K]: string };
}

function optionalSnakeToCamelBool<K extends string>(
  obj: Record<string, unknown>,
  snakeKey: string,
  camelKey: K,
): { [P in K]: boolean } | undefined {
  const val = obj[snakeKey] ?? obj[camelKey];
  if (typeof val !== "boolean") return undefined;
  return { [camelKey]: val } as { [P in K]: boolean };
}

function optionalSnakeToCamelNumber<K extends string>(
  obj: Record<string, unknown>,
  snakeKey: string,
  camelKey: K,
): { [P in K]: number } | undefined {
  const val = obj[snakeKey] ?? obj[camelKey];
  if (typeof val !== "number" || !Number.isFinite(val)) return undefined;
  return { [camelKey]: val } as { [P in K]: number };
}

function optionalStringArray<K extends string>(
  obj: Record<string, unknown>,
  sourceKey: string,
  targetKey: K,
): { [P in K]: string[] } | undefined {
  const val = obj[sourceKey] ?? obj[targetKey];
  if (!Array.isArray(val)) return undefined;
  const filtered = val.filter((v): v is string => typeof v === "string");
  if (filtered.length === 0) return undefined;
  return { [targetKey]: filtered } as { [P in K]: string[] };
}

function optionalStringArrayFromSnake<K extends string>(
  obj: Record<string, unknown>,
  snakeKey: string,
  camelKey: K,
): { [P in K]: string[] } | undefined {
  const val = obj[snakeKey] ?? obj[camelKey];
  if (!Array.isArray(val)) return undefined;
  const filtered = val.filter((v): v is string => typeof v === "string");
  if (filtered.length === 0) return undefined;
  return { [camelKey]: filtered } as { [P in K]: string[] };
}

function optionalStringRecord<K extends string>(
  obj: Record<string, unknown>,
  sourceKey: string,
  targetKey: K,
): { [P in K]: Record<string, string> } | undefined {
  const val = obj[sourceKey];
  if (!isPlainObject(val)) return undefined;
  return { [targetKey]: toStringRecord(val) } as {
    [P in K]: Record<string, string>;
  };
}

function optionalStringRecordSnake<K extends string>(
  obj: Record<string, unknown>,
  snakeKey: string,
  camelKey: K,
): { [P in K]: Record<string, string> } | undefined {
  const val = obj[snakeKey] ?? obj[camelKey];
  if (!isPlainObject(val)) return undefined;
  return { [camelKey]: toStringRecord(val) } as {
    [P in K]: Record<string, string>;
  };
}

function optionalMappedArray<K extends string, T>(
  obj: Record<string, unknown>,
  snakeKey: string,
  camelKey: K,
  mapper: (item: Record<string, unknown>) => T,
): { [P in K]: T[] } | undefined {
  const raw = obj[snakeKey] ?? obj[camelKey];
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const mapped = raw.filter(isPlainObject).map(mapper);
  if (mapped.length === 0) return undefined;
  return { [camelKey]: mapped } as { [P in K]: T[] };
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

function extractRequiredString(
  obj: Record<string, unknown>,
  key: string,
  displayPath: string,
): string {
  const val = obj[key];
  if (typeof val !== "string" || val.length === 0) {
    throw new Error(
      `Resource YAML is missing required field: ${displayPath}.`,
    );
  }
  return val;
}

function extractOptionalString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
  const val = obj[key];
  return typeof val === "string" && val.length > 0 ? val : undefined;
}

function extractOptionalStringRecord(
  obj: Record<string, unknown>,
  key: string,
): Record<string, string> | undefined {
  const val = obj[key];
  if (!isPlainObject(val)) return undefined;
  return toStringRecord(val);
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toStringRecord(obj: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") result[k] = v;
    else if (v !== null && v !== undefined) result[k] = String(v);
  }
  return result;
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}
