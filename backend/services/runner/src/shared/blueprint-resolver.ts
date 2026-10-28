/**
 * Resolves the agent blueprint of a turn: the agent spec the turn runs, the
 * plugins it uses (the agent's and the session's), the saved agents it
 * lists as subagents, and the merge of its skill refs with the session's
 * own.
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
 * there are no subagents of its own, and the session's own plugins and
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
 * its tools, hooks and skills away silently. Each plugin's agents are the
 * turn's plugin subagents, named `<plugin>:<agent>` (Claude Code's plugin
 * subagents: the turn's tools narrowed by the plugin's own lists, the
 * plugin's skills, and the model their file names where the engine lists
 * it; harness/turn-context.ts).
 *
 * Subagents. Each saved agent the agent version lists in `subagents` is
 * read at the version the agent pinned when it was saved
 * (`getAgentByReference`, whose read the server authorizes as a `get` of
 * that agent), so an edit to the subagent reaches this turn only once the
 * parent is saved again. A subagent that cannot be read fails the turn
 * naming it, as a plugin does. Its own plugins resolve through the same
 * merge, after the conversation's: a plugin the conversation already lists
 * is that one, at its version, so the server's plan for the run's values
 * (domain/run/run-plugins.ts) is what runs. The turn builds each
 * subagent's own context from them (harness/turn-context.ts
 * `resolveSubagents`).
 *
 * Exclusion. A run's `excluded_plugin_ids` (set only by the server's
 * evals, to run a case without the plugin it compares) leaves those
 * plugins out of the turn wherever they come from: the agent's list, the
 * session's, or a subagent's. Each is matched on the resolved plugin's id,
 * since a reference may still name a plugin by slug alone, so a plugin
 * left out is still read; it loads nothing into the turn. The server
 * plans the run's values without the same plugins (domain/run/
 * run-plugins.ts).
 *
 * A turn whose run carries the judge label is the built-in judge
 * (builtin-judge.ts), whatever its stamp: the judge's code-defined spec is
 * the agent, with id "" as the built-ins have, and the turn gets no plugin,
 * skill ref or subagent, not even the session's own, so the judge can act
 * on nothing in the conversation it grades.
 *
 * Workspace isolation: resolved workspace directories are validated to
 * ensure they never point at the runner's own app directory. Paths
 * containing runner-internal markers are rejected with a warning.
 */

import { ConnectError } from "@connectrpc/connect";
import type { StigmerClient } from "../client/stigmer-client.js";
import type { RunStatus } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import type { Session } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { SessionSpec } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";
import type { ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { builtInJudgeSpec, isJudgeRunLabels } from "./builtin-judge.js";

/** The agent a turn runs: its id, the version it recorded, and that version's spec. */
export interface RunAgent {
  readonly id: string;
  /** Empty when the turn recorded no version (the agent runs as it is now). */
  readonly versionHash: string;
  readonly spec: AgentSpec;
}

/** The agent a turn recorded at create (RunStatus). */
export type RecordedRunAgent = Pick<RunStatus, "agentId" | "agentVersionHash">;

/** A plugin's agent as a turn runs it: Claude Code's plugin subagent. */
export interface PluginSubagent {
  /** `<plugin>:<agent>`. */
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  /** The plugin's own lists for it, in Claude Code's names; they narrow the turn's tools. */
  readonly tools: readonly string[];
  readonly disallowedTools: readonly string[];
  /** The model its file names, as written; "" when it names none. */
  readonly model: string;
}

/** A saved agent the turn's agent lists as a subagent, at the version its parent pinned. */
export interface SavedSubagent {
  /** Its name in the turn: its slug. */
  readonly name: string;
  readonly agentId: string;
  readonly versionHash: string;
  readonly spec: AgentSpec;
  /** Its own plugins, each at the version the turn's merge resolved (the module header). */
  readonly plugins: readonly Plugin[];
}

export interface ResolvedBlueprint {
  /** The agent the turn runs; undefined for the built-in assistant. */
  agent: RunAgent | undefined;
  session: Session;
  sessionSpec: SessionSpec;
  instructions: string;
  /** Each plugin's agents, as `<plugin>:<agent>`. */
  pluginAgents: PluginSubagent[];
  /** The saved agents the agent lists, in its order. */
  subagents: SavedSubagent[];
  /** The turn's plugins, each at the version it resolved to, in merge order. */
  plugins: Plugin[];
  mergedSkillRefs: ApiResourceReference[];
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
  excludedPluginIds: readonly string[] = [],
): Promise<ResolvedBlueprint> {
  const sessionSpec = session.spec!;

  if (isJudgeRunLabels(runLabels)) {
    const spec = builtInJudgeSpec();
    return {
      agent: { id: "", versionHash: "", spec },
      session,
      sessionSpec,
      instructions: spec.instructions,
      pluginAgents: [],
      subagents: [],
      plugins: [],
      mergedSkillRefs: [],
    };
  }

  const agent = await resolveRunAgent(client, recorded);
  const agentSpec = agent?.spec;

  const org = session.metadata?.org ?? "";
  const pluginRefs = mergePluginRefs(agentSpec?.plugins ?? [], sessionSpec.plugins, org);
  const resolved = await resolvePlugins(client, pluginRefs);
  const excluded = new Set(excludedPluginIds);
  const plugins = resolved.filter((plugin) => !excluded.has(plugin.metadata?.id ?? ""));
  const subagents = await resolveSubagents(client, agentSpec?.subagents ?? [], org, pluginRefs, resolved, excluded);

  const mergedSkillRefs = mergeSkillRefs(
    agentSpec?.skillRefs ?? [],
    sessionSpec.skillRefs,
  );

  return {
    agent,
    session,
    sessionSpec,
    instructions: agentSpec?.instructions ?? "",
    pluginAgents: plugins.flatMap(pluginSubagents),
    subagents,
    plugins,
    mergedSkillRefs,
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
 * by organization and id (or slug, for a reference written by name; an
 * empty organization is the session's), the session's reference winning.
 * A reference whose plugin was deleted is left out with a warning.
 */
export function mergePluginRefs(
  agentRefs: readonly ApiResourceReference[],
  sessionRefs: readonly ApiResourceReference[],
  org: string,
): ApiResourceReference[] {
  const merged = new Map<string, ApiResourceReference>();
  for (const ref of usableRefs([...agentRefs, ...sessionRefs], "plugin")) {
    merged.set(pluginKey(ref, org), ref);
  }
  return [...merged.values()];
}

/** The key a plugin reference is merged by: its organization (an empty one is `org`) and its id, else its slug. */
function pluginKey(ref: ApiResourceReference, org: string): string {
  return `${ref.org || org}/${ref.id !== "" ? `#${ref.id}` : ref.slug}`;
}

/**
 * The references that name a resource the turn can load. Every reference
 * reaches the runner from the server, which names each by its target's
 * current slug; one that holds an id and no slug names a resource that was
 * deleted, and is left out with a warning, as a skill that cannot be read
 * is. An unset reference names nothing.
 */
export function usableRefs(
  refs: readonly ApiResourceReference[],
  noun: string,
): ApiResourceReference[] {
  return refs.filter((ref) => {
    if (ref.id === "" && ref.slug === "") {
      return false;
    }
    if (ref.slug === "") {
      console.warn(`[blueprint] the ${noun} ${ref.org}/${ref.id} this turn lists was deleted; the turn runs without it`);
      return false;
    }
    return true;
  });
}

/**
 * Each saved agent the agent lists, at its pinned version, with its own
 * plugins: a plugin the turn's merge already holds is that one, and each
 * other is resolved once, the first subagent's reference winning. A plugin
 * the run excludes is left out of the subagent, by its resolved id.
 */
async function resolveSubagents(
  client: StigmerClient,
  refs: readonly ApiResourceReference[],
  org: string,
  turnRefs: readonly ApiResourceReference[],
  turnPlugins: readonly Plugin[],
  excluded: ReadonlySet<string>,
): Promise<SavedSubagent[]> {
  const byKey = new Map<string, Plugin>(turnRefs.map((ref, i) => [pluginKey(ref, org), turnPlugins[i]!]));
  const subagents: SavedSubagent[] = [];
  for (const ref of usableRefs(refs, "subagent")) {
    let agent;
    try {
      agent = await client.getAgentByReference(ref);
    } catch (error) {
      const what = `the subagent '${ref.slug}' this conversation's agent lists could not be read`;
      if (error instanceof ConnectError) {
        throw new ConnectError(`${what}: ${error.rawMessage}`, error.code);
      }
      throw new Error(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const spec = agent.spec!;
    const subagentOrg = agent.metadata?.org || ref.org || org;
    const plugins: Plugin[] = [];
    for (const pluginRef of usableRefs(spec.plugins, "plugin")) {
      const key = pluginKey(pluginRef, subagentOrg);
      let plugin = byKey.get(key);
      if (plugin === undefined) {
        [plugin] = await resolvePlugins(client, [pluginRef.org ? pluginRef : { ...pluginRef, org: subagentOrg }]);
        byKey.set(key, plugin!);
      }
      if (excluded.has(plugin!.metadata?.id ?? "")) {
        continue;
      }
      plugins.push(plugin!);
    }
    subagents.push({
      name: agent.metadata?.slug || ref.slug,
      agentId: agent.metadata?.id ?? "",
      versionHash: ref.version,
      spec,
      plugins,
    });
  }
  return subagents;
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

/** A plugin's agents as the turn's plugin subagents, named `<plugin>:<agent>`, with the plugin's own tool lists and model. */
export function pluginSubagents(plugin: Plugin): PluginSubagent[] {
  const pluginName = plugin.metadata?.name ?? "";
  return (plugin.status?.agents ?? []).map((agent) => ({
    name: pluginAgentName(pluginName, agent.name),
    description: agent.description,
    instructions: agent.instructions,
    tools: [...agent.tools],
    disallowedTools: [...agent.disallowedTools],
    model: agent.model,
  }));
}

/** `<plugin>:<agent>`, as Claude Code names a plugin's agent. */
export function pluginAgentName(pluginName: string, agentName: string): string {
  return `${pluginName}:${agentName}`;
}

// ---------------------------------------------------------------------------
// Skill merging
// ---------------------------------------------------------------------------

/**
 * Merge skill refs from agent and session.
 *
 * Replicates session_context_merge.py::merge_skill_refs():
 * - Union of both sets, deduplicated by slug: a skill mounts by its name
 * - Session refs take precedence on collision (may have different version)
 * - A reference whose skill was deleted is left out (usableRefs)
 */
export function mergeSkillRefs(
  agentRefs: ApiResourceReference[],
  sessionRefs: ApiResourceReference[],
): ApiResourceReference[] {
  const bySlug = new Map<string, ApiResourceReference>();

  for (const ref of usableRefs(agentRefs, "skill")) {
    bySlug.set(ref.slug, ref);
  }

  for (const ref of usableRefs(sessionRefs, "skill")) {
    bySlug.set(ref.slug, ref);
  }

  return [...bySlug.values()];
}
