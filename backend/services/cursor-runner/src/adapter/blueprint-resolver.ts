/**
 * Resolves the agent blueprint chain: execution -> session -> agentInstance -> agent.
 *
 * Replicates the Python agent-runner's setup.py pipeline where the full agent
 * resource is fetched to access instructions, sub_agents, skill_refs, and
 * mcp_server_usages. Also merges agent-level and session-level MCP usages
 * and skill refs following the same merge semantics.
 */

import type { StigmerClient } from "../client/stigmer-client.js";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentSpec, McpServerUsage, SubAgent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { SessionSpec } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

export interface ResolvedBlueprint {
  agent: Agent;
  agentSpec: AgentSpec;
  session: Session;
  sessionSpec: SessionSpec;
  instructions: string;
  subAgents: SubAgent[];
  mergedMcpServerUsages: McpServerUsage[];
  mergedSkillRefs: ApiResourceReference[];
  workspaceDirs: string[];
}

/**
 * Resolve the full agent blueprint from the execution chain.
 *
 * Chain: execution.spec.sessionId -> session.spec.agentInstanceId ->
 *        agentInstance.spec.agentId -> agent (with full spec)
 */
export async function resolveBlueprint(
  client: StigmerClient,
  session: Session,
  fallbackWorkspaceDir: string,
): Promise<ResolvedBlueprint> {
  const sessionSpec = session.spec!;

  const agentInstance = await client.getAgentInstance(sessionSpec.agentInstanceId);
  const agentId = agentInstance.spec!.agentId;
  const agent = await client.getAgent(agentId);
  const agentSpec = agent.spec!;

  const mergedMcpServerUsages = mergeMcpServerUsages(
    agentSpec.mcpServerUsages,
    sessionSpec.mcpServerUsages,
  );

  const mergedSkillRefs = mergeSkillRefs(
    agentSpec.skillRefs,
    sessionSpec.skillRefs,
  );

  const workspaceDirs = resolveWorkspaceDirs(sessionSpec, fallbackWorkspaceDir);

  return {
    agent,
    agentSpec,
    session,
    sessionSpec,
    instructions: agentSpec.instructions,
    subAgents: agentSpec.subAgents,
    mergedMcpServerUsages,
    mergedSkillRefs,
    workspaceDirs,
  };
}

/**
 * Merge MCP server usages from agent (base) and session (overlay).
 *
 * Replicates session_context_merge.py::merge_mcp_server_usages():
 * - Agent-level usages are the base set
 * - Session-level usages extend or override by mcp_server_ref.slug
 * - If both reference the same slug, session-level takes precedence
 */
export function mergeMcpServerUsages(
  agentUsages: McpServerUsage[],
  sessionUsages: McpServerUsage[],
): McpServerUsage[] {
  const bySlug = new Map<string, McpServerUsage>();

  for (const usage of agentUsages) {
    const slug = usage.mcpServerRef?.slug;
    if (slug) bySlug.set(slug, usage);
  }

  for (const usage of sessionUsages) {
    const slug = usage.mcpServerRef?.slug;
    if (slug) bySlug.set(slug, usage);
  }

  return [...bySlug.values()];
}

/**
 * Merge skill refs from agent and session.
 *
 * Replicates session_context_merge.py::merge_skill_refs():
 * - Union of both sets, deduplicated by slug
 * - Session refs take precedence on collision (may have different version)
 */
export function mergeSkillRefs(
  agentRefs: ApiResourceReference[],
  sessionRefs: ApiResourceReference[],
): ApiResourceReference[] {
  const bySlug = new Map<string, ApiResourceReference>();

  for (const ref of agentRefs) {
    if (ref.slug) bySlug.set(ref.slug, ref);
  }

  for (const ref of sessionRefs) {
    if (ref.slug) bySlug.set(ref.slug, ref);
  }

  return [...bySlug.values()];
}

/**
 * Resolve workspace directories from session workspace entries.
 *
 * For local path entries: use the local path directly.
 * Falls back to the config's workspaceRootDir when no entries exist.
 */
function resolveWorkspaceDirs(
  sessionSpec: SessionSpec,
  fallbackDir: string,
): string[] {
  if (!sessionSpec.workspaceEntries.length) {
    return [fallbackDir];
  }

  const dirs: string[] = [];
  for (const entry of sessionSpec.workspaceEntries) {
    if (entry.source?.source.case === "localPath") {
      dirs.push(entry.source.source.value.path);
    }
  }

  return dirs.length > 0 ? dirs : [fallbackDir];
}
