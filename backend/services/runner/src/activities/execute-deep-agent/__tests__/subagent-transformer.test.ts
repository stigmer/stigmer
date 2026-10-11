/**
 * Pins the subagent transformer: the built-in types and their prompts; a
 * plugin subagent's transform (its plugin's instructions and skills, the
 * model its file names where this engine lists it, web_fetch and no think,
 * the parent's scope narrowed by its lists, never widened); a saved
 * subagent's transform (its own servers' tools and web_fetch, never the
 * parent's MCP tools, its own model, scope, gate and shell); one level
 * (every compiled subagent's scope, the built-ins' included, denies `Agent`,
 * so deepagents' `task` tool is out of scope inside it); the main agent's
 * `Agent(type, …)` filter over built-ins, plugin and saved subagents alike;
 * and compilation (a stack per invocation, a saved subagent's own gate, a
 * refused spec skipped at setup, the invocation id hooks see kept across a
 * resume).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { StructuredTool } from "@langchain/core/tools";
import { NATIVE_TOOL_COVERS } from "@stigmer/tool-vocabulary";

import {
  BUILTIN_SUBAGENT_TYPES,
  createBuiltinSubagents,
  compileSubagents,
  subAgentInvocationId,
  transformAndCompileSubagents,
  transformPluginSubagent,
  transformSavedSubagent,
  type SavedSubagentGraph,
  type SubagentScopeBase,
  type SubagentTransformOptions,
  type TransformedSubagent,
} from "../subagent-transformer.js";
import type { TurnSubagent } from "../../../harness/types.js";
import type { ApprovalGateConfig } from "../../../middleware/approval-gate.js";
import type { PluginSubagent } from "../../../shared/blueprint-resolver.js";
import type { HookEvaluator } from "../../../shared/hooks/evaluate.js";
import { ToolScope } from "../../../shared/tool-lists.js";
import type { ToolScopeConfig } from "../../../middleware/tool-scope.js";
import { _resetRegistryCache } from "../../../shared/model-registry.js";
import { mockWorkspaceBackend } from "../../../__test-utils__/mock-workspace.js";
import * as subagentWiringModule from "../subagent-wiring.js";
import { ScriptedModel } from "../__test-utils__/scripted-model.js";
import { HumanMessage } from "@langchain/core/messages";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// =========================================================================
// Test helpers
// =========================================================================

const UNRESTRICTED = ToolScope.unrestricted();
const SCOPE_BASE: SubagentScopeBase = {
  serverToolMap: new Map(),
  platformServerSlugs: new Set(),
  admitsConfinedRead: async () => false,
  readsSkillContent: async () => false,
};

function mockTool(name: string): StructuredTool {
  return { name, description: `Mock tool: ${name}` } as unknown as StructuredTool;
}

function pluginAgent(overrides: Partial<PluginSubagent> = {}): PluginSubagent {
  return {
    name: "kit:reviewer",
    description: "Reviews code",
    instructions: "You review code.",
    tools: [],
    disallowedTools: [],
    model: "",
    ...overrides,
  };
}

function savedContext(overrides: Partial<TurnSubagent> = {}): TurnSubagent {
  return {
    name: "release-notes",
    description: "Writes release notes",
    instructions: "You write release notes.",
    model: undefined,
    toolScope: ToolScope.ofMain([{ owner: "A subagent", lists: { tools: [], disallowedTools: ["Agent"] } }]),
    servers: [],
    skills: [],
    hooks: [],
    values: {},
    bringsOwn: { plugins: false, hooks: false, lists: false },
    ...overrides,
  };
}

function gateConfig(hooks: HookEvaluator | null = null): ApprovalGateConfig {
  return {
    mcpDefault: { destructive: new Set(), unlisted: new Set<string>(), leasedServers: new Set() },
    toolServerMap: new Map(),
    hooks,
  };
}

function savedGraph(subagent: TurnSubagent, mcpTools: StructuredTool[] = [], approvalGate: ApprovalGateConfig | null = null): SavedSubagentGraph {
  return { subagent, mcpTools, approvalGate, shellEnv: undefined };
}

/** A registry with one native model and one Cursor model. */
function mockRegistry(): void {
  vi.spyOn(global, "fetch").mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
      models: [
        { id: "claude-sonnet-4-6", provider: "anthropic", harness: "native" },
        { id: "claude-haiku-4.5", provider: "anthropic", harness: "native" },
        { id: "composer-2.5", provider: "cursor", harness: "cursor" },
      ],
    }),
  } as Response);
}

// =========================================================================
// Tests: Built-in subagent types
// =========================================================================

describe("BUILTIN_SUBAGENT_TYPES", () => {
  it("contains explore, shell, and general-purpose", () => {
    expect(BUILTIN_SUBAGENT_TYPES.has("explore")).toBe(true);
    expect(BUILTIN_SUBAGENT_TYPES.has("shell")).toBe(true);
    expect(BUILTIN_SUBAGENT_TYPES.has("general-purpose")).toBe(true);
    expect(BUILTIN_SUBAGENT_TYPES.size).toBe(3);
  });
});

// =========================================================================
// Tests: createBuiltinSubagents
// =========================================================================

describe("createBuiltinSubagents", () => {
  it("returns empty array when no workspace", () => {
    const result = createBuiltinSubagents(false, UNRESTRICTED);
    expect(result).toEqual([]);
  });

  it("creates explore, shell, and general-purpose subagents when workspace exists", () => {
    const result = createBuiltinSubagents(true, UNRESTRICTED);
    expect(result).toHaveLength(3);

    const names = result.map((r) => r.name);
    expect(names).toContain("explore");
    expect(names).toContain("shell");
    expect(names).toContain("general-purpose");
  });

  it("explore has read-only prompt with strict boundaries", () => {
    const result = createBuiltinSubagents(true, UNRESTRICTED);
    const explore = result.find((r) => r.name === "explore")!;

    expect(explore.systemPrompt).toContain("exploration specialist");
    expect(explore.systemPrompt).toContain("Do NOT write files");
    expect(explore.systemPrompt).toContain("Do NOT execute shell commands");
    expect(explore.systemPrompt).toContain("## Response rules");
  });

  it("shell has execution-focused prompt", () => {
    const result = createBuiltinSubagents(true, UNRESTRICTED);
    const shell = result.find((r) => r.name === "shell")!;

    expect(shell.systemPrompt).toContain("command execution specialist");
    expect(shell.systemPrompt).toContain("## Response rules");
  });

  it("all built-in subagents have response rules appended", () => {
    const result = createBuiltinSubagents(true, UNRESTRICTED);
    for (const sa of result) {
      expect(sa.systemPrompt).toContain("NEVER reprint, echo, list");
      expect(sa.systemPrompt).toContain("parent agent has direct access");
    }
  });

  it("built-in subagents have descriptions", () => {
    const result = createBuiltinSubagents(true, UNRESTRICTED);
    for (const sa of result) {
      expect(sa.description.length).toBeGreaterThan(10);
    }
  });

  it("built-in subagents have empty tool arrays (use FilesystemBackend built-ins)", () => {
    const result = createBuiltinSubagents(true, UNRESTRICTED);
    for (const sa of result) {
      expect(sa.tools).toEqual([]);
    }
  });

  it("gives web_fetch to general-purpose only, when a guard posture is supplied", () => {
    const result = createBuiltinSubagents(true, UNRESTRICTED, [], "strict");
    for (const sa of result) {
      const hasWebFetch = sa.tools.some((t) => t.name === "web_fetch");
      expect(hasWebFetch).toBe(sa.name === "general-purpose");
    }
  });

  it("built-ins run under the parent's own scope, with Agent denied: they declare no lists and hand no work on", () => {
    const parent = ToolScope.of("Agent \"a\"", { tools: ["Read", "Agent"], disallowedTools: [] });
    for (const sa of createBuiltinSubagents(true, parent)) {
      expect(sa.scope.allowsClaudeTool("Read"), sa.name).toBe(true);
      expect(sa.scope.allowsClaudeTool("Write"), sa.name).toBe(false);
      expect(sa.scope.allowsClaudeTool("Agent"), sa.name).toBe(false);
      expect(sa.scope.allowsEngineTool("task", NATIVE_TOOL_COVERS), sa.name).toBe(false);
    }
  });

  it("general-purpose binds the parent's MCP tools; explore and shell bind none", () => {
    const github = mockTool("search_code");
    for (const sa of createBuiltinSubagents(true, UNRESTRICTED, [github])) {
      expect(sa.tools.includes(github), sa.name).toBe(sa.name === "general-purpose");
    }
  });

  it("built-in subagents have no model override", () => {
    const result = createBuiltinSubagents(true, UNRESTRICTED);
    for (const sa of result) {
      expect(sa.model).toBeUndefined();
    }
  });
});

// =========================================================================
// Tests: transformPluginSubagent
// =========================================================================

describe("transformPluginSubagent", () => {
  const opts = { parentScope: UNRESTRICTED, webFetchPosture: "strict" as const, skills: new Map() };

  beforeEach(() => {
    _resetRegistryCache();
    mockRegistry();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    _resetRegistryCache();
    vi.restoreAllMocks();
  });

  it("carries its plugin's description and instructions, the response rules after them", async () => {
    const result = await transformPluginSubagent(pluginAgent(), opts);
    expect(result.name).toBe("kit:reviewer");
    expect(result.description).toBe("Reviews code");
    expect(result.systemPrompt).toContain("You review code.");
    expect(result.systemPrompt).toContain("## Response rules");
    expect(result.own, "a plugin subagent runs the parent's gate and shell").toBeUndefined();
  });

  it("uses a default description when its file gives none", async () => {
    expect((await transformPluginSubagent(pluginAgent({ name: "kit:helper", description: "" }), opts)).description).toBe("Sub-agent: kit:helper");
  });

  it("binds web_fetch and nothing else of its own: no think tool (#1976)", async () => {
    expect((await transformPluginSubagent(pluginAgent(), opts)).tools.map((t) => t.name)).toEqual(["web_fetch"]);
  });

  it("runs on the model its file names when this engine lists it", async () => {
    expect((await transformPluginSubagent(pluginAgent({ model: "claude-haiku-4.5" }), opts)).model).toBe("claude-haiku-4.5");
  });

  it.each(["", "inherit", "sonnet", "composer-2.5", "nonexistent-model-xyz"])("runs on the turn's model when its file names %j", async (model) => {
    expect((await transformPluginSubagent(pluginAgent({ model }), opts)).model).toBeUndefined();
  });

  it("renders the skills mounted for it, keyed by its name, and no other's", async () => {
    const skills = new Map([
      ["kit:reviewer", [{ name: "kit:triage", description: "Sort the inbox", path: ".stigmer/plugins/d/skills/triage/SKILL.md" }]],
      ["kit:other", [{ name: "kit:not-mine", description: "Another agent's", path: ".stigmer/plugins/d/skills/not-mine/SKILL.md" }]],
    ]);
    const result = await transformPluginSubagent(pluginAgent(), { ...opts, skills });
    expect(result.systemPrompt).toContain("## Skills");
    expect(result.systemPrompt).toContain("### kit:triage");
    expect(result.systemPrompt).not.toContain("not-mine");
  });

  it("narrows the parent's scope by its lists, never widens it, and denies Agent", async () => {
    const parentScope = ToolScope.of("Agent \"a\"", { tools: ["Read", "Bash", "Agent"], disallowedTools: [] });
    const result = await transformPluginSubagent(pluginAgent({ tools: ["Read", "Write"] }), { ...opts, parentScope });
    expect(result.scope.allowsClaudeTool("Read")).toBe(true);
    expect(result.scope.allowsClaudeTool("Bash"), "narrowed by its tools").toBe(false);
    expect(result.scope.allowsClaudeTool("Write"), "the parent excludes it").toBe(false);
    expect(result.scope.allowsEngineTool("task", NATIVE_TOOL_COVERS), "one level").toBe(false);
  });
});

// =========================================================================
// Tests: transformSavedSubagent
// =========================================================================

describe("transformSavedSubagent", () => {
  it("binds its own servers' tools and web_fetch, under its own scope, gate and shell", () => {
    const evaluator = { preToolUse: vi.fn() } as unknown as HookEvaluator;
    const gate = gateConfig(evaluator);
    const scope = ToolScope.of("Subagent \"release-notes\"", { tools: ["Read"], disallowedTools: ["Agent"] });
    const result = transformSavedSubagent(
      { subagent: savedContext({ toolScope: scope, model: "claude-haiku-4.5" }), mcpTools: [mockTool("changelog_write")], approvalGate: gate, shellEnv: { NOTES_KEY: "n" } },
      "strict",
    );
    expect(result.tools.map((t) => t.name)).toEqual(["changelog_write", "web_fetch"]);
    expect(result.model).toBe("claude-haiku-4.5");
    expect(result.scope).toBe(scope);
    expect(result.own).toEqual({ approvalGate: gate, shellEnv: { NOTES_KEY: "n" } });
  });

  it("runs the turn's model when its context names none, and renders its own skills", () => {
    const result = transformSavedSubagent(
      savedGraph(savedContext({ description: "", skills: [{ name: "changelog:changelog", description: "Write one", path: ".stigmer/plugins/d/skills/changelog/SKILL.md" }] })),
      "strict",
    );
    expect(result.model).toBeUndefined();
    expect(result.description).toBe("Subagent: release-notes");
    expect(result.systemPrompt).toContain("You write release notes.");
    expect(result.systemPrompt).toContain("### changelog:changelog");
    expect(result.systemPrompt).toContain("## Response rules");
  });
});

// =========================================================================
// Tests: compileSubagents
// =========================================================================

describe("compileSubagents", () => {
  it("returns empty array for empty input", async () => {
    const result = await compileSubagents([], {
      parentModelName: "claude-sonnet-4-6",
      workspaceRootDir: "/workspace",
    });
    expect(result).toEqual([]);
  });

  it("compiles transformed subagents into CompiledSubAgent format", async () => {
    const specs: TransformedSubagent[] = [{
      name: "test-sa",
      description: "Test subagent",
      systemPrompt: "You are a test agent.",
      tools: [],
      scope: UNRESTRICTED,
    }];

    const result = await compileSubagents(specs, {
      parentModelName: "claude-sonnet-4-6",
      workspaceRootDir: "/workspace",
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("test-sa");
    expect(result[0].description).toBe("Test subagent");
    expect(result[0].runnable).toBeDefined();
  });

  it("continues when one subagent fails compilation", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const specs: TransformedSubagent[] = [
      { name: "good", description: "Good", systemPrompt: "ok", tools: [] , scope: UNRESTRICTED },
      { name: "also-good", description: "Also good", systemPrompt: "ok", tools: [] , scope: UNRESTRICTED },
    ];

    const result = await compileSubagents(specs, {
      parentModelName: "claude-sonnet-4-6",
      workspaceRootDir: "/workspace",
    });

    expect(result.length).toBeGreaterThan(0);
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("applies SubAgentGate to compiled runnables", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const specs: TransformedSubagent[] = [{
      name: "gated",
      description: "Gated agent",
      systemPrompt: "test",
      tools: [],
      scope: UNRESTRICTED,
    }];

    const result = await compileSubagents(specs, {
      parentModelName: "claude-sonnet-4-6",
      workspaceRootDir: "/workspace",
    });

    expect(result).toHaveLength(1);
    expect(result[0].runnable).toBeDefined();
    expect(typeof result[0].runnable.invoke).toBe("function");

    logSpy.mockRestore();
  });
});

// =========================================================================
// Tests: compileSubagents builds a stack per invocation (stigmer/stigmer#1699)
// =========================================================================

// Loop detection, the periodic budget and the cost view keep one
// conversation's state in their closures. A stack shared by two invocations
// running at once pools that state, so every invocation builds its own; the
// one build at compile is the setup-time validation and is never run. The
// behaviour this protects is pinned end to end in
// `hermetic/sub-agent-concurrent-invocations.test.ts`; this case pins the
// property itself, for every middleware and every interleaving.
describe("compileSubagents: one middleware stack per invocation", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "subagent-per-invocation-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(root, { recursive: true, force: true });
  });

  it("builds a fresh middleware stack for each of two concurrent invocations of one sub-agent", async () => {
    const build = vi.spyOn(subagentWiringModule, "buildSubAgentMiddleware");
    const [worker] = await compileSubagents(
      [{ name: "worker", description: "test worker", systemPrompt: "work", tools: [] , scope: UNRESTRICTED }],
      {
        parentModelName: "claude-sonnet-4-6",
        workspaceRootDir: root,
        modelFactory: async () => new ScriptedModel(() => ({ toolCalls: [], done: "ok" })),
      },
    );
    expect(build, "one validation build at compile").toHaveBeenCalledTimes(1);

    const invoke = (n: number) =>
      worker.runnable.invoke(
        { messages: [new HumanMessage({ content: `task ${n}` })] },
        { configurable: { thread_id: `per-invocation-${n}` }, recursionLimit: 50 },
      );
    await Promise.all([invoke(1), invoke(2)]);

    expect(build, "one more build per invocation").toHaveBeenCalledTimes(3);
    const stacks = build.mock.results.map((r) => r.value as unknown);
    expect(new Set(stacks).size, "no two invocations share a stack, and neither runs on the validation build").toBe(3);
  });

  it("still skips, at setup, a sub-agent deepagents refuses to build", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const compiled = await compileSubagents(
      [
        // A tool named like a deepagents built-in: createDeepAgent throws TOOL_NAME_COLLISION.
        { name: "colliding", description: "refused", systemPrompt: "x", tools: [mockTool("read_file")] , scope: UNRESTRICTED },
        { name: "fine", description: "built", systemPrompt: "x", tools: [] , scope: UNRESTRICTED },
      ],
      { parentModelName: "claude-sonnet-4-6", workspaceRootDir: root },
    );

    expect(compiled.map((c) => c.name), "the refused spec is skipped before any delegation").toEqual(["fine"]);
    expect(errorSpy.mock.calls.some((args) => String(args[0]).includes("Failed to compile sub-agent 'colliding'"))).toBe(true);
  });
});

// =========================================================================
// Tests: transformAndCompileSubagents (orchestrator)
// =========================================================================

describe("transformAndCompileSubagents", () => {
  const baseOptions: SubagentTransformOptions = {
    pluginAgents: [],
    subagents: [],
    parentMcpTools: [],
    parentScope: UNRESTRICTED,
    scopeBase: SCOPE_BASE,
    skills: new Map(),
    workspaceBackend: mockWorkspaceBackend(),
    approvalGate: null,
    parentModelName: "claude-sonnet-4-6",
    webFetchPosture: "strict",
  };

  beforeEach(() => {
    _resetRegistryCache();
    mockRegistry();
  });

  afterEach(() => {
    _resetRegistryCache();
    vi.restoreAllMocks();
  });

  /** Each compile log line, by subagent name: its model and how many tools it binds. */
  function compiledLines(log: ReturnType<typeof vi.spyOn>): Map<string, string> {
    const lines = new Map<string, string>();
    for (const [line] of log.mock.calls) {
      const match = /Compiled sub-agent '([^']+)' \((.*)\)/.exec(String(line));
      if (match) lines.set(match[1]!, match[2]!);
    }
    return lines;
  }

  it("returns null when there is no subagent and no workspace", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await transformAndCompileSubagents({ ...baseOptions, workspaceBackend: mockWorkspaceBackend({ rootDir: "" }) });
    expect(result).toBeNull();
  });

  it("creates the built-ins when a workspace exists, even without subagents of the agent's", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const names = (await transformAndCompileSubagents(baseOptions))!.map((r) => r.name);
    expect(names.sort()).toEqual(["explore", "general-purpose", "shell"]);
  });

  it("merges the built-ins with plugin and saved subagents", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await transformAndCompileSubagents({
      ...baseOptions,
      pluginAgents: [pluginAgent()],
      subagents: [savedGraph(savedContext())],
    });
    expect(result!.map((r) => r.name).sort()).toEqual(["explore", "general-purpose", "kit:reviewer", "release-notes", "shell"]);
  });

  it("lets a saved subagent with a built-in's name override the built-in, warned", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await transformAndCompileSubagents({
      ...baseOptions,
      subagents: [savedGraph(savedContext({ name: "explore", description: "Our own explorer." }))],
    });
    const explore = result!.filter((r) => r.name === "explore");
    expect(explore).toHaveLength(1);
    expect(explore[0]!.description).toBe("Our own explorer.");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("it overrides the built-in"));
  });

  it("binds a plugin subagent the parent's MCP tools, and a saved subagent only its own servers' tools", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await transformAndCompileSubagents({
      ...baseOptions,
      parentMcpTools: [mockTool("github_search"), mockTool("stigmer_memory_recall")],
      pluginAgents: [pluginAgent()],
      subagents: [savedGraph(savedContext(), [mockTool("changelog_write")])],
    });
    const lines = compiledLines(log);
    expect(lines.get("kit:reviewer"), "the parent's two tools and web_fetch").toBe("model=claude-sonnet-4-6, tools=3");
    expect(lines.get("release-notes"), "its own server's tool and web_fetch").toBe("model=claude-sonnet-4-6, tools=2");
  });

  it("runs each subagent on its own model, a saved one's and a listed plugin one's, else the parent's", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await transformAndCompileSubagents({
      ...baseOptions,
      pluginAgents: [pluginAgent({ model: "claude-haiku-4.5" }), pluginAgent({ name: "kit:alias", model: "sonnet" })],
      subagents: [savedGraph(savedContext({ model: "claude-haiku-4.5" }))],
    });
    const lines = compiledLines(log);
    expect(lines.get("kit:reviewer")).toContain("model=claude-haiku-4.5");
    expect(lines.get("kit:alias")).toContain("model=claude-sonnet-4-6");
    expect(lines.get("release-notes")).toContain("model=claude-haiku-4.5");
  });

  it("gates a saved subagent with its own gate config, and every other subagent with the parent's", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const build = vi.spyOn(subagentWiringModule, "buildSubAgentMiddleware");
    const parentGate = gateConfig({ preToolUse: vi.fn() } as unknown as HookEvaluator);
    const ownGate = gateConfig({ preToolUse: vi.fn() } as unknown as HookEvaluator);
    const result = await transformAndCompileSubagents({
      ...baseOptions,
      approvalGate: parentGate,
      pluginAgents: [pluginAgent()],
      subagents: [savedGraph(savedContext(), [], ownGate)],
    });
    const gates = new Map<string, ApprovalGateConfig | null | undefined>();
    result!.forEach((compiled, i) => gates.set(compiled.name, build.mock.calls[i]![0]!.approvalGate));
    expect(gates.get("release-notes")?.hooks).toBe(ownGate.hooks);
    expect(gates.get("release-notes")?.subAgent?.type).toBe("release-notes");
    expect(gates.get("kit:reviewer")?.hooks).toBe(parentGate.hooks);
    expect(gates.get("general-purpose")?.hooks).toBe(parentGate.hooks);
  });

  describe("tool scopes", () => {
    /** Each compiled subagent's scope, read off the middleware its validation build was given. */
    async function compiledScopes(options: Partial<SubagentTransformOptions>) {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const build = vi.spyOn(subagentWiringModule, "buildSubAgentMiddleware");
      const result = await transformAndCompileSubagents({ ...baseOptions, ...options });
      const scopes = new Map<string, ToolScope | undefined>();
      result!.forEach((compiled, i) => {
        const toolScope = build.mock.calls[i]![0]!.toolScope as ToolScopeConfig | undefined;
        scopes.set(compiled.name, toolScope?.scope);
      });
      return { names: result!.map((r) => r.name), scopes };
    }

    it("gives a built-in the parent's scope, a plugin subagent the parent's narrowed, a saved one its own", async () => {
      const parentScope = ToolScope.of("Agent \"a\"", { tools: [], disallowedTools: ["Bash"] });
      const savedScope = ToolScope.of("Subagent \"release-notes\"", { tools: ["Bash"], disallowedTools: ["Agent"] });
      const { scopes } = await compiledScopes({
        parentScope,
        pluginAgents: [pluginAgent({ tools: ["Read"] })],
        subagents: [savedGraph(savedContext({ toolScope: savedScope }))],
      });

      for (const builtin of ["explore", "shell", "general-purpose"]) {
        expect(scopes.get(builtin)!.allowsClaudeTool("Write"), builtin).toBe(true);
        expect(scopes.get(builtin)!.allowsClaudeTool("Bash"), builtin).toBe(false);
      }
      const reviewer = scopes.get("kit:reviewer")!;
      expect(reviewer.allowsClaudeTool("Read")).toBe(true);
      expect(reviewer.allowsClaudeTool("Write"), "the plugin's allow-list").toBe(false);
      expect(reviewer.allowsClaudeTool("Bash"), "the parent's deny-list").toBe(false);
      expect(scopes.get("release-notes"), "never the parent's lists").toBe(savedScope);
      expect(scopes.get("release-notes")!.allowsClaudeTool("Bash")).toBe(true);
    });

    it("takes the task tool out of every subagent's scope: none hands work on", async () => {
      const { scopes } = await compiledScopes({
        parentScope: ToolScope.of("Agent \"a\"", { tools: ["Read", "Agent"], disallowedTools: [] }),
        pluginAgents: [pluginAgent()],
        subagents: [savedGraph(savedContext())],
      });
      expect([...scopes.keys()].sort()).toEqual(["explore", "general-purpose", "kit:reviewer", "release-notes", "shell"]);
      for (const [name, scope] of scopes) {
        expect(scope!.allowsClaudeTool("Agent"), name).toBe(false);
        expect(scope!.allowsEngineTool("task", NATIVE_TOOL_COVERS), name).toBe(false);
      }
    });

    it("compiles only the types the main agent's Agent(type, …) names: built-ins, plugin and saved subagents alike", async () => {
      const parentScope = ToolScope.of("Agent \"a\"", { tools: ["Read", "Agent(Explore, release-notes, kit:reviewer)"], disallowedTools: [] });
      const { names } = await compiledScopes({
        parentScope,
        pluginAgents: [pluginAgent(), pluginAgent({ name: "kit:other" })],
        subagents: [savedGraph(savedContext()), savedGraph(savedContext({ name: "triage" }))],
      });
      expect(names.sort()).toEqual(["explore", "kit:reviewer", "release-notes"]);
    });

    it("compiles no subagent when the main agent's lists exclude Agent", async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const result = await transformAndCompileSubagents({
        ...baseOptions,
        parentScope: ToolScope.of("Agent \"a\"", { tools: [], disallowedTools: ["Agent"] }),
        pluginAgents: [pluginAgent()],
        subagents: [savedGraph(savedContext())],
      });
      expect(result).toBeNull();
    });
  });
});

describe("subAgentInvocationId", () => {
  it("is the parent's task call id, so a resumed invocation keeps it", () => {
    expect(subAgentInvocationId({ toolCall: { id: "call-task-1" } })).toBe("call-task-1");
    expect(subAgentInvocationId({ toolCall: { id: "call-task-1" } })).toBe(subAgentInvocationId({ toolCall: { id: "call-task-1" } }));
  });

  it("is a fresh id when the config names no call", () => {
    for (const config of [undefined, null, {}, { toolCall: {} }, { toolCall: { id: "" } }]) {
      const id = subAgentInvocationId(config);
      expect(id).toMatch(/^[0-9a-f-]{36}$/);
      expect(subAgentInvocationId(config)).not.toBe(id);
    }
  });
});
