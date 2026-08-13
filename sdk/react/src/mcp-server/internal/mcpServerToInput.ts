import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServerInput } from "@stigmer/sdk";

interface EnvVarDeclarationInput {
  isSecret?: boolean;
  description?: string;
  optional?: boolean;
}

/**
 * Converts a fetched McpServer proto to the McpServerInput shape expected
 * by `stigmer.mcpServer.update()`. Enables inline field editing: read
 * the current resource, modify one field, and re-submit the full input.
 *
 * Must be kept exhaustive — any spec field not mapped here will be
 * cleared on the next update (the backend does full spec replacement).
 */
export function mcpServerToInput(server: McpServer): McpServerInput {
  const meta = server.metadata;
  const spec = server.spec;

  let env: Record<string, EnvVarDeclarationInput> | undefined;
  if (spec?.env && Object.keys(spec.env).length > 0) {
    env = {};
    for (const [key, decl] of Object.entries(spec.env)) {
      env[key] = {
        isSecret: decl.isSecret || undefined,
        description: decl.description || undefined,
        optional: decl.optional || undefined,
      };
    }
  }

  const pinnedToolApprovals =
    spec?.pinnedToolApprovals?.length
      ? spec.pinnedToolApprovals.map((p) => ({
          toolName: p.toolName || undefined,
          message: p.message || undefined,
          fromDestructiveHint: p.fromDestructiveHint || undefined,
        }))
      : undefined;

  const auth = spec?.auth
    ? {
        oauthAppRef: spec.auth.oauthAppRef
          ? { org: spec.auth.oauthAppRef.org || "", slug: spec.auth.oauthAppRef.slug }
          : undefined,
        targetEnvVar: spec.auth.targetEnvVar || undefined,
        tokenLifetimeHint: spec.auth.tokenLifetimeHint || undefined,
        scopeHints: spec.auth.scopeHints.length > 0 ? [...spec.auth.scopeHints] : undefined,
        discoveryUrl: spec.auth.discoveryUrl || undefined,
        oauthOnly: spec.auth.oauthOnly || undefined,
      }
    : undefined;

  const input: McpServerInput = {
    name: meta?.name ?? "",
    org: meta?.org ?? "",
    slug: meta?.slug,
    labels: meta?.labels && Object.keys(meta.labels).length > 0
      ? { ...meta.labels }
      : undefined,
    description: spec?.description || undefined,
    iconUrl: spec?.iconUrl || undefined,
    tags: spec?.tags?.length ? [...spec.tags] : undefined,
    defaultEnabledTools: spec?.defaultEnabledTools?.length
      ? [...spec.defaultEnabledTools]
      : undefined,
    env,
    pinnedToolApprovals,
    repositoryUrl: spec?.repositoryUrl || undefined,
    githubStars: spec?.githubStars || undefined,
    auth,
  };

  if (spec?.serverType?.case === "stdio") {
    input.stdio = {
      command: spec.serverType.value.command,
      args: spec.serverType.value.args.length > 0
        ? [...spec.serverType.value.args]
        : undefined,
      workingDir: spec.serverType.value.workingDir || undefined,
    };
  } else if (spec?.serverType?.case === "http") {
    input.http = {
      url: spec.serverType.value.url,
      headers: spec.serverType.value.headers && Object.keys(spec.serverType.value.headers).length > 0
        ? { ...spec.serverType.value.headers }
        : undefined,
      queryParams: spec.serverType.value.queryParams && Object.keys(spec.serverType.value.queryParams).length > 0
        ? { ...spec.serverType.value.queryParams }
        : undefined,
      timeoutSeconds: spec.serverType.value.timeoutSeconds || undefined,
    };
  }

  return input;
}
