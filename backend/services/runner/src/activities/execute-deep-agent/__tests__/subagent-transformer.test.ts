/**
 * Pins the sub-agent transformer: the built-in types and their prompts, the
 * proto-to-spec transform (model override, think, web_fetch), each
 * sub-agent's tool scope (narrowed from the parent's, never widened; a
 * built-in runs under the parent's), the main agent's `Agent(type, …)`
 * filter, skills prompts, and compilation (a stack per invocation, a refused
 * spec skipped at setup).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { StructuredTool } from "@langchain/core/tools";
import { ThinkingMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { EffectiveThinkingMode } from "../../../shared/thinking-mode.js";

import {
  BUILTIN_SUBAGENT_TYPES,
  createBuiltinSubagents,
  transformSingleSubagent,
  resolveSubagentSkillPrompt,
  compileSubagents,
  subAgentScope,
  transformAndCompileSubagents,
  type SubagentScopeBase,
  type TransformedSubagent,
} from "../subagent-transformer.js";
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

const NOT_THINKING: EffectiveThinkingMode = ThinkingMode.DISABLED;
const UNRESTRICTED = ToolScope.unrestricted();
const SCOPE_BASE: SubagentScopeBase = {
  serverToolMap: new Map(),
  platformServerSlugs: new Set(),
  admitsConfinedRead: async () => false,
};

function mockTool(name: string): StructuredTool {
  return { name, description: `Mock tool: ${name}` } as unknown as StructuredTool;
}

function mockSubAgentProto(overrides: Partial<{
  name: string;
  description: string;
  instructions: string;
  tools: string[];
  disallowedTools: string[];
  skillRefs: { slug: string }[];
  modelOverride: string;
}> = {}) {
  return {
    name: overrides.name ?? "test-agent",
    description: overrides.description ?? "A test sub-agent",
    instructions: overrides.instructions ?? "You are a test agent.",
    tools: overrides.tools ?? [],
    disallowedTools: overrides.disallowedTools ?? [],
    skillRefs: overrides.skillRefs ?? [],
    modelOverride: overrides.modelOverride ?? "",
  } as unknown as import("@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb").SubAgent;
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

  it("built-ins run under the parent's own scope: they declare no lists", () => {
    const parent = ToolScope.of("Agent \"a\"", { tools: ["Read", "Agent"], disallowedTools: [] });
    for (const sa of createBuiltinSubagents(true, parent)) {
      expect(sa.scope, sa.name).toBe(parent);
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
// Tests: transformSingleSubagent
// =========================================================================

describe("transformSingleSubagent", () => {
  const baseOpts = {
    parentScope: UNRESTRICTED,
    parentThinks: true,
    thinkingMode: NOT_THINKING,
    parentModelName: "claude-sonnet-4-6",
    webFetchPosture: "strict" as const,
  };

  beforeEach(() => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        models: [
          { id: "claude-sonnet-4-6", provider: "anthropic" },
          { id: "claude-haiku-4.5", provider: "anthropic" },
          { id: "gpt-4o-mini", provider: "openai" },
        ],
      }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("transforms proto fields to TransformedSubagent", async () => {
    const proto = mockSubAgentProto({
      name: "code-reviewer",
      description: "Reviews code quality",
      instructions: "You review code.",
    });

    const result = await transformSingleSubagent(proto, baseOpts);

    expect(result).not.toBeNull();
    expect(result!.name).toBe("code-reviewer");
    expect(result!.description).toBe("Reviews code quality");
    expect(result!.systemPrompt).toContain("You review code.");
  });

  it("uses default description when proto description is empty", async () => {
    const proto = mockSubAgentProto({ name: "helper", description: "" });
    const result = await transformSingleSubagent(proto, baseOpts);

    expect(result!.description).toBe("Sub-agent: helper");
  });

  it("appends response rules to system prompt", async () => {
    const proto = mockSubAgentProto({ instructions: "Do things." });
    const result = await transformSingleSubagent(proto, baseOpts);

    expect(result!.systemPrompt).toContain("Do things.");
    expect(result!.systemPrompt).toContain("## Response rules");
  });

  it("does not inject think tool when it inherits a parent that thinks", async () => {
    const proto = mockSubAgentProto();
    const result = await transformSingleSubagent(proto, {
      ...baseOpts,
      parentThinks: true,
    });

    const hasThinkTool = result!.tools.some(
      (t) => t.name === "think" || (t as { name?: string }).name === "think",
    );
    expect(hasThinkTool).toBe(false);
  });

  it("always injects web_fetch, regardless of thinking support", async () => {
    for (const parentThinks of [true, false]) {
      const result = await transformSingleSubagent(mockSubAgentProto(), {
        ...baseOpts,
        parentThinks,
      });
      const hasWebFetch = result!.tools.some((t) => t.name === "web_fetch");
      expect(hasWebFetch).toBe(true);
    }
  });

  it("injects think tool when it inherits a parent that does not think", async () => {
    const proto = mockSubAgentProto();
    const result = await transformSingleSubagent(proto, {
      ...baseOpts,
      parentThinks: false,
    });

    expect(result!.tools.map((t) => t.name)).toContain("think");
  });

  describe("a sub-agent with its own model answers from its own native row", () => {
    beforeEach(() => {
      _resetRegistryCache();
      vi.restoreAllMocks();
      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          models: [
            { id: "claude-sonnet-5", provider: "anthropic", harness: "native", capabilities: { adaptiveThinking: true, thinkingRequired: false } },
            { id: "claude-haiku-4.5", provider: "anthropic", harness: "native", capabilities: { thinking: true, thinkingRequired: false } },
            { id: "claude-fable-5", provider: "anthropic", harness: "native", capabilities: { adaptiveThinking: true, thinkingRequired: true } },
            { id: "composer-2.5", provider: "cursor", harness: "cursor" },
          ],
        }),
      } as Response);
    });

    afterEach(() => {
      _resetRegistryCache();
    });

    const thinkBound = async (modelOverride: string, thinkingMode: ThinkingMode.DISABLED | ThinkingMode.ENABLED, parentThinks: boolean) => {
      const result = await transformSingleSubagent(mockSubAgentProto({ modelOverride }), { ...baseOpts, thinkingMode, parentThinks });
      return result!.tools.some((t) => t.name === "think");
    };

    it("a thinking execution drops think on a model that can think, whatever the parent does", async () => {
      expect(await thinkBound("claude-sonnet-5", ThinkingMode.ENABLED, false)).toBe(false);
      expect(await thinkBound("claude-haiku-4.5", ThinkingMode.ENABLED, false)).toBe(false);
    });

    it("a non-thinking execution binds think, unless the sub-agent's model always thinks", async () => {
      expect(await thinkBound("claude-sonnet-5", ThinkingMode.DISABLED, true)).toBe(true);
      expect(await thinkBound("claude-fable-5", ThinkingMode.DISABLED, false)).toBe(false);
    });

    it("a model with no native row binds think: its request carries no thinking", async () => {
      expect(await thinkBound("composer-2.5", ThinkingMode.ENABLED, true)).toBe(true);
    });
  });

  it("returns null for invalid model override", async () => {
    const proto = mockSubAgentProto({ modelOverride: "nonexistent-model-xyz" });
    const result = await transformSingleSubagent(proto, baseOpts);
    expect(result).toBeNull();
  });

  it("accepts valid model override", async () => {
    const proto = mockSubAgentProto({ modelOverride: "claude-haiku-4.5" });
    const result = await transformSingleSubagent(proto, baseOpts);

    expect(result).not.toBeNull();
    expect(result!.model).toBe("claude-haiku-4.5");
  });

  it("omits model field when no override specified", async () => {
    const proto = mockSubAgentProto({ modelOverride: "" });
    const result = await transformSingleSubagent(proto, baseOpts);

    expect(result!.model).toBeUndefined();
  });

  it("narrows the parent's scope by the sub-agent's own lists, under its own name", async () => {
    const parentScope = ToolScope.of("Agent \"a\"", { tools: ["Read", "Bash"], disallowedTools: [] });
    const proto = mockSubAgentProto({ name: "reader", tools: ["Read"], disallowedTools: [] });
    const result = await transformSingleSubagent(proto, { ...baseOpts, parentScope });

    expect(result!.scope.allowsClaudeTool("Read")).toBe(true);
    expect(result!.scope.allowsClaudeTool("Bash"), "narrowed by the sub-agent's tools").toBe(false);
    expect(result!.scope.owner).toBe('Sub-agent "reader"');
  });

  it("never widens the parent's scope", async () => {
    const parentScope = ToolScope.of("Agent \"a\"", { tools: ["Read"], disallowedTools: [] });
    const proto = mockSubAgentProto({ name: "wide", tools: ["Read", "Bash"], disallowedTools: [] });
    const result = await transformSingleSubagent(proto, { ...baseOpts, parentScope });

    expect(result!.scope.allowsClaudeTool("Bash"), "the parent excludes it").toBe(false);
  });

  it("a sub-agent with no lists keeps the parent's scope", async () => {
    const parentScope = ToolScope.of("Agent \"a\"", { tools: ["Read"], disallowedTools: [] });
    const result = await transformSingleSubagent(mockSubAgentProto(), { ...baseOpts, parentScope });
    expect(result!.scope).toBe(parentScope);
    expect(subAgentScope(parentScope, mockSubAgentProto())).toBe(parentScope);
  });

  it("handles empty instructions gracefully", async () => {
    const proto = mockSubAgentProto({ instructions: "" });
    const result = await transformSingleSubagent(proto, baseOpts);

    expect(result).not.toBeNull();
    expect(result!.systemPrompt).toContain("## Response rules");
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
  const baseOptions = {
    subAgents: [] as unknown[],
    parentMcpTools: [] as StructuredTool[],
    parentScope: UNRESTRICTED,
    scopeBase: SCOPE_BASE,
    skills: new Map(),
    workspaceBackend: mockWorkspaceBackend(),
    approvalGate: null,
    parentModelName: "claude-sonnet-4-6",
    parentThinks: true,
    thinkingMode: NOT_THINKING,
    webFetchPosture: "strict" as const,
    costCap: undefined,
  };

  beforeEach(() => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        models: [
          { id: "claude-sonnet-4-6", provider: "anthropic" },
          { id: "claude-haiku-4.5", provider: "anthropic" },
        ],
      }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when no subAgents and no workspace", async () => {
    const result = await transformAndCompileSubagents({
      ...baseOptions,
      workspaceBackend: mockWorkspaceBackend({ rootDir: "" }),
    } as Parameters<typeof transformAndCompileSubagents>[0]);

    expect(result).toBeNull();
  });

  it("creates built-in subagents when workspace exists even without proto subagents", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await transformAndCompileSubagents(
      baseOptions as Parameters<typeof transformAndCompileSubagents>[0],
    );

    expect(result).not.toBeNull();
    const names = result!.map((r) => r.name);
    expect(names).toContain("explore");
    expect(names).toContain("shell");
    expect(names).toContain("general-purpose");

    logSpy.mockRestore();
  });

  it("proto subagent with built-in name overrides the built-in", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await transformAndCompileSubagents({
      ...baseOptions,
      subAgents: [mockSubAgentProto({ name: "explore", instructions: "Custom explore." })],
    } as Parameters<typeof transformAndCompileSubagents>[0]);

    expect(result).not.toBeNull();
    const exploreCount = result!.filter((r) => r.name === "explore").length;
    expect(exploreCount).toBe(1);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("conflicts with built-in type"),
    );

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("a sub-agent name declared twice resolves to the later declaration", async () => {
    // deepagents refuses duplicate sub-agent names and would fail the turn;
    // the runner keeps the behaviour agents were written against.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await transformAndCompileSubagents({
      ...baseOptions,
      subAgents: [
        mockSubAgentProto({ name: "reviewer", description: "The first reviewer." }),
        mockSubAgentProto({ name: "reviewer", description: "The later reviewer." }),
      ],
    } as Parameters<typeof transformAndCompileSubagents>[0]);

    expect(result).not.toBeNull();
    const reviewers = result!.filter((r) => r.name === "reviewer");
    expect(reviewers).toHaveLength(1);
    expect(reviewers[0].description).toBe("The later reviewer.");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("declared more than once"));

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  describe("tool scopes", () => {
    /** Each compiled sub-agent's scope, read off the middleware its validation build was given. */
    async function compiledScopes(options: Partial<Parameters<typeof transformAndCompileSubagents>[0]>) {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const build = vi.spyOn(subagentWiringModule, "buildSubAgentMiddleware");
      const result = await transformAndCompileSubagents({
        ...baseOptions,
        ...options,
      } as Parameters<typeof transformAndCompileSubagents>[0]);
      const scopes = new Map<string, ToolScope | undefined>();
      result!.forEach((compiled, i) => {
        const toolScope = build.mock.calls[i]![0]!.toolScope as ToolScopeConfig | undefined;
        scopes.set(compiled.name, toolScope?.scope);
      });
      return { names: result!.map((r) => r.name), scopes };
    }

    it("gives every sub-agent its scope with the parent's attribution: a declared one narrowed, a built-in the parent's", async () => {
      const parentScope = ToolScope.of("Agent \"a\"", { tools: [], disallowedTools: ["Bash"] });
      const { scopes } = await compiledScopes({
        parentScope,
        subAgents: [mockSubAgentProto({ name: "reader", tools: ["Read"] })],
      });

      expect(scopes.get("explore")).toBe(parentScope);
      expect(scopes.get("general-purpose")).toBe(parentScope);
      const reader = scopes.get("reader")!;
      expect(reader.allowsClaudeTool("Read")).toBe(true);
      expect(reader.allowsClaudeTool("Write"), "the sub-agent's allow-list").toBe(false);
      expect(reader.allowsClaudeTool("Bash"), "the parent's deny-list").toBe(false);
    });

    it("compiles only the types the main agent's Agent(type, …) names, built-ins included, case-insensitively", async () => {
      const parentScope = ToolScope.of("Agent \"a\"", { tools: ["Read", "Agent(Explore, reviewer)"], disallowedTools: [] });
      const { names } = await compiledScopes({
        parentScope,
        subAgents: [mockSubAgentProto({ name: "reviewer" }), mockSubAgentProto({ name: "writer" })],
      });

      expect(names.sort()).toEqual(["explore", "reviewer"]);
    });

    it("compiles no sub-agent when the main agent's lists exclude Agent", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const parentScope = ToolScope.of("Agent \"a\"", { tools: [], disallowedTools: ["Agent"] });
      const result = await transformAndCompileSubagents({
        ...baseOptions,
        parentScope,
        subAgents: [mockSubAgentProto({ name: "reviewer" })],
      } as Parameters<typeof transformAndCompileSubagents>[0]);

      expect(result).toBeNull();
    });
  });

  it("gracefully handles transform failures for individual subagents", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await transformAndCompileSubagents({
      ...baseOptions,
      subAgents: [
        mockSubAgentProto({ name: "good-agent", modelOverride: "claude-haiku-4.5" }),
        mockSubAgentProto({ name: "bad-agent", modelOverride: "nonexistent-xyz" }),
      ],
    } as Parameters<typeof transformAndCompileSubagents>[0]);

    expect(result).not.toBeNull();
    const names = result!.map((r) => r.name);
    expect(names).toContain("good-agent");
    expect(names).not.toContain("bad-agent");

    errorSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

// =========================================================================
// Tests: resolveSubagentSkillPrompt
// =========================================================================

describe("resolveSubagentSkillPrompt", () => {
  const asSubAgent = (proto: unknown): import("@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb").SubAgent =>
    proto as import("@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb").SubAgent;

  it("returns empty string for a sub-agent the runtime mounted no skills for", () => {
    const proto = mockSubAgentProto({ name: "researcher", skillRefs: [] });
    expect(resolveSubagentSkillPrompt(asSubAgent(proto), new Map())).toBe("");
  });

  it("renders the skills section from the sub-agent's own mounted skills, keyed by its name", () => {
    const proto = mockSubAgentProto({ name: "researcher", skillRefs: [{ slug: "org/my-skill" }] });
    const skills = new Map([
      ["researcher", [{ name: "my-skill", description: "A test skill", path: ".stigmer/skills/my-skill/SKILL.md" }]],
      ["other", [{ name: "not-mine", description: "Another agent's", path: ".stigmer/skills/not-mine/SKILL.md" }]],
    ]);

    const result = resolveSubagentSkillPrompt(asSubAgent(proto), skills);

    expect(result).toContain("## Skills");
    expect(result).toContain("### my-skill");
    expect(result).toContain("**Location**: `.stigmer/skills/my-skill/`");
    expect(result).not.toContain("not-mine");
  });
});

// =========================================================================
// Tests: Edge cases and integration
// =========================================================================

describe("subagent-transformer edge cases", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        models: [
          { id: "claude-sonnet-4-6", provider: "anthropic" },
          { id: "claude-haiku-4.5", provider: "anthropic" },
        ],
      }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("transformSingleSubagent with empty name still transforms", async () => {
    const proto = mockSubAgentProto({ name: "", description: "" });
    const result = await transformSingleSubagent(proto, {
      parentScope: UNRESTRICTED,
      parentThinks: true,
      thinkingMode: NOT_THINKING,
      parentModelName: "claude-sonnet-4-6",
      webFetchPosture: "strict",
    });

    expect(result).not.toBeNull();
    expect(result!.name).toBe("");
    expect(result!.description).toBe("Sub-agent: ");
  });

  it("transformAndCompileSubagents returns null when all subagents fail", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await transformAndCompileSubagents({
      subAgents: [
        mockSubAgentProto({ name: "bad1", modelOverride: "invalid1" }),
        mockSubAgentProto({ name: "bad2", modelOverride: "invalid2" }),
      ],
      parentMcpTools: [],
      parentScope: UNRESTRICTED,
      scopeBase: SCOPE_BASE,
      skills: new Map(),
      workspaceBackend: mockWorkspaceBackend({ rootDir: "" }),
      approvalGate: null,
      parentModelName: "claude-sonnet-4-6",
      parentThinks: true,
      thinkingMode: NOT_THINKING,
      webFetchPosture: "strict",
      costCap: undefined,
    } as Parameters<typeof transformAndCompileSubagents>[0]);

    expect(result).toBeNull();

    errorSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("transformAndCompileSubagents merges built-ins with proto subagents", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await transformAndCompileSubagents({
      subAgents: [mockSubAgentProto({ name: "custom-agent" })],
      parentMcpTools: [],
      parentScope: UNRESTRICTED,
      scopeBase: SCOPE_BASE,
      skills: new Map(),
      workspaceBackend: mockWorkspaceBackend(),
      approvalGate: null,
      parentModelName: "claude-sonnet-4-6",
      parentThinks: true,
      thinkingMode: NOT_THINKING,
      webFetchPosture: "strict",
      costCap: undefined,
    } as Parameters<typeof transformAndCompileSubagents>[0]);

    expect(result).not.toBeNull();
    const names = result!.map((r) => r.name);
    expect(names).toContain("explore");
    expect(names).toContain("shell");
    expect(names).toContain("custom-agent");

    logSpy.mockRestore();
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

  it("built-ins run under the parent's own scope: they declare no lists", () => {
    const parent = ToolScope.of("Agent \"a\"", { tools: ["Read", "Agent"], disallowedTools: [] });
    for (const sa of createBuiltinSubagents(true, parent)) {
      expect(sa.scope, sa.name).toBe(parent);
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
// Tests: transformSingleSubagent
// =========================================================================

describe("transformSingleSubagent", () => {
  const baseOpts = {
    parentScope: UNRESTRICTED,
    parentThinks: true,
    thinkingMode: NOT_THINKING,
    parentModelName: "claude-sonnet-4-6",
    webFetchPosture: "strict" as const,
  };

  beforeEach(() => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        models: [
          { id: "claude-sonnet-4-6", provider: "anthropic" },
          { id: "claude-haiku-4.5", provider: "anthropic" },
          { id: "gpt-4o-mini", provider: "openai" },
        ],
      }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("transforms proto fields to TransformedSubagent", async () => {
    const proto = mockSubAgentProto({
      name: "code-reviewer",
      description: "Reviews code quality",
      instructions: "You review code.",
    });

    const result = await transformSingleSubagent(proto, baseOpts);

    expect(result).not.toBeNull();
    expect(result!.name).toBe("code-reviewer");
    expect(result!.description).toBe("Reviews code quality");
    expect(result!.systemPrompt).toContain("You review code.");
  });

  it("uses default description when proto description is empty", async () => {
    const proto = mockSubAgentProto({ name: "helper", description: "" });
    const result = await transformSingleSubagent(proto, baseOpts);

    expect(result!.description).toBe("Sub-agent: helper");
  });

  it("appends response rules to system prompt", async () => {
    const proto = mockSubAgentProto({ instructions: "Do things." });
    const result = await transformSingleSubagent(proto, baseOpts);

    expect(result!.systemPrompt).toContain("Do things.");
    expect(result!.systemPrompt).toContain("## Response rules");
  });

  it("does not inject think tool when it inherits a parent that thinks", async () => {
    const proto = mockSubAgentProto();
    const result = await transformSingleSubagent(proto, {
      ...baseOpts,
      parentThinks: true,
    });

    const hasThinkTool = result!.tools.some(
      (t) => t.name === "think" || (t as { name?: string }).name === "think",
    );
    expect(hasThinkTool).toBe(false);
  });

  it("always injects web_fetch, regardless of thinking support", async () => {
    for (const parentThinks of [true, false]) {
      const result = await transformSingleSubagent(mockSubAgentProto(), {
        ...baseOpts,
        parentThinks,
      });
      const hasWebFetch = result!.tools.some((t) => t.name === "web_fetch");
      expect(hasWebFetch).toBe(true);
    }
  });

  it("injects think tool when it inherits a parent that does not think", async () => {
    const proto = mockSubAgentProto();
    const result = await transformSingleSubagent(proto, {
      ...baseOpts,
      parentThinks: false,
    });

    expect(result!.tools.map((t) => t.name)).toContain("think");
  });

  describe("a sub-agent with its own model answers from its own native row", () => {
    beforeEach(() => {
      _resetRegistryCache();
      vi.restoreAllMocks();
      vi.spyOn(global, "fetch").mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          models: [
            { id: "claude-sonnet-5", provider: "anthropic", harness: "native", capabilities: { adaptiveThinking: true, thinkingRequired: false } },
            { id: "claude-haiku-4.5", provider: "anthropic", harness: "native", capabilities: { thinking: true, thinkingRequired: false } },
            { id: "claude-fable-5", provider: "anthropic", harness: "native", capabilities: { adaptiveThinking: true, thinkingRequired: true } },
            { id: "composer-2.5", provider: "cursor", harness: "cursor" },
          ],
        }),
      } as Response);
    });

    afterEach(() => {
      _resetRegistryCache();
    });

    const thinkBound = async (modelOverride: string, thinkingMode: ThinkingMode.DISABLED | ThinkingMode.ENABLED, parentThinks: boolean) => {
      const result = await transformSingleSubagent(mockSubAgentProto({ modelOverride }), { ...baseOpts, thinkingMode, parentThinks });
      return result!.tools.some((t) => t.name === "think");
    };

    it("a thinking execution drops think on a model that can think, whatever the parent does", async () => {
      expect(await thinkBound("claude-sonnet-5", ThinkingMode.ENABLED, false)).toBe(false);
      expect(await thinkBound("claude-haiku-4.5", ThinkingMode.ENABLED, false)).toBe(false);
    });

    it("a non-thinking execution binds think, unless the sub-agent's model always thinks", async () => {
      expect(await thinkBound("claude-sonnet-5", ThinkingMode.DISABLED, true)).toBe(true);
      expect(await thinkBound("claude-fable-5", ThinkingMode.DISABLED, false)).toBe(false);
    });

    it("a model with no native row binds think: its request carries no thinking", async () => {
      expect(await thinkBound("composer-2.5", ThinkingMode.ENABLED, true)).toBe(true);
    });
  });

  it("returns null for invalid model override", async () => {
    const proto = mockSubAgentProto({ modelOverride: "nonexistent-model-xyz" });
    const result = await transformSingleSubagent(proto, baseOpts);
    expect(result).toBeNull();
  });

  it("accepts valid model override", async () => {
    const proto = mockSubAgentProto({ modelOverride: "claude-haiku-4.5" });
    const result = await transformSingleSubagent(proto, baseOpts);

    expect(result).not.toBeNull();
    expect(result!.model).toBe("claude-haiku-4.5");
  });

  it("omits model field when no override specified", async () => {
    const proto = mockSubAgentProto({ modelOverride: "" });
    const result = await transformSingleSubagent(proto, baseOpts);

    expect(result!.model).toBeUndefined();
  });

  it("narrows the parent's scope by the sub-agent's own lists, under its own name", async () => {
    const parentScope = ToolScope.of("Agent \"a\"", { tools: ["Read", "Bash"], disallowedTools: [] });
    const proto = mockSubAgentProto({ name: "reader", tools: ["Read"], disallowedTools: [] });
    const result = await transformSingleSubagent(proto, { ...baseOpts, parentScope });

    expect(result!.scope.allowsClaudeTool("Read")).toBe(true);
    expect(result!.scope.allowsClaudeTool("Bash"), "narrowed by the sub-agent's tools").toBe(false);
    expect(result!.scope.owner).toBe('Sub-agent "reader"');
  });

  it("never widens the parent's scope", async () => {
    const parentScope = ToolScope.of("Agent \"a\"", { tools: ["Read"], disallowedTools: [] });
    const proto = mockSubAgentProto({ name: "wide", tools: ["Read", "Bash"], disallowedTools: [] });
    const result = await transformSingleSubagent(proto, { ...baseOpts, parentScope });

    expect(result!.scope.allowsClaudeTool("Bash"), "the parent excludes it").toBe(false);
  });

  it("a sub-agent with no lists keeps the parent's scope", async () => {
    const parentScope = ToolScope.of("Agent \"a\"", { tools: ["Read"], disallowedTools: [] });
    const result = await transformSingleSubagent(mockSubAgentProto(), { ...baseOpts, parentScope });
    expect(result!.scope).toBe(parentScope);
    expect(subAgentScope(parentScope, mockSubAgentProto())).toBe(parentScope);
  });

  it("handles empty instructions gracefully", async () => {
    const proto = mockSubAgentProto({ instructions: "" });
    const result = await transformSingleSubagent(proto, baseOpts);

    expect(result).not.toBeNull();
    expect(result!.systemPrompt).toContain("## Response rules");
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
  const baseOptions = {
    subAgents: [] as unknown[],
    parentMcpTools: [] as StructuredTool[],
    parentScope: UNRESTRICTED,
    scopeBase: SCOPE_BASE,
    skills: new Map(),
    workspaceBackend: mockWorkspaceBackend(),
    approvalGate: null,
    parentModelName: "claude-sonnet-4-6",
    parentThinks: true,
    thinkingMode: NOT_THINKING,
    webFetchPosture: "strict" as const,
    costCap: undefined,
  };

  beforeEach(() => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        models: [
          { id: "claude-sonnet-4-6", provider: "anthropic" },
          { id: "claude-haiku-4.5", provider: "anthropic" },
        ],
      }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when no subAgents and no workspace", async () => {
    const result = await transformAndCompileSubagents({
      ...baseOptions,
      workspaceBackend: mockWorkspaceBackend({ rootDir: "" }),
    } as Parameters<typeof transformAndCompileSubagents>[0]);

    expect(result).toBeNull();
  });

  it("creates built-in subagents when workspace exists even without proto subagents", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await transformAndCompileSubagents(
      baseOptions as Parameters<typeof transformAndCompileSubagents>[0],
    );

    expect(result).not.toBeNull();
    const names = result!.map((r) => r.name);
    expect(names).toContain("explore");
    expect(names).toContain("shell");
    expect(names).toContain("general-purpose");

    logSpy.mockRestore();
  });

  it("proto subagent with built-in name overrides the built-in", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await transformAndCompileSubagents({
      ...baseOptions,
      subAgents: [mockSubAgentProto({ name: "explore", instructions: "Custom explore." })],
    } as Parameters<typeof transformAndCompileSubagents>[0]);

    expect(result).not.toBeNull();
    const exploreCount = result!.filter((r) => r.name === "explore").length;
    expect(exploreCount).toBe(1);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("conflicts with built-in type"),
    );

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("a sub-agent name declared twice resolves to the later declaration", async () => {
    // deepagents refuses duplicate sub-agent names and would fail the turn;
    // the runner keeps the behaviour agents were written against.
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await transformAndCompileSubagents({
      ...baseOptions,
      subAgents: [
        mockSubAgentProto({ name: "reviewer", description: "The first reviewer." }),
        mockSubAgentProto({ name: "reviewer", description: "The later reviewer." }),
      ],
    } as Parameters<typeof transformAndCompileSubagents>[0]);

    expect(result).not.toBeNull();
    const reviewers = result!.filter((r) => r.name === "reviewer");
    expect(reviewers).toHaveLength(1);
    expect(reviewers[0].description).toBe("The later reviewer.");
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("declared more than once"));

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  describe("tool scopes", () => {
    /** Each compiled sub-agent's scope, read off the middleware its validation build was given. */
    async function compiledScopes(options: Partial<Parameters<typeof transformAndCompileSubagents>[0]>) {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const build = vi.spyOn(subagentWiringModule, "buildSubAgentMiddleware");
      const result = await transformAndCompileSubagents({
        ...baseOptions,
        ...options,
      } as Parameters<typeof transformAndCompileSubagents>[0]);
      const scopes = new Map<string, ToolScope | undefined>();
      result!.forEach((compiled, i) => {
        const toolScope = build.mock.calls[i]![0]!.toolScope as ToolScopeConfig | undefined;
        scopes.set(compiled.name, toolScope?.scope);
      });
      return { names: result!.map((r) => r.name), scopes };
    }

    it("gives every sub-agent its scope with the parent's attribution: a declared one narrowed, a built-in the parent's", async () => {
      const parentScope = ToolScope.of("Agent \"a\"", { tools: [], disallowedTools: ["Bash"] });
      const { scopes } = await compiledScopes({
        parentScope,
        subAgents: [mockSubAgentProto({ name: "reader", tools: ["Read"] })],
      });

      expect(scopes.get("explore")).toBe(parentScope);
      expect(scopes.get("general-purpose")).toBe(parentScope);
      const reader = scopes.get("reader")!;
      expect(reader.allowsClaudeTool("Read")).toBe(true);
      expect(reader.allowsClaudeTool("Write"), "the sub-agent's allow-list").toBe(false);
      expect(reader.allowsClaudeTool("Bash"), "the parent's deny-list").toBe(false);
    });

    it("compiles only the types the main agent's Agent(type, …) names, built-ins included, case-insensitively", async () => {
      const parentScope = ToolScope.of("Agent \"a\"", { tools: ["Read", "Agent(Explore, reviewer)"], disallowedTools: [] });
      const { names } = await compiledScopes({
        parentScope,
        subAgents: [mockSubAgentProto({ name: "reviewer" }), mockSubAgentProto({ name: "writer" })],
      });

      expect(names.sort()).toEqual(["explore", "reviewer"]);
    });

    it("compiles no sub-agent when the main agent's lists exclude Agent", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const parentScope = ToolScope.of("Agent \"a\"", { tools: [], disallowedTools: ["Agent"] });
      const result = await transformAndCompileSubagents({
        ...baseOptions,
        parentScope,
        subAgents: [mockSubAgentProto({ name: "reviewer" })],
      } as Parameters<typeof transformAndCompileSubagents>[0]);

      expect(result).toBeNull();
    });
  });

  it("gracefully handles transform failures for individual subagents", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await transformAndCompileSubagents({
      ...baseOptions,
      subAgents: [
        mockSubAgentProto({ name: "good-agent", modelOverride: "claude-haiku-4.5" }),
        mockSubAgentProto({ name: "bad-agent", modelOverride: "nonexistent-xyz" }),
      ],
    } as Parameters<typeof transformAndCompileSubagents>[0]);

    expect(result).not.toBeNull();
    const names = result!.map((r) => r.name);
    expect(names).toContain("good-agent");
    expect(names).not.toContain("bad-agent");

    errorSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

// =========================================================================
// Tests: resolveSubagentSkillPrompt
// =========================================================================

describe("resolveSubagentSkillPrompt", () => {
  const asSubAgent = (proto: unknown): import("@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb").SubAgent =>
    proto as import("@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb").SubAgent;

  it("returns empty string for a sub-agent the runtime mounted no skills for", () => {
    const proto = mockSubAgentProto({ name: "researcher", skillRefs: [] });
    expect(resolveSubagentSkillPrompt(asSubAgent(proto), new Map())).toBe("");
  });

  it("renders the skills section from the sub-agent's own mounted skills, keyed by its name", () => {
    const proto = mockSubAgentProto({ name: "researcher", skillRefs: [{ slug: "org/my-skill" }] });
    const skills = new Map([
      ["researcher", [{ name: "my-skill", description: "A test skill", path: ".stigmer/skills/my-skill/SKILL.md" }]],
      ["other", [{ name: "not-mine", description: "Another agent's", path: ".stigmer/skills/not-mine/SKILL.md" }]],
    ]);

    const result = resolveSubagentSkillPrompt(asSubAgent(proto), skills);

    expect(result).toContain("## Skills");
    expect(result).toContain("### my-skill");
    expect(result).toContain("**Location**: `.stigmer/skills/my-skill/`");
    expect(result).not.toContain("not-mine");
  });
});

// =========================================================================
// Tests: Edge cases and integration
// =========================================================================

describe("subagent-transformer edge cases", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        models: [
          { id: "claude-sonnet-4-6", provider: "anthropic" },
          { id: "claude-haiku-4.5", provider: "anthropic" },
        ],
      }),
    } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("transformSingleSubagent with empty name still transforms", async () => {
    const proto = mockSubAgentProto({ name: "", description: "" });
    const result = await transformSingleSubagent(proto, {
      parentScope: UNRESTRICTED,
      parentThinks: true,
      thinkingMode: NOT_THINKING,
      parentModelName: "claude-sonnet-4-6",
      webFetchPosture: "strict",
    });

    expect(result).not.toBeNull();
    expect(result!.name).toBe("");
    expect(result!.description).toBe("Sub-agent: ");
  });

  it("transformAndCompileSubagents returns null when all subagents fail", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await transformAndCompileSubagents({
      subAgents: [
        mockSubAgentProto({ name: "bad1", modelOverride: "invalid1" }),
        mockSubAgentProto({ name: "bad2", modelOverride: "invalid2" }),
      ],
      parentMcpTools: [],
      parentScope: UNRESTRICTED,
      scopeBase: SCOPE_BASE,
      skills: new Map(),
      workspaceBackend: mockWorkspaceBackend({ rootDir: "" }),
      approvalGate: null,
      parentModelName: "claude-sonnet-4-6",
      parentThinks: true,
      thinkingMode: NOT_THINKING,
      webFetchPosture: "strict",
      costCap: undefined,
    } as Parameters<typeof transformAndCompileSubagents>[0]);

    expect(result).toBeNull();

    errorSpy.mockRestore();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("transformAndCompileSubagents merges built-ins with proto subagents", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await transformAndCompileSubagents({
      subAgents: [mockSubAgentProto({ name: "custom-agent" })],
      parentMcpTools: [],
      parentScope: UNRESTRICTED,
      scopeBase: SCOPE_BASE,
      skills: new Map(),
      workspaceBackend: mockWorkspaceBackend(),
      approvalGate: null,
      parentModelName: "claude-sonnet-4-6",
      parentThinks: true,
      thinkingMode: NOT_THINKING,
      webFetchPosture: "strict",
      costCap: undefined,
    } as Parameters<typeof transformAndCompileSubagents>[0]);

    expect(result).not.toBeNull();
    const names = result!.map((r) => r.name);
    expect(names).toContain("explore");
    expect(names).toContain("shell");
    expect(names).toContain("custom-agent");

    logSpy.mockRestore();
  });
});
