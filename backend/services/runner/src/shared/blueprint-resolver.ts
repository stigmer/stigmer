/**
 * Resolves the agent blueprint of a turn: the agent spec the turn runs, and
 * the merge of its MCP usages and skill refs with the session's own.
 *
 * The agent is the one the execution recorded when it was created
 * (status.agent_id and agent_version_hash): the spec is that version's
 * snapshot, read through getAgentVersion, so an author saving a new
 * version while the turn is queued or running never changes what runs,
 * and a session repointed to another agent afterwards never changes which
 * agent this turn runs. A recorded version that no longer resolves (the
 * agent was deleted, the run's person may no longer see it, a store fault)
 * fails the turn naming the version: running the agent's current version
 * would run, and record, something nobody asked for. An execution that
 * recorded an agent with no version runs that agent as it is now; one that
 * recorded nothing (created before turns recorded their agent) walks
 * session -> agentInstance -> agent, the only route it has.
 *
 * A session with an EMPTY agent_instance_id is the built-in assistant
 * (session/v1/spec.proto): the chain stops at the session, `agent` is
 * undefined, the instructions are empty (each harness's prompt builder
 * substitutes the one built-in prompt, shared/builtin-assistant-prompt.ts),
 * there are no sub-agents, and the session's own MCP usages and skill refs
 * are the whole tool set — the same merge with an empty agent side, so no
 * consumer downstream needs an agent-less arm of its own.
 *
 * Workspace isolation: resolved workspace directories are validated to
 * ensure they never point at the runner's own app directory. Paths
 * containing runner-internal markers are rejected with a warning.
 */

import { ConnectError } from "@connectrpc/connect";
import type { StigmerClient } from "../client/stigmer-client.js";
import type { AgentExecutionStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
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

/** The agent a turn runs: its id, the version it recorded, and that version's spec. */
export interface RunAgent {
  readonly id: string;
  /** Empty when the turn recorded no version (the agent runs as it is now). */
  readonly versionHash: string;
  readonly spec: AgentSpec;
}

/** The agent a turn recorded at create (AgentExecutionStatus). */
export type RecordedRunAgent = Pick<AgentExecutionStatus, "agentId" | "agentVersionHash">;

export interface ResolvedBlueprint {
  /** The agent the turn runs; undefined for the built-in assistant. */
  agent: RunAgent | undefined;
  session: Session;
  sessionSpec: SessionSpec;
  instructions: string;
  subAgents: SubAgent[];
  mergedMcpServerUsages: McpServerUsage[];
  mergedSkillRefs: ApiResourceReference[];
  cloudRepos: CloudRepo[];
}

/**
 * Resolve the full agent blueprint of a turn: the recorded agent (the
 * module doc), else the session's chain; an empty agent_instance_id with
 * nothing recorded is the built-in assistant.
 */
export async function resolveBlueprint(
  client: StigmerClient,
  session: Session,
  recorded: RecordedRunAgent | undefined,
): Promise<ResolvedBlueprint> {
  const sessionSpec = session.spec!;

  const agent = await resolveRunAgent(client, sessionSpec, recorded);
  const agentSpec = agent?.spec;

  const mergedMcpServerUsages = mergeMcpServerUsages(
    agentSpec?.mcpServerUsages ?? [],
    sessionSpec.mcpServerUsages,
  );

  const mergedSkillRefs = mergeSkillRefs(
    agentSpec?.skillRefs ?? [],
    sessionSpec.skillRefs,
  );

  const cloudRepos = resolveCloudRepos(sessionSpec.workspaceEntries);

  return {
    agent,
    session,
    sessionSpec,
    instructions: agentSpec?.instructions ?? "",
    subAgents: agentSpec?.subAgents ?? [],
    mergedMcpServerUsages,
    mergedSkillRefs,
    cloudRepos,
  };
}

/** The agent a turn runs, from what the execution recorded, else the session's chain. */
async function resolveRunAgent(
  client: StigmerClient,
  sessionSpec: SessionSpec,
  recorded: RecordedRunAgent | undefined,
): Promise<RunAgent | undefined> {
  const agentId = recorded?.agentId ?? "";
  const versionHash = recorded?.agentVersionHash ?? "";
  if (agentId !== "" && versionHash !== "") {
    try {
      const version = await client.getAgentVersion(agentId, versionHash);
      return { id: agentId, versionHash, spec: version.specSnapshot! };
    } catch (error) {
      const what = `the agent version this turn recorded (agent ${agentId}, version ${versionHash}) could not be loaded`;
      if (error instanceof ConnectError) {
        throw new ConnectError(`${what}: ${error.rawMessage}`, error.code);
      }
      throw new Error(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (agentId !== "") {
    const agent = await client.getAgent(agentId);
    return { id: agentId, versionHash: "", spec: agent.spec! };
  }
  if (sessionSpec.agentInstanceId === "") {
    return undefined;
  }
  const agentInstance = await client.getAgentInstance(sessionSpec.agentInstanceId);
  const instanceAgentId = agentInstance.spec!.agentId;
  const agent = await client.getAgent(instanceAgentId);
  return { id: instanceAgentId, versionHash: "", spec: agent.spec! };
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
