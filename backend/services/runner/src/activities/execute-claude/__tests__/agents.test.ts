/**
 * Pins the agents of a Claude turn (`agents.ts`): who the sub-agents are,
 * what each may reach, what the engine is handed, and the definitions it
 * runs them from.
 *
 * Why it matters: the engine has one pool for the session (measured on SDK
 * 0.3.310), so the engine is handed the union and the gate holds each agent
 * to its own reach. A reach computed too wide is a sub-agent calling the
 * main agent's servers or skills (or the reverse); too narrow, a tool its
 * lists allow that it cannot call. Each case below is a world the native
 * engine gives the same agent (`execute-deep-agent/subagent-transformer.ts`):
 * a saved sub-agent its own servers and none of the main agent's or the
 * platform's, its own shell values; a plugin agent the main agent's servers
 * under its narrowed lists; nobody `Agent`.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { TurnInput, TurnSubagent } from "../../../harness/types.js";
import type { PluginSubagent } from "../../../shared/blueprint-resolver.js";
import type { ResolvedMcpServer } from "../../../shared/mcp-resolver.js";
import { NO_RUN_VALUES } from "../../../shared/run-values.js";
import { ToolListResolutionError, ToolScope } from "../../../shared/tool-lists.js";
import { stubRegistryFetch } from "../../../__test-utils__/model-registry-fixture.js";
import { turnInputFixture } from "../../../__test-utils__/turn-input-fixture.js";
import { agentDefinitionsOf, bridgeServersOf, checkAgentToolLists, subagentSpecsOf, turnAgentsOf, type SubagentSpec } from "../agents.js";
import { SkillNameClash } from "../skill-plugins.js";

const WORKSPACE = "/work/repo";
const SHELL = "mcp__stigmer__bash";

function server(slug: string): ResolvedMcpServer {
  return { slug, connectionType: "http", url: `http://127.0.0.1:1/${slug}`, headers: {}, home: { kind: "agent", agentId: "agt", subagent: null, server: slug } };
}

function saved(overrides: Partial<TurnSubagent> = {}): TurnSubagent {
  return {
    name: "test-runner",
    description: "Runs the tests.",
    instructions: "You run the tests.",
    model: undefined,
    toolScope: ToolScope.of('Subagent "test-runner"', { tools: [], disallowedTools: ["Agent"] }),
    servers: [server("ci")],
    skills: [{ name: "ci-checklist", description: "CI checks.", path: ".stigmer/skills/ci-checklist/SKILL.md" }],
    hooks: [],
    values: { RUNNER_ONLY: "1" },
    bringsOwn: { plugins: false, hooks: false, lists: false, mcpServers: true },
    ...overrides,
  };
}

const PLUGIN_AGENT: PluginSubagent = { name: "acme:helper", description: "", instructions: "You help.", tools: [], disallowedTools: ["Write"], model: "" };

/** A turn: the main agent with the docs server, the platform's channel server and a skill, one saved and one plugin sub-agent. */
function input(overrides: { toolScope?: ToolScope; subagents?: TurnSubagent[]; pluginAgents?: PluginSubagent[]; planMode?: boolean } = {}): TurnInput {
  const base = turnInputFixture({ workspaceDir: WORKSPACE, values: { ...NO_RUN_VALUES, agent: { MAIN_ONLY: "1" } } });
  return {
    ...base,
    mcp: { ...base.mcp, servers: [server("docs"), server("chan")], platformServerSlugs: new Set(["chan"]), toolScope: overrides.toolScope ?? ToolScope.unrestricted() },
    skills: { root: [{ name: "review", description: "Reviews.", path: ".stigmer/skills/review/SKILL.md" }], bySubAgent: new Map() },
    subagents: overrides.subagents ?? [saved()],
    blueprint: { ...base.blueprint, pluginAgents: overrides.pluginAgents ?? [PLUGIN_AGENT] },
  };
}

/** The bridge as connected: every listed tool by its engine name. */
function bridgeOf(tools: Record<string, readonly string[]>): { offered: ReadonlySet<string>; serverOf: (name: string) => { slug: string; tool: string } | undefined } {
  const owners = new Map<string, { slug: string; tool: string }>(Object.entries(tools).flatMap(([slug, names]) => names.map((tool): [string, { slug: string; tool: string }] => [`mcp__${slug}__${tool}`, { slug, tool }])));
  return { offered: new Set(owners.keys()), serverOf: (name) => owners.get(name) };
}

const BRIDGE = bridgeOf({ docs: ["search", "drop"], chan: ["send"], ci: ["run", "cancel"] });

let registry: ReturnType<typeof stubRegistryFetch>;
beforeAll(() => {
  registry = stubRegistryFetch();
});
afterAll(() => registry.restore());

describe("subagentSpecsOf", () => {
  it("lists every plugin agent and saved sub-agent, each with its own world", async () => {
    const specs = await subagentSpecsOf(input());
    expect(specs.map((spec) => [spec.name, spec.kind])).toEqual([
      ["acme:helper", "plugin"],
      ["test-runner", "saved"],
    ]);
    const [helper, runner] = specs as [SubagentSpec, SubagentSpec];
    expect(helper.description, "native's fallback for an empty description").toBe("Sub-agent: acme:helper");
    expect(helper.servers.map((s) => s.slug), "a plugin agent has the main agent's servers").toEqual(["docs", "chan"]);
    expect(helper.shellValues).toEqual({ MAIN_ONLY: "1" });
    expect(helper.scope.allowsClaudeTool("Write"), "its plugin's lists narrow the main agent's").toBe(false);
    expect(helper.scope.allowsClaudeTool("Agent")).toBe(false);
    expect(runner.servers.map((s) => s.slug), "a saved sub-agent has its own servers alone").toEqual(["ci"]);
    expect(runner.shellValues).toEqual({ RUNNER_ONLY: "1" });
    expect(runner.model).toBeUndefined();
  });

  it("keeps only the types the main agent's lists name, and runs a plugin agent's unlisted model as the turn's", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const specs = await subagentSpecsOf(input({ toolScope: ToolScope.of("agent", { tools: ["Read", "Agent(test-runner)"], disallowedTools: [] }), pluginAgents: [{ ...PLUGIN_AGENT, model: "sonnet" }] }));
    expect(specs.map((spec) => spec.name)).toEqual(["test-runner"]);
    expect(log.mock.calls.some((args) => String(args[0]).includes("names model 'sonnet'"))).toBe(true);
    log.mockRestore();
  });
});

describe("bridgeServersOf", () => {
  it("connects every distinct server once, and lists a tool when some agent that has its server may call it", async () => {
    const turn = input({
      toolScope: ToolScope.of("agent", { tools: [], disallowedTools: ["mcp__docs__drop"] }),
      subagents: [saved({ toolScope: ToolScope.of('Subagent "test-runner"', { tools: [], disallowedTools: ["mcp__ci__cancel", "Agent"] }), servers: [server("ci"), server("docs")] })],
    });
    const { servers, inScope } = bridgeServersOf(turn, await subagentSpecsOf(turn));
    expect(servers.map((s) => s.slug)).toEqual(["docs", "chan", "ci"]);
    expect(inScope("docs", "search")).toBe(true);
    expect(inScope("docs", "drop"), "the saved sub-agent shares docs and its lists allow drop").toBe(true);
    expect(inScope("ci", "run")).toBe(true);
    expect(inScope("ci", "cancel"), "nobody that has ci may call cancel").toBe(false);
  });
});

describe("turnAgentsOf", () => {
  it("gives the main agent its own tools, skills and helpers, and each sub-agent its own", async () => {
    const turn = input();
    const agents = turnAgentsOf(turn, await subagentSpecsOf(turn), BRIDGE, { planMode: false, structuredOutput: false });
    const root = agents.root.reach;
    expect([...root.tools].sort()).toEqual(
      ["Read", "Write", "Edit", "NotebookEdit", "Glob", "Grep", "Bash", "TodoWrite", "ToolSearch", SHELL, "mcp__docs__search", "mcp__docs__drop", "mcp__chan__send", "Skill", "Agent"].sort(),
    );
    expect([...root.skills]).toEqual(["agent:review"]);
    expect([...root.agentTypes]).toEqual(["acme:helper", "test-runner"]);

    const runner = agents.subagents.get("test-runner")!;
    expect([...runner.reach.tools].sort()).toEqual(["Read", "Write", "Edit", "NotebookEdit", "Glob", "Grep", "Bash", "TodoWrite", "ToolSearch", SHELL, "mcp__ci__run", "mcp__ci__cancel", "Skill"].sort());
    expect(runner.reach.tools.has("mcp__chan__send"), "a saved sub-agent never gets the platform's servers").toBe(false);
    expect([...runner.reach.skills]).toEqual(["agent:ci-checklist"]);
    expect(runner.reach.agentTypes.size).toBe(0);
    expect(runner.shellValues).toEqual({ RUNNER_ONLY: "1" });

    const helper = agents.subagents.get("acme:helper")!;
    expect(helper.reach.tools.has("Write")).toBe(false);
    expect(helper.reach.tools.has("mcp__chan__send"), "a plugin agent has the main agent's servers").toBe(true);
    expect(helper.reach.tools.has("Skill")).toBe(false);
    expect(helper.reach.tools.has("Agent")).toBe(false);

    expect(agents.skills.map((skill) => skill.id)).toEqual(["agent:review", "agent:ci-checklist"]);
    expect(agents.shell).toBe(true);
  });

  it("hands the engine the union of every agent's built-ins, so a tool only a sub-agent may use is the gate's to refuse the main agent", async () => {
    const turn = input({ toolScope: ToolScope.of("agent", { tools: ["Read", "Agent"], disallowedTools: [] }), pluginAgents: [] });
    const agents = turnAgentsOf(turn, await subagentSpecsOf(turn), BRIDGE, { planMode: false, structuredOutput: true });
    expect([...agents.root.reach.tools].sort(), "skills and the platform's servers are outside every allow-list").toEqual(
      ["Agent", "Read", "StructuredOutput", "Skill", "ToolSearch", "mcp__chan__send"].sort(),
    );
    expect(agents.sessionTools).toEqual(expect.arrayContaining(["Read", "Write", "Bash", "Skill", "Agent", "ToolSearch"]));
    expect(agents.sessionTools).not.toContain("StructuredOutput");
    expect(agents.shell, "the sub-agent's shell is the host's").toBe(true);
  });

  it("lists a sub-agent's servers' tools outside its lists as its own to be denied", async () => {
    const turn = input({ subagents: [saved({ toolScope: ToolScope.of('Subagent "test-runner"', { tools: [], disallowedTools: ["mcp__ci__cancel", "Agent"] }) })] });
    const agents = turnAgentsOf(turn, await subagentSpecsOf(turn), BRIDGE, { planMode: false, structuredOutput: false });
    const runner = agents.subagents.get("test-runner")!;
    expect(runner.mcpTools).toEqual(["mcp__ci__run"]);
    expect(runner.deniedMcpTools).toEqual(["mcp__ci__cancel"]);
  });

  it("offers nobody a write or the shell in plan mode, the sub-agents included", async () => {
    const turn = input();
    const agents = turnAgentsOf(turn, await subagentSpecsOf(turn), BRIDGE, { planMode: true, structuredOutput: false });
    for (const world of [agents.root, ...agents.subagents.values()]) {
      for (const tool of ["Write", "Edit", "NotebookEdit", "Bash", SHELL]) expect(world.reach.tools.has(tool)).toBe(false);
    }
    expect(agents.shell).toBe(false);
    expect(agents.root.reach.tools.has("Skill")).toBe(true);
  });

  it("offers no Agent and no Skill on a turn with neither", async () => {
    const base = input({ subagents: [], pluginAgents: [] });
    const turn = { ...base, skills: { root: [], bySubAgent: new Map() } };
    const agents = turnAgentsOf(turn, [], BRIDGE, { planMode: false, structuredOutput: false });
    expect(agents.root.reach.tools.has("Agent")).toBe(false);
    expect(agents.root.reach.tools.has("Skill")).toBe(false);
    expect(agents.sessionTools).not.toContain("Agent");
    expect(agents.sessionTools).not.toContain("Skill");
  });

  it("refuses a turn whose agents' skills cannot be named apart", async () => {
    const turn = input({ subagents: [saved({ skills: [{ name: "review.x", description: "d", path: ".stigmer/skills/review.x/SKILL.md" }, { name: "review-x", description: "d", path: ".stigmer/skills/review-x/SKILL.md" }] })] });
    expect(() => turnAgentsOf(turn, [], BRIDGE, { planMode: false, structuredOutput: false })).not.toThrow();
    const specs = await subagentSpecsOf(turn);
    expect(() => turnAgentsOf(turn, specs, BRIDGE, { planMode: false, structuredOutput: false })).toThrow(SkillNameClash);
  });
});

describe("agentDefinitionsOf", () => {
  it("defines each sub-agent with its prompt, the turn's model, exactly its tools and its servers by the session's names", async () => {
    const turn = input({ subagents: [saved({ toolScope: ToolScope.of('Subagent "test-runner"', { tools: [], disallowedTools: ["mcp__ci__cancel", "Agent"] }) })] });
    const agents = turnAgentsOf(turn, await subagentSpecsOf(turn), BRIDGE, { planMode: false, structuredOutput: false });
    const definitions = await agentDefinitionsOf(agents, (world) => `prompt of ${world.spec.name}`);
    expect(Object.keys(definitions)).toEqual(["acme:helper", "test-runner"]);
    const runner = definitions["test-runner"]!;
    expect(runner).toMatchObject({ description: "Runs the tests.", prompt: "prompt of test-runner", model: "inherit", disallowedTools: ["mcp__ci__cancel"], mcpServers: ["ci", "stigmer"] });
    expect(runner.tools).toEqual([...agents.subagents.get("test-runner")!.reach.tools]);
    expect(runner).not.toHaveProperty("skills");
    expect(definitions["acme:helper"]!.mcpServers).toEqual(["docs", "chan", "stigmer"]);
    expect(definitions["acme:helper"]).not.toHaveProperty("disallowedTools");
  });

  it("names a sub-agent's own model by the provider's id", async () => {
    const turn = input({ subagents: [saved({ model: "claude-sonnet-4.6" })], pluginAgents: [] });
    const agents = turnAgentsOf(turn, await subagentSpecsOf(turn), BRIDGE, { planMode: false, structuredOutput: false });
    expect((await agentDefinitionsOf(agents, () => "p"))["test-runner"]!.model).toBe("claude-sonnet-4-6");
  });
});

describe("checkAgentToolLists", () => {
  it("refuses a saved sub-agent whose tools list names nothing it binds", async () => {
    const turn = input({
      pluginAgents: [],
      subagents: [saved({ toolScope: ToolScope.of('Subagent "test-runner"', { tools: ["mcp__docs__search"], disallowedTools: ["Agent"] }), bringsOwn: { plugins: false, hooks: false, lists: true, mcpServers: true } })],
    });
    const agents = turnAgentsOf(turn, await subagentSpecsOf(turn), BRIDGE, { planMode: false, structuredOutput: false });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(() => checkAgentToolLists(turn, agents, BRIDGE, { planMode: false })).toThrow(ToolListResolutionError);
    warn.mockRestore();
  });

  it("passes the turn's own lists when every agent's resolves", async () => {
    const turn = input();
    const agents = turnAgentsOf(turn, await subagentSpecsOf(turn), BRIDGE, { planMode: false, structuredOutput: false });
    expect(() => checkAgentToolLists(turn, agents, BRIDGE, { planMode: false })).not.toThrow();
  });
});
