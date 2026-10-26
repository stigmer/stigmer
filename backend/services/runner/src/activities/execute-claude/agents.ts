/**
 * The agents of one Claude turn: the main agent and every sub-agent it may
 * hand work to, each with what it may reach, and the definitions the engine
 * runs the sub-agents from (`agents`, in the foreground).
 *
 * Who the sub-agents are, as on the native engine
 * (`execute-deep-agent/subagent-transformer.ts`): every saved agent the
 * agent lists and every agent of the turn's plugins, each kept only when
 * the main agent's lists name its type (`Agent(type, …)`). Each brings its
 * own world:
 *
 *  - a saved sub-agent its own lists (capped by the turn's, `Agent`
 *    denied), its own servers and none of the main agent's or the
 *    platform's, its own skills, its own shell values, its own model;
 *  - a plugin agent the main agent's lists narrowed by its plugin's, the
 *    main agent's servers, its file's skills, the main agent's shell values,
 *    the model its file names where this engine lists it.
 *
 * The engine has one pool for the session (measured on SDK 0.3.310): its
 * `tools` option is every sub-agent's too, its `skills` allowlist is the
 * session's, and a server must be registered for the session to reach any
 * sub-agent. So the engine is handed the union of every agent's tools,
 * skills and servers ({@link TurnAgents}), each definition lists exactly
 * its own tools, and the gate holds every caller to its own reach
 * (`gate.ts`). The main agent may therefore be offered, behind the engine's
 * tool search or in its listing, a tool or skill only a sub-agent may use,
 * and is refused if it calls it.
 *
 * An agent whose lists exclude `Read` is still offered it, and the gate
 * lets it read the platform's own content alone (`gate.ts`, item 2), as
 * the other engines keep that content readable under the same lists.
 *
 * Nothing nests: every sub-agent's scope denies `Agent`
 * (`shared/subagents.ts`), so no definition lists it, and the engine is
 * told to start no sub-agent below the first (`engine-env.ts`).
 */

import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import type { TurnInput } from "../../harness/types.js";
import type { ResolvedMcpServer } from "../../shared/mcp-resolver.js";
import { resolveToApiModelId } from "../../shared/model-registry.js";
import { shellRunValues } from "../../shared/shell-env.js";
import type { SkillMetadata } from "../../shared/skill-resolver.js";
import { pluginSubagentScope, subagentModel } from "../../shared/subagents.js";
import { checkMainToolListResolution, checkToolListResolution, claudeToolsOf, ToolScope, type TurnToolInventory } from "../../shared/tool-lists.js";
import { CLAUDE_ENGINE_TOOL_COVERS, engineAddedTools, engineTools, offeredBuiltins } from "./engine-options.js";
import { AGENT_TOOL, READ_TOOL, SKILL_TOOL, type Reach } from "./gate.js";
import { HOST_SHELL_TOOL } from "./host-shell.js";
import type { McpBridge } from "./mcp-bridge.js";
import { engineSkillOf, spellingsOf, turnSkillsOf, type EngineSkill } from "./skill-plugins.js";

/** A sub-agent of the turn, before its tools are known (the header). */
export interface SubagentSpec {
  /** Its type: a saved agent's slug, a plugin agent's `<plugin>:<agent>`. */
  readonly name: string;
  readonly kind: "saved" | "plugin";
  readonly description: string;
  readonly instructions: string;
  readonly scope: ToolScope;
  readonly skills: readonly SkillMetadata[];
  /** The servers it has: a saved sub-agent's own, a plugin agent's the main agent's. */
  readonly servers: readonly ResolvedMcpServer[];
  /** The registry id of the model it runs on; undefined runs the turn's. */
  readonly model: string | undefined;
  /** The run values its shell holds. */
  readonly shellValues: Readonly<Record<string, string>>;
}

/** The turn's sub-agents the main agent may start (the header). */
export async function subagentSpecsOf(input: TurnInput): Promise<SubagentSpec[]> {
  const mainScope = input.mcp.toolScope;
  const specs: SubagentSpec[] = [];
  for (const agent of input.blueprint.pluginAgents) {
    const model = await subagentModel(agent.model, Harness.CLAUDE);
    if (agent.model !== "" && model === undefined) {
      console.log(`[claude-agents] plugin sub-agent '${agent.name}' names model '${agent.model}', which this engine does not list; it runs on the turn's model`);
    }
    specs.push({
      name: agent.name,
      kind: "plugin",
      description: agent.description || `Sub-agent: ${agent.name}`,
      instructions: agent.instructions,
      scope: pluginSubagentScope(mainScope, agent),
      skills: input.skills.bySubAgent.get(agent.name) ?? [],
      servers: input.mcp.servers,
      model,
      shellValues: shellRunValues(input.values),
    });
  }
  for (const subagent of input.subagents) {
    specs.push({
      name: subagent.name,
      kind: "saved",
      description: subagent.description || `Subagent: ${subagent.name}`,
      instructions: subagent.instructions,
      scope: subagent.toolScope,
      skills: subagent.skills,
      servers: subagent.servers,
      model: subagent.model,
      shellValues: subagent.values,
    });
  }
  return specs.filter((spec) => {
    if (mainScope.allowsSubAgentType(spec.name)) return true;
    console.log(`[claude-agents] sub-agent '${spec.name}' is outside the agent's tool lists; not offered`);
    return false;
  });
}

/**
 * The servers the bridge connects, each once (the main agent's, then each
 * saved sub-agent's not already held), and whether some agent that has a
 * server may call one of its tools.
 */
export function bridgeServersOf(
  input: TurnInput,
  specs: readonly SubagentSpec[],
): { readonly servers: ResolvedMcpServer[]; readonly inScope: (slug: string, tool: string) => boolean } {
  const owners: { readonly slugs: ReadonlySet<string>; readonly scope: ToolScope }[] = [
    { slugs: slugsOf(input.mcp.servers), scope: input.mcp.toolScope },
    ...specs.map((spec) => ({ slugs: slugsOf(spec.servers), scope: spec.scope })),
  ];
  const servers = new Map<string, ResolvedMcpServer>();
  for (const server of [...input.mcp.servers, ...specs.flatMap((spec) => spec.servers)]) {
    if (!servers.has(server.slug)) servers.set(server.slug, server);
  }
  return {
    servers: [...servers.values()],
    inScope: (slug, tool) => owners.some((owner) => owner.slugs.has(slug) && owner.scope.allowsMcpTool(slug, tool)),
  };
}

/** One agent's world: what it may reach, and what it is offered. */
export interface AgentWorld {
  readonly reach: Reach;
  /** The engine built-ins it is offered (`engine-options.ts` `offeredBuiltins`). */
  readonly builtins: readonly string[];
  /** Its bridged MCP tools, by engine name. */
  readonly mcpTools: readonly string[];
  /** Its own skills, as the engine names them. */
  readonly skills: readonly EngineSkill[];
  /** The run values its shell holds. */
  readonly shellValues: Readonly<Record<string, string>>;
}

/** A sub-agent's world, with its spec and its servers' tools it may not call. */
export interface SubagentWorld extends AgentWorld {
  readonly spec: SubagentSpec;
  readonly deniedMcpTools: readonly string[];
}

/** The turn's agents (the header). */
export interface TurnAgents {
  readonly root: AgentWorld;
  /** Each sub-agent, by its type. */
  readonly subagents: ReadonlyMap<string, SubagentWorld>;
  /** Every skill of the turn, once each: the engine's allowlist and what it loads. */
  readonly skills: readonly EngineSkill[];
  /** The engine's session `tools`: every agent's built-ins and the engine's own tools any of them needs (one pool, the header). */
  readonly sessionTools: readonly string[];
  /** Whether any agent is offered the host's shell. */
  readonly shell: boolean;
}

/**
 * The turn's agents over the connected bridge. Throws
 * `SkillNameClash` (`skill-plugins.ts`) for skills that cannot be named
 * apart.
 */
export function turnAgentsOf(
  input: TurnInput,
  specs: readonly SubagentSpec[],
  bridge: Pick<McpBridge, "offered" | "serverOf">,
  opts: { readonly planMode: boolean; readonly structuredOutput: boolean },
): TurnAgents {
  const { primaryDir } = input.workspace;
  const platform = input.mcp.platformServerSlugs;
  const mcpOf = (servers: readonly ResolvedMcpServer[], scope: ToolScope): { allowed: string[]; denied: string[] } => {
    const slugs = slugsOf(servers);
    const allowed: string[] = [];
    const denied: string[] = [];
    for (const name of bridge.offered) {
      const owner = bridge.serverOf(name);
      if (owner === undefined || !slugs.has(owner.slug)) continue;
      (platform.has(owner.slug) || scope.allowsMcpTool(owner.slug, owner.tool) ? allowed : denied).push(name);
    }
    return { allowed, denied };
  };
  const worldOf = (scope: ToolScope, servers: readonly ResolvedMcpServer[], skills: readonly SkillMetadata[], shellValues: Readonly<Record<string, string>>, extra: readonly string[]) => {
    const builtins = offeredBuiltins(scope, opts.planMode);
    const confinedRead = !builtins.includes(READ_TOOL);
    const mcp = mcpOf(servers, scope);
    const own = skills.map((skill) => engineSkillOf(skill, primaryDir));
    const tools = new Set([
      ...engineTools(builtins, mcp.allowed.length > 0),
      ...(confinedRead ? [READ_TOOL] : []),
      ...mcp.allowed,
      ...(builtins.includes(HOST_SHELL_TOOL.engineName) ? [HOST_SHELL_TOOL.aliasedName] : []),
      ...(own.length > 0 ? [SKILL_TOOL] : []),
      ...extra,
    ]);
    return { builtins, confinedRead, mcp, own, tools, shellValues };
  };

  const subagents = new Map<string, SubagentWorld>();
  for (const spec of specs) {
    const world = worldOf(spec.scope, spec.servers, spec.skills, spec.shellValues, []);
    subagents.set(spec.name, {
      spec,
      reach: { tools: world.tools, skills: skillSpellings(world.own), agentTypes: new Set(), hidesSkills: spec.scope.hidesSkills, confinedRead: world.confinedRead },
      builtins: world.builtins,
      mcpTools: world.mcp.allowed,
      deniedMcpTools: world.mcp.denied,
      skills: world.own,
      shellValues: world.shellValues,
    });
  }
  const rootScope = input.mcp.toolScope;
  const rootExtra = [...engineAddedTools(opts.structuredOutput), ...(specs.length > 0 ? [AGENT_TOOL] : [])];
  const rootWorld = worldOf(rootScope, input.mcp.servers, input.skills.root, shellRunValues(input.values), rootExtra);
  const root: AgentWorld = {
    reach: {
      tools: rootWorld.tools,
      skills: skillSpellings(rootWorld.own),
      agentTypes: new Set(specs.map((spec) => spec.name)),
      hidesSkills: rootScope.hidesSkills,
      confinedRead: rootWorld.confinedRead,
    },
    builtins: rootWorld.builtins,
    mcpTools: rootWorld.mcp.allowed,
    skills: rootWorld.own,
    shellValues: rootWorld.shellValues,
  };

  const worlds = [root, ...subagents.values()];
  const skills = turnSkillsOf(worlds.map((world) => world.skills));
  const sessionTools = new Set<string>();
  for (const world of worlds) for (const tool of engineTools(world.builtins, world.mcpTools.length > 0)) sessionTools.add(tool);
  if (worlds.some((world) => world.reach.confinedRead)) sessionTools.add(READ_TOOL);
  if (skills.length > 0) sessionTools.add(SKILL_TOOL);
  if (specs.length > 0) sessionTools.add(AGENT_TOOL);
  return {
    root,
    subagents,
    skills,
    sessionTools: [...sessionTools],
    shell: worlds.some((world) => world.builtins.includes(HOST_SHELL_TOOL.engineName)),
  };
}

/**
 * Each sub-agent's engine definition: its description and prompt, its model
 * (`inherit` for the turn's), exactly its own tools, its servers' tools it
 * may not call, and its servers by the session's names (the host's shell
 * among them when it has the shell). No skill is preloaded: a sub-agent
 * loads its own through the Skill tool, as the main agent does.
 */
export async function agentDefinitionsOf(agents: TurnAgents, promptOf: (world: SubagentWorld) => string): Promise<Record<string, AgentDefinition>> {
  const definitions: Record<string, AgentDefinition> = {};
  for (const [name, world] of agents.subagents) {
    const shell = world.builtins.includes(HOST_SHELL_TOOL.engineName);
    const servers = [...slugsOf(world.spec.servers), ...(shell ? [HOST_SHELL_TOOL.server] : [])];
    definitions[name] = {
      description: world.spec.description,
      prompt: promptOf(world),
      model: world.spec.model === undefined ? "inherit" : await resolveToApiModelId(world.spec.model),
      tools: [...world.reach.tools],
      ...(world.deniedMcpTools.length > 0 ? { disallowedTools: [...world.deniedMcpTools] } : {}),
      ...(servers.length > 0 ? { mcpServers: servers } : {}),
    };
  }
  return definitions;
}

/**
 * Every agent's tool lists checked against what it binds, as the native
 * engine checks them: the main agent's layer by layer, a plugin agent's
 * with lists over the agent's own layer, a saved sub-agent's with lists
 * against its own servers alone. Each entry naming nothing is logged; a
 * `tools` that resolves to nothing refuses the turn
 * (`shared/tool-lists.ts` `ToolListResolutionError`).
 */
export function checkAgentToolLists(input: TurnInput, agents: TurnAgents, bridge: Pick<McpBridge, "offered" | "serverOf">, opts: { readonly planMode: boolean }): void {
  const log = (line: string): void => console.warn(`[claude-turn] ${line}`);
  const rootScope = input.mcp.toolScope;
  checkMainToolListResolution(rootScope, inventoryOf(agents.root.builtins, input.mcp.servers, bridge), log);
  const bindable = offeredBuiltins(ToolScope.unrestricted(), opts.planMode);
  const agentSpec = input.blueprint.agent?.spec;
  const agentScope = rootScope.upTo(agentSpec !== undefined && (agentSpec.tools.length > 0 || agentSpec.disallowedTools.length > 0) ? 1 : 0);
  for (const agent of input.blueprint.pluginAgents) {
    if ((agent.tools.length === 0 && agent.disallowedTools.length === 0) || !agents.subagents.has(agent.name)) continue;
    checkToolListResolution(pluginSubagentScope(agentScope, agent).upTo(agentScope.depth + 1), inventoryOf(bindable, input.mcp.servers, bridge), log);
  }
  for (const subagent of input.subagents) {
    if (!subagent.bringsOwn.lists || !agents.subagents.has(subagent.name)) continue;
    checkToolListResolution(subagent.toolScope.upTo(1), inventoryOf(bindable, subagent.servers, bridge), log);
  }
}

/** What an agent binds, for its lists' check: its built-ins, and its servers' tools the bridge lists. */
function inventoryOf(builtins: readonly string[], servers: readonly ResolvedMcpServer[], bridge: Pick<McpBridge, "offered" | "serverOf">): TurnToolInventory {
  const slugs = slugsOf(servers);
  const owned = [...bridge.offered].flatMap((name) => {
    const owner = bridge.serverOf(name);
    return owner !== undefined && slugs.has(owner.slug) ? [owner] : [];
  });
  return {
    claudeTools: claudeToolsOf(builtins, CLAUDE_ENGINE_TOOL_COVERS),
    hasMcp: (server, tool) => owned.some((owner) => owner.slug === server && (tool === null || owner.tool === tool)),
    anyMcp: owned.length > 0,
  };
}

function slugsOf(servers: readonly ResolvedMcpServer[]): ReadonlySet<string> {
  return new Set(servers.map((server) => server.slug));
}

function skillSpellings(skills: readonly EngineSkill[]): ReadonlySet<string> {
  return new Set(skills.flatMap(spellingsOf));
}
