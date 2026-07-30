import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { StructuredTool } from "@langchain/core/tools";
import type { McpServerUsage } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";

import {
  BUILTIN_SUBAGENT_TYPES,
  createBuiltinSubagents,
  transformSingleSubagent,
  filterMcpToolsForSubagent,
  collectAllSkillRefs,
  resolveSubagentSkillPrompt,
  compileSubagents,
  transformAndCompileSubagents,
  type TransformedSubagent,
} from "../subagent-transformer.js";
import { mockWorkspaceBackend } from "../../../__test-utils__/mock-workspace.js";

// =========================================================================
// Test helpers
// =========================================================================

function mockTool(name: string): StructuredTool {
  return { name, description: `Mock tool: ${name}` } as unknown as StructuredTool;
}

function mockSubAgentProto(overrides: Partial<{
  name: string;
  description: string;
  instructions: string;
  mcpAccess: { mcpServer: string; enabledTools: string[] }[];
  skillRefs: { slug: string }[];
  modelOverride: string;
}> = {}) {
  return {
    name: overrides.name ?? "test-agent",
    description: overrides.description ?? "A test sub-agent",
    instructions: overrides.instructions ?? "You are a test agent.",
    mcpAccess: overrides.mcpAccess ?? [],
    skillRefs: overrides.skillRefs ?? [],
    modelOverride: overrides.modelOverride ?? "",
  } as unknown as import("@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb").SubAgent;
}

function mockMcpUsage(slug: string): McpServerUsage {
  return {
    mcpServerRef: { slug },
    enabledTools: [],
  } as unknown as McpServerUsage;
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
    const result = createBuiltinSubagents(false);
    expect(result).toEqual([]);
  });

  it("creates explore, shell, and general-purpose subagents when workspace exists", () => {
    const result = createBuiltinSubagents(true);
    expect(result).toHaveLength(3);

    const names = result.map((r) => r.name);
    expect(names).toContain("explore");
    expect(names).toContain("shell");
    expect(names).toContain("general-purpose");
  });

  it("explore has read-only prompt with strict boundaries", () => {
    const result = createBuiltinSubagents(true);
    const explore = result.find((r) => r.name === "explore")!;

    expect(explore.systemPrompt).toContain("exploration specialist");
    expect(explore.systemPrompt).toContain("Do NOT write files");
    expect(explore.systemPrompt).toContain("Do NOT execute shell commands");
    expect(explore.systemPrompt).toContain("## Response rules");
  });

  it("shell has execution-focused prompt", () => {
    const result = createBuiltinSubagents(true);
    const shell = result.find((r) => r.name === "shell")!;

    expect(shell.systemPrompt).toContain("command execution specialist");
    expect(shell.systemPrompt).toContain("## Response rules");
  });

  it("all built-in subagents have response rules appended", () => {
    const result = createBuiltinSubagents(true);
    for (const sa of result) {
      expect(sa.systemPrompt).toContain("NEVER reprint, echo, list");
      expect(sa.systemPrompt).toContain("parent agent has direct access");
    }
  });

  it("built-in subagents have descriptions", () => {
    const result = createBuiltinSubagents(true);
    for (const sa of result) {
      expect(sa.description.length).toBeGreaterThan(10);
    }
  });

  it("built-in subagents have empty tool arrays (use FilesystemBackend built-ins)", () => {
    const result = createBuiltinSubagents(true);
    for (const sa of result) {
      expect(sa.tools).toEqual([]);
    }
  });

  it("gives web_fetch to general-purpose only, when a guard posture is supplied", () => {
    const result = createBuiltinSubagents(true, [], "strict");
    for (const sa of result) {
      const hasWebFetch = sa.tools.some((t) => t.name === "web_fetch");
      expect(hasWebFetch).toBe(sa.name === "general-purpose");
    }
  });

  it("built-in subagents have no model override", () => {
    const result = createBuiltinSubagents(true);
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
    parentMcpTools: [] as StructuredTool[],
    parentMcpServerToolMap: new Map<string, StructuredTool[]>(),
    parentMcpUsages: [] as McpServerUsage[],
    parentHasNativeThinking: true,
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

  it("does not inject think tool when parent has native thinking", async () => {
    const proto = mockSubAgentProto();
    const result = await transformSingleSubagent(proto, {
      ...baseOpts,
      parentHasNativeThinking: true,
    });

    const hasThinkTool = result!.tools.some(
      (t) => t.name === "think" || (t as { name?: string }).name === "think",
    );
    expect(hasThinkTool).toBe(false);
  });

  it("always injects web_fetch, regardless of thinking support", async () => {
    for (const parentHasNativeThinking of [true, false]) {
      const result = await transformSingleSubagent(mockSubAgentProto(), {
        ...baseOpts,
        parentHasNativeThinking,
      });
      const hasWebFetch = result!.tools.some((t) => t.name === "web_fetch");
      expect(hasWebFetch).toBe(true);
    }
  });

  it("injects think tool when parent lacks native thinking", async () => {
    const proto = mockSubAgentProto();
    const result = await transformSingleSubagent(proto, {
      ...baseOpts,
      parentHasNativeThinking: false,
    });

    expect(result!.tools.length).toBeGreaterThan(0);
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

  it("handles empty instructions gracefully", async () => {
    const proto = mockSubAgentProto({ instructions: "" });
    const result = await transformSingleSubagent(proto, baseOpts);

    expect(result).not.toBeNull();
    expect(result!.systemPrompt).toContain("## Response rules");
  });
});

// =========================================================================
// Tests: filterMcpToolsForSubagent
// =========================================================================

describe("filterMcpToolsForSubagent", () => {
  it("returns empty when no mcpAccess", () => {
    const result = filterMcpToolsForSubagent(
      [],
      new Map([["github", [mockTool("search_code")]]]),
      [mockMcpUsage("github")],
    );
    expect(result).toEqual([]);
  });

  it("filters tools with valid slug", () => {
    const serverTools = [mockTool("search_code"), mockTool("get_file"), mockTool("create_pr")];
    const result = filterMcpToolsForSubagent(
      [{ mcpServer: "github", enabledTools: ["search_code", "get_file"] }],
      new Map([["github", serverTools]]),
      [mockMcpUsage("github")],
    );

    expect(result).toHaveLength(2);
    expect(result.map((t) => t.name)).toEqual(["search_code", "get_file"]);
  });

  it("inherits all tools when enabledTools is empty", () => {
    const serverTools = [mockTool("a"), mockTool("b"), mockTool("c")];
    const result = filterMcpToolsForSubagent(
      [{ mcpServer: "github", enabledTools: [] }],
      new Map([["github", serverTools]]),
      [mockMcpUsage("github")],
    );

    expect(result).toHaveLength(3);
  });

  it("skips unknown MCP server slug", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = filterMcpToolsForSubagent(
      [{ mcpServer: "unknown-server", enabledTools: [] }],
      new Map([["github", [mockTool("x")]]]),
      [mockMcpUsage("github")],
    );

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("unknown MCP server 'unknown-server'"),
    );
    warnSpy.mockRestore();
  });

  it("skips empty mcpServer slug", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = filterMcpToolsForSubagent(
      [{ mcpServer: "", enabledTools: [] }],
      new Map(),
      [],
    );

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("empty mcp_server slug"),
    );
    warnSpy.mockRestore();
  });

  it("warns on tools not in parent set", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    filterMcpToolsForSubagent(
      [{ mcpServer: "github", enabledTools: ["nonexistent_tool"] }],
      new Map([["github", [mockTool("search_code")]]]),
      [mockMcpUsage("github")],
    );

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("not in parent's enabled tools"),
    );
    warnSpy.mockRestore();
  });

  it("handles multiple MCP access grants", () => {
    const result = filterMcpToolsForSubagent(
      [
        { mcpServer: "github", enabledTools: ["search_code"] },
        { mcpServer: "linear", enabledTools: [] },
      ],
      new Map([
        ["github", [mockTool("search_code"), mockTool("create_pr")]],
        ["linear", [mockTool("create_issue"), mockTool("list_issues")]],
      ]),
      [mockMcpUsage("github"), mockMcpUsage("linear")],
    );

    expect(result).toHaveLength(3);
    const names = result.map((t) => t.name);
    expect(names).toContain("search_code");
    expect(names).toContain("create_issue");
    expect(names).toContain("list_issues");
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
      { name: "good", description: "Good", systemPrompt: "ok", tools: [] },
      { name: "also-good", description: "Also good", systemPrompt: "ok", tools: [] },
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
// Tests: transformAndCompileSubagents (orchestrator)
// =========================================================================

describe("transformAndCompileSubagents", () => {
  const baseOptions = {
    subAgents: [] as unknown[],
    parentMcpTools: [] as StructuredTool[],
    parentMcpServerToolMap: new Map<string, StructuredTool[]>(),
    parentMcpUsages: [] as McpServerUsage[],
    skillClient: {} as unknown,
    workspaceBackend: mockWorkspaceBackend(),
    approvalGate: null,
    parentModelName: "claude-sonnet-4-6",
    parentHasNativeThinking: true,
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
// Tests: collectAllSkillRefs
// =========================================================================

describe("collectAllSkillRefs", () => {
  it("returns empty for subagents without skills", () => {
    const result = collectAllSkillRefs([
      mockSubAgentProto({ skillRefs: [] }),
      mockSubAgentProto({ skillRefs: [] }),
    ] as unknown as import("@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb").SubAgent[]);

    expect(result).toEqual([]);
  });

  it("collects unique refs from multiple subagents", () => {
    const result = collectAllSkillRefs([
      mockSubAgentProto({ skillRefs: [{ slug: "org/skill-a" }] }),
      mockSubAgentProto({ skillRefs: [{ slug: "org/skill-b" }] }),
    ] as unknown as import("@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb").SubAgent[]);

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.slug)).toEqual(["org/skill-a", "org/skill-b"]);
  });

  it("deduplicates refs by slug", () => {
    const result = collectAllSkillRefs([
      mockSubAgentProto({ skillRefs: [{ slug: "org/same-skill" }] }),
      mockSubAgentProto({ skillRefs: [{ slug: "org/same-skill" }] }),
    ] as unknown as import("@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb").SubAgent[]);

    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe("org/same-skill");
  });

  it("skips refs without slugs", () => {
    const result = collectAllSkillRefs([
      mockSubAgentProto({ skillRefs: [{ slug: "" }, { slug: "org/valid" }] }),
    ] as unknown as import("@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb").SubAgent[]);

    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe("org/valid");
  });
});

// =========================================================================
// Tests: resolveSubagentSkillPrompt
// =========================================================================

describe("resolveSubagentSkillPrompt", () => {
  it("returns empty string for subagent without skill refs", () => {
    const proto = mockSubAgentProto({ skillRefs: [] });
    const result = resolveSubagentSkillPrompt(
      proto as unknown as import("@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb").SubAgent,
      new Map(),
    );
    expect(result).toBe("");
  });

  it("returns empty string when no skills match", () => {
    const proto = mockSubAgentProto({ skillRefs: [{ slug: "org/missing" }] });
    const result = resolveSubagentSkillPrompt(
      proto as unknown as import("@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb").SubAgent,
      new Map(),
    );
    expect(result).toBe("");
  });

  it("generates prompt section for matched skills", () => {
    const proto = mockSubAgentProto({ skillRefs: [{ slug: "org/my-skill" }] });
    const skillsBySlug = new Map([
      ["org/my-skill", {
        skill: {
          metadata: { id: "sk-1", name: "my-skill", slug: "org/my-skill" },
          spec: { name: "my-skill", description: "A test skill", skillMd: "# Skill\nDo things." },
        },
        path: ".stigmer/skills/my-skill",
      }],
    ]);

    const result = resolveSubagentSkillPrompt(
      proto as unknown as import("@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb").SubAgent,
      skillsBySlug,
    );

    expect(result.length).toBeGreaterThan(0);
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
      parentMcpTools: [],
      parentMcpServerToolMap: new Map(),
      parentMcpUsages: [],
      parentHasNativeThinking: true,
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
      parentMcpServerToolMap: new Map(),
      parentMcpUsages: [],
      skillClient: {} as unknown,
      workspaceBackend: mockWorkspaceBackend({ rootDir: "" }),
      approvalGate: null,
      parentModelName: "claude-sonnet-4-6",
      parentHasNativeThinking: true,
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
      parentMcpServerToolMap: new Map(),
      parentMcpUsages: [],
      skillClient: {} as unknown,
      workspaceBackend: mockWorkspaceBackend(),
      approvalGate: null,
      parentModelName: "claude-sonnet-4-6",
      parentHasNativeThinking: true,
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

  it("MCP tools from multiple servers are combined for a subagent", () => {
    const result = filterMcpToolsForSubagent(
      [
        { mcpServer: "github", enabledTools: [] },
        { mcpServer: "slack", enabledTools: ["send_message"] },
      ],
      new Map([
        ["github", [mockTool("search_code"), mockTool("create_pr")]],
        ["slack", [mockTool("send_message"), mockTool("list_channels")]],
      ]),
      [mockMcpUsage("github"), mockMcpUsage("slack")],
    );

    expect(result).toHaveLength(3);
    const names = result.map((t) => t.name);
    expect(names).toContain("search_code");
    expect(names).toContain("create_pr");
    expect(names).toContain("send_message");
    expect(names).not.toContain("list_channels");
  });

  it("filterMcpToolsForSubagent skips server with no tools after intersection", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = filterMcpToolsForSubagent(
      [{ mcpServer: "github", enabledTools: ["nonexistent_tool"] }],
      new Map([["github", [mockTool("search_code")]]]),
      [mockMcpUsage("github")],
    );

    expect(result).toEqual([]);
    warnSpy.mockRestore();
  });
});
