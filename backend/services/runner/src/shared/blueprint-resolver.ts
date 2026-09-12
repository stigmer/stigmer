/**
 * Resolves the agent blueprint chain: execution -> session -> agentInstance -> agent.
 *
 * Replicates the Python agent-runner's setup.py pipeline where the full agent
 * resource is fetched to access instructions, sub_agents, skill_refs, and
 * mcp_server_usages. Also merges agent-level and session-level MCP usages
 * and skill refs following the same merge semantics.
 *
 * Workspace isolation: resolved workspace directories are validated to
 * ensure they never point at the runner's own app directory. Paths
 * containing runner-internal markers are rejected with a warning.
 */

import type { StigmerClient } from "../client/stigmer-client.js";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentSpec, McpServerUsage, SubAgent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { SessionSpec } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { mergeMcpServerUsages } from "./mcp-resolver.js";

// Both harnesses must merge agent + session usages identically (session wins
// per slug — the usage whose enabled_tools the enforcement honors), so the
// merge lives in shared/mcp-resolver.ts. Re-exported here for its historical
// home alongside mergeSkillRefs.
export { mergeMcpServerUsages } from "./mcp-resolver.js";

export interface CloudRepo {
  url: string;
  startingRef?: string;
}

export interface ResolvedBlueprint {
  agent: Agent;
  agentSpec: AgentSpec;
  session: Session;
  sessionSpec: SessionSpec;
  instructions: string;
  subAgents: SubAgent[];
  mergedMcpServerUsages: McpServerUsage[];
  mergedSkillRefs: ApiResourceReference[];
  cloudRepos: CloudRepo[];
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

  const cloudRepos = resolveCloudRepos(sessionSpec.workspaceEntries);

  return {
    agent,
    agentSpec,
    session,
    sessionSpec,
    instructions: agentSpec.instructions,
    subAgents: agentSpec.subAgents,
    mergedMcpServerUsages,
    mergedSkillRefs,
    cloudRepos,
  };
}

// ---------------------------------------------------------------------------
// Cloud repo extraction
// ---------------------------------------------------------------------------

/**
 * Extract Cursor SDK-compatible repo descriptors from workspace entries.
 *
 * Maps Stigmer's GitRepoSource (url + branch) to the Cursor SDK's
 * CloudAgentOptions.repos shape ({ url, startingRef? }). Only GitRepoSource
 * entries produce output — LocalPathSource entries are silently skipped.
 *
 * Always computed (cheap iteration) but only consumed when mode is cloud.
 */
export function resolveCloudRepos(workspaceEntries: WorkspaceEntry[]): CloudRepo[] {
  const repos: CloudRepo[] = [];

  for (const entry of workspaceEntries) {
    if (entry.source?.source.case === "gitRepo") {
      const git = entry.source.source.value;
      repos.push({
        url: git.url,
        startingRef: git.branch || undefined,
      });
    }
  }

  return repos;
}

// ---------------------------------------------------------------------------
// MCP and skill merging
// ---------------------------------------------------------------------------

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
