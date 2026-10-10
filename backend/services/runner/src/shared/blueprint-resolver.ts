/**
 * Resolves the agent blueprint of a turn: the agent spec the turn runs, the
 * plugins it uses (the agent's and the session's), and the merge of its
 * skill refs with the session's own.
 *
 * The agent comes from the turn's stamp alone (status.agent_id and
 * agent_version_hash), which the server records on every turn before it
 * runs: from the session's pin at create, and from the session's pin on
 * recover for a turn that carried none. The spec is that version's
 * snapshot, read through getAgentVersion, so an author saving a new
 * version while the turn is queued or running never changes what runs,
 * and a session repointed to another agent afterwards never changes which
 * agent this turn runs. A recorded version that no longer resolves (the
 * agent was deleted, the run's person may no longer see it, a store fault)
 * fails the turn naming the version: running the agent's current version
 * would run, and record, something nobody asked for. A stamp naming an
 * agent with no version runs that agent as it is now. The runner never
 * walks the session to find an agent: the session's pin reaches the turn
 * through the stamp, so there is one route to the agent and one writer of
 * it.
 *
 * A turn whose stamp names no agent is the built-in assistant: `agent` is
 * undefined, the instructions are empty (each harness's prompt builder
 * substitutes the one built-in prompt, shared/builtin-assistant-prompt.ts),
 * there are no sub-agents of its own, and the session's own plugins and
 * skill refs are the whole tool set — the same merge with an empty agent
 * side, so no consumer downstream needs an agent-less arm of its own.
 *
 * Plugins. The agent version's `plugins` and the session's are merged one
 * entry per plugin (organization and slug), the session's reference winning
 * (its version is the one the conversation chose); the server plans a run's
 * values from the same merge (domain/run/run-plugins.ts). Each resolves
 * like a skill reference, its version when set, else the installed one, at
 * turn start. A listed plugin that cannot be read fails the turn naming it,
 * as a conversation whose agent is gone does: running without it would run
 * its tools, hooks and skills away silently. Each plugin's agents join the
 * turn's sub-agents as `<plugin>:<agent>`, after the agent's own, with the
 * plugin's own tool lists; their skills are the plugin's (the skills phase,
 * harness/turn-context.ts).
 *
 * A turn whose run carries the judge label is the built-in judge
 * (builtin-judge.ts), whatever its stamp: the judge's code-defined spec is
 * the agent, with id "" as the built-ins have, and the turn gets no plugin,
 * skill ref or sub-agent, not even the session's own, so the judge can act
 * on nothing in the conversation it grades.
 *
 * Workspace isolation: resolved workspace directories are validated to
 * ensure they never point at the runner's own app directory. Paths
 * containing runner-internal markers are rejected with a warning.
 */

import { ConnectError } from "@connectrpc/connect";
import type { StigmerClient } from "../client/stigmer-client.js";
import type { RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { create } from "@bufbuild/protobuf";
import { SubAgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { AgentSpec, SubAgent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import type { SessionSpec } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { builtInJudgeSpec, isJudgeRunLabels } from "./builtin-judge.js";

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

/** The agent a turn recorded at create (RunStatus). */
export type RecordedRunAgent = Pick<RunStatus, "agentId" | "agentVersionHash">;

export interface ResolvedBlueprint {
  /** The agent the turn runs; undefined for the built-in assistant. */
  agent: RunAgent | undefined;
  session: Session;
  sessionSpec: SessionSpec;
  instructions: string;
  /** The agent's own sub-agents, then each plugin's agents as `<plugin>:<agent>`. */
  subAgents: SubAgent[];
  /** The turn's plugins, each at the version it resolved to, in merge order. */
  plugins: Plugin[];
  mergedSkillRefs: ApiResourceReference[];
  cloudRepos: CloudRepo[];
}

/**
 * Resolve the full agent blueprint of a turn: the stamped agent (the module
 * doc); a turn whose stamp names no agent is the built-in assistant; a run
 * labelled as a judge's is the built-in judge.
 */
export async function resolveBlueprint(
  client: StigmerClient,
  session: Session,
  recorded: RecordedRunAgent | undefined,
  runLabels: Readonly<Record<string, string>>,
): Promise<ResolvedBlueprint> {
  const sessionSpec = session.spec!;

  if (isJudgeRunLabels(runLabels)) {
    const spec = builtInJudgeSpec();
    return {
      agent: { id: "", versionHash: "", spec },
      session,
      sessionSpec,
      instructions: spec.instructions,
      subAgents: [],
      plugins: [],
      mergedSkillRefs: [],
      cloudRepos: [],
    };
  }

  const agent = await resolveRunAgent(client, recorded);
  const agentSpec = agent?.spec;

  const org = session.metadata?.org ?? "";
  const plugins = await resolvePlugins(client, mergePluginRefs(agentSpec?.plugins ?? [], sessionSpec.plugins, org));
  const ownSubAgents = agentSpec?.subAgents ?? [];
  const pluginAgents = plugins.flatMap(pluginSubAgents);

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
    // The agent spec's own list when the plugins add none, so the agent
    // host's codec can carry it by reference (agent-host/codec.ts).
    subAgents: pluginAgents.length === 0 ? ownSubAgents : [...ownSubAgents, ...pluginAgents],
    plugins,
    mergedSkillRefs,
    cloudRepos,
  };
}

/** The agent a turn runs, from its stamp; undefined for the built-in assistant. */
async function resolveRunAgent(
  client: StigmerClient,
  recorded: RecordedRunAgent | undefined,
): Promise<RunAgent | undefined> {
  const agentId = recorded?.agentId ?? "";
  const versionHash = recorded?.agentVersionHash ?? "";
  if (agentId === "") {
    return undefined;
  }
  if (versionHash === "") {
    const agent = await client.getAgent(agentId);
    return { id: agentId, versionHash: "", spec: agent.spec! };
  }
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

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

/**
 * Merge plugin references from the agent and the session, one per plugin
 * by organization and slug (an empty organization is the session's), the
 * session's reference winning.
 */
export function mergePluginRefs(
  agentRefs: readonly ApiResourceReference[],
  sessionRefs: readonly ApiResourceReference[],
  org: string,
): ApiResourceReference[] {
  const merged = new Map<string, ApiResourceReference>();
  for (const ref of [...agentRefs, ...sessionRefs]) {
    if (ref.slug) merged.set(`${ref.org || org}/${ref.slug}`, ref);
  }
  return [...merged.values()];
}

async function resolvePlugins(client: StigmerClient, refs: readonly ApiResourceReference[]): Promise<Plugin[]> {
  const plugins: Plugin[] = [];
  for (const ref of refs) {
    try {
      plugins.push(await client.getPluginByReference(ref));
    } catch (error) {
      const what = `the plugin '${ref.slug}' this conversation uses could not be read`;
      if (error instanceof ConnectError) {
        throw new ConnectError(`${what}: ${error.rawMessage}`, error.code);
      }
      throw new Error(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return plugins;
}

/** A plugin's agents as the turn's sub-agents, named `<plugin>:<agent>`, with the plugin's own tool lists. */
export function pluginSubAgents(plugin: Plugin): SubAgent[] {
  const pluginName = plugin.metadata?.name ?? "";
  return (plugin.status?.agents ?? []).map((agent) =>
    create(SubAgentSchema, {
      name: pluginAgentName(pluginName, agent.name),
      description: agent.description,
      instructions: agent.instructions,
      tools: [...agent.tools],
      disallowedTools: [...agent.disallowedTools],
    }),
  );
}

/** `<plugin>:<agent>`, as Claude Code names a plugin's agent. */
export function pluginAgentName(pluginName: string, agentName: string): string {
  return `${pluginName}:${agentName}`;
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
// Skill merging
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
