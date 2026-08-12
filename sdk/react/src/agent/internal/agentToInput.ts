import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type {
  AgentInput,
  EnvVarDeclarationInput,
  McpServerUsageInput,
  SubAgentInput,
} from "@stigmer/sdk";

/**
 * Converts a fetched Agent proto to the AgentInput shape expected by
 * `stigmer.agent.update()`. This enables inline field editing: read the
 * current resource, modify one field, and re-submit the full input.
 *
 * Must be kept exhaustive — any spec field not mapped here will be
 * cleared on the next update (the backend does full spec replacement).
 * Enforced by `__tests__/agentToInput.test.ts`: a schema tripwire fails
 * when `AgentSpec` gains a field this converter does not round-trip
 * (stigmer/stigmer#319 was exactly such a drop).
 */
export function agentToInput(agent: Agent): AgentInput {
  const meta = agent.metadata;
  const spec = agent.spec;

  // Resource refs preserve `version` (the tag/hash pin on versioned
  // resources like Skills) — dropping it would silently reset a pinned
  // reference to "latest" on the next inline edit.
  const mcpServerUsages: McpServerUsageInput[] | undefined =
    spec?.mcpServerUsages?.map((usage) => ({
      mcpServerRef: {
        org: usage.mcpServerRef?.org ?? "",
        slug: usage.mcpServerRef?.slug ?? "",
        version: usage.mcpServerRef?.version || undefined,
      },
      enabledTools: usage.enabledTools.length > 0 ? [...usage.enabledTools] : undefined,
      toolApprovalOverrides:
        usage.toolApprovalOverrides.length > 0
          ? usage.toolApprovalOverrides.map((o) => ({
              toolName: o.toolName,
              requiresApproval: o.requiresApproval,
              message: o.message || undefined,
            }))
          : undefined,
    }));

  const skillRefs =
    spec?.skillRefs?.map((ref) => ({
      org: ref.org || "",
      slug: ref.slug,
      version: ref.version || undefined,
    }));

  const subAgents: SubAgentInput[] | undefined =
    spec?.subAgents?.map((sa) => ({
      name: sa.name,
      description: sa.description || undefined,
      instructions: sa.instructions || undefined,
      mcpAccess:
        sa.mcpAccess.length > 0
          ? sa.mcpAccess.map((a) => ({
              mcpServer: a.mcpServer,
              enabledTools: a.enabledTools.length > 0 ? [...a.enabledTools] : undefined,
            }))
          : undefined,
      skillRefs:
        sa.skillRefs.length > 0
          ? sa.skillRefs.map((r) => ({
              org: r.org || "",
              slug: r.slug,
              version: r.version || undefined,
            }))
          : undefined,
      modelOverride: sa.modelOverride || undefined,
    }));

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

  return {
    name: meta?.name ?? "",
    org: meta?.org ?? "",
    slug: meta?.slug,
    labels: meta?.labels && Object.keys(meta.labels).length > 0
      ? { ...meta.labels }
      : undefined,
    description: spec?.description || undefined,
    iconUrl: spec?.iconUrl || undefined,
    instructions: spec?.instructions || undefined,
    mcpServerUsages: mcpServerUsages?.length ? mcpServerUsages : undefined,
    skillRefs: skillRefs?.length ? skillRefs : undefined,
    subAgents: subAgents?.length ? subAgents : undefined,
    env,
  };
}
