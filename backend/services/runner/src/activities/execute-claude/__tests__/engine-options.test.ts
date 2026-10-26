/**
 * Pins what the Claude engine is started with (`engine-options.ts`): the
 * built-ins a turn offers, the isolation switches every invocation carries,
 * the turn's skills, plugins and sub-agents passed as given, and the shape
 * of a prompt-stream message.
 *
 * Why it matters: each isolation switch is what keeps a repository's own
 * configuration (hooks, permissions, `CLAUDE.md`, `.mcp.json`, skills,
 * plugins) out of the engine and every tool call in front of the gate. A
 * switch dropped here is a workspace that can reconfigure the agent, or a
 * call that runs ungated, so each is asserted by value, not by presence.
 */

import { describe, it, expect } from "vitest";
import type { CanUseTool, HookCallbackMatcher, HookEvent, McpServerConfig, SessionStore } from "@anthropic-ai/claude-agent-sdk";
import { ThinkingMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import { ToolScope } from "../../../shared/tool-lists.js";
import {
  BUILT_IN_PLUGINS,
  CLAUDE_ENGINE_TOOL_COVERS,
  STRUCTURED_OUTPUT_TOOL,
  TOOL_SEARCH,
  engineOptions,
  engineAddedTools,
  engineTools,
  offeredBuiltins,
  userMessageOf,
  type EngineOptionsInputs,
} from "../engine-options.js";
import { HOST_SHELL_TOOL } from "../host-shell.js";

const ALL_BUILTINS = ["Read", "Write", "Edit", "NotebookEdit", "Glob", "Grep", "Bash", "TodoWrite"];

const sessionStore: SessionStore = {
  append: async () => {},
  load: async () => null,
};
const canUseTool: CanUseTool = async (_toolName, input) => ({ behavior: "allow", updatedInput: input });
const hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>> = { PreToolUse: [{ hooks: [async () => ({ continue: true })] }] };
const stderr = (_data: string): void => {};

function inputs(overrides: Partial<EngineOptionsInputs> = {}): EngineOptionsInputs {
  return {
    cwd: "/work/primary",
    additionalDirectories: [],
    env: { PATH: "/bin" },
    tools: ["Read"],
    mcpServers: {},
    plugins: [],
    skills: [],
    agents: {},
    systemAppend: "the append",
    model: "claude-sonnet-4-5",
    thinkingMode: ThinkingMode.DISABLED,
    hooks,
    canUseTool,
    sessionStore,
    session: { start: "11111111-1111-5111-8111-111111111111" },
    abortController: new AbortController(),
    structuredOutputSchema: undefined,
    stderr,
    ...overrides,
  };
}

describe("offeredBuiltins", () => {
  it("offers every offerable built-in, in the engine's order, under an unrestricted scope", () => {
    expect(offeredBuiltins(ToolScope.unrestricted(), false)).toEqual(ALL_BUILTINS);
  });

  it("offers the read tools and the to-do list alone in plan mode", () => {
    expect(offeredBuiltins(ToolScope.unrestricted(), true)).toEqual(["Read", "Glob", "Grep", "TodoWrite"]);
  });

  it("narrows to an agent's allow list, the shell included by its Claude name", () => {
    const scope = ToolScope.of("agent", { tools: ["Read", "Bash"], disallowedTools: [] });
    expect(offeredBuiltins(scope, false)).toEqual(["Read", "Bash"]);
  });

  it("drops what an agent's deny list names", () => {
    const scope = ToolScope.of("agent", { tools: [], disallowedTools: ["Bash", "Write"] });
    expect(offeredBuiltins(scope, false)).toEqual(["Read", "Edit", "NotebookEdit", "Glob", "Grep", "TodoWrite"]);
  });

  it("never offers a tool that starts a process, fetches, or reaches past the turn", () => {
    const offered = offeredBuiltins(ToolScope.unrestricted(), false);
    for (const tool of ["PowerShell", "Monitor", "LSP", "WebFetch", "WebSearch", "Skill", "Agent", "Task", "ExitPlanMode", "AskUserQuestion"]) {
      expect(offered).not.toContain(tool);
    }
  });

  it("maps each engine built-in to the Claude tool a list names it by", () => {
    expect([...CLAUDE_ENGINE_TOOL_COVERS.entries()]).toEqual(ALL_BUILTINS.map((name) => [name, [name]]));
  });
});

describe("engineAddedTools", () => {
  it("names the engine's own structured-answer tool exactly when the turn has a schema", () => {
    expect(engineAddedTools(true)).toEqual([STRUCTURED_OUTPUT_TOOL]);
    expect(engineAddedTools(false)).toEqual([]);
  });
});

describe("engineTools", () => {
  it("is the built-ins alone when none is deferred and no MCP tool is offered", () => {
    expect(engineTools(["Read", "Write", "Edit", "Glob", "Grep", "Bash"], false)).toEqual(["Read", "Write", "Edit", "Glob", "Grep", "Bash"]);
    expect(engineTools([], false)).toEqual([]);
  });

  it("adds tool search when the notebook editor is offered, since the engine defers it", () => {
    expect(engineTools(["Read", "NotebookEdit"], false)).toEqual(["Read", "NotebookEdit", TOOL_SEARCH]);
  });

  it("adds tool search when the to-do list is offered, since the engine defers it", () => {
    expect(engineTools(["TodoWrite"], false)).toEqual(["TodoWrite", TOOL_SEARCH]);
  });

  it("adds tool search when only an MCP tool is offered", () => {
    expect(engineTools(["Read"], true)).toEqual(["Read", TOOL_SEARCH]);
    expect(engineTools([], true)).toEqual([TOOL_SEARCH]);
  });

  it("adds tool search once, whatever the number of deferred tools", () => {
    expect(engineTools(ALL_BUILTINS, true)).toEqual([...ALL_BUILTINS, TOOL_SEARCH]);
  });

  it("answers a new list, never the caller's", () => {
    const builtins = ["Read"];
    const tools = engineTools(builtins, false);
    expect(tools).not.toBe(builtins);
    tools.push("Extra");
    expect(builtins).toEqual(["Read"]);
  });
});

describe("engineOptions", () => {
  it("carries every isolation switch by value", () => {
    const options = engineOptions(inputs());
    expect(options.settingSources).toEqual([]);
    expect(options.strictMcpConfig).toBe(true);
    expect(options.skills).toEqual([]);
    expect(options.permissionMode).toBe("default");
    expect(options.verbatimPrompts).toBe(true);
    expect(options.settings).toEqual({
      permissions: { ask: ["*"] },
      attribution: { commit: "", pr: "" },
      enabledPlugins: { "cc-plugin-agents-md@builtin": false, "cc-plugin-plugin-authoring@builtin": false },
      disableSkillShellExecution: true,
      disableAllHooks: true,
    });
    expect(options).not.toHaveProperty("plugins");
    expect(options).not.toHaveProperty("pluginDelivery");
    expect(options).not.toHaveProperty("agents");
    expect(BUILT_IN_PLUGINS).toEqual(["cc-plugin-agents-md@builtin", "cc-plugin-plugin-authoring@builtin"]);
  });

  it("passes the turn's facts through unchanged", () => {
    const abortController = new AbortController();
    const env = { PATH: "/usr/bin", HOME: "/h" };
    const options = engineOptions(inputs({ abortController, env, model: "claude-opus-4-1" }));
    expect(options.cwd).toBe("/work/primary");
    expect(options.env).toBe(env);
    expect(options.model).toBe("claude-opus-4-1");
    expect(options.hooks).toBe(hooks);
    expect(options.canUseTool).toBe(canUseTool);
    expect(options.sessionStore).toBe(sessionStore);
    expect(options.sessionStoreFlush).toBe("batched");
    expect(options.abortController).toBe(abortController);
    expect(options.stderr).toBe(stderr);
    expect(options.includePartialMessages).toBe(true);
    expect(options.forwardSubagentText).toBe(true);
  });

  it("renders the preset system prompt with the turn's append and no snapshot", () => {
    expect(engineOptions(inputs({ systemAppend: "append me" })).systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: "append me",
      snapshot: false,
    });
  });

  it("aliases the shell to the host's tool when the session's tools hold it", () => {
    const options = engineOptions(inputs({ tools: [...ALL_BUILTINS, TOOL_SEARCH] }));
    expect(options.tools).toEqual([...ALL_BUILTINS, TOOL_SEARCH]);
    expect(options.toolAliases).toEqual({ Bash: "mcp__stigmer__bash" });
    expect(options.toolAliases).toEqual({ [HOST_SHELL_TOOL.engineName]: HOST_SHELL_TOOL.aliasedName });
  });

  it("names no alias when the session's tools hold no shell", () => {
    const options = engineOptions(inputs({ tools: ["Read", "Grep"] }));
    expect(options.tools).toEqual(["Read", "Grep"]);
    expect(options).not.toHaveProperty("toolAliases");
  });

  it("never shares or mutates the caller's tool list", () => {
    const tools = ["Read", "TodoWrite"];
    const options = engineOptions(inputs({ tools }));
    expect(options.tools).toEqual(tools);
    expect(options.tools).not.toBe(tools);
  });

  it("loads the turn's skill plugins over the initialize request, with the exact skills allowlist", () => {
    const plugins = [{ type: "local" as const, path: "/home/plugins/agent", skipMcpDiscovery: true }];
    const options = engineOptions(inputs({ plugins, skills: ["agent:review", "acme:lint"] }));
    expect(options.plugins).toEqual(plugins);
    expect(options.plugins).not.toBe(plugins);
    expect(options.pluginDelivery).toBe("initialize");
    expect(options.skills).toEqual(["agent:review", "acme:lint"]);
  });

  it("passes the sub-agents' definitions by type", () => {
    const agents = { reviewer: { description: "Reviews", prompt: "You review.", tools: ["Read"], model: "inherit" } };
    const options = engineOptions(inputs({ agents }));
    expect(options.agents).toEqual(agents);
    expect(options.agents).not.toBe(agents);
  });

  it("copies the servers rather than sharing the caller's record", () => {
    const mcpServers: Record<string, McpServerConfig> = { stigmer: { type: "http", url: "http://127.0.0.1:1/mcp" } };
    const options = engineOptions(inputs({ mcpServers }));
    expect(options.mcpServers).toEqual(mcpServers);
    expect(options.mcpServers).not.toBe(mcpServers);
  });

  it("names additional directories only when there are any", () => {
    expect(engineOptions(inputs())).not.toHaveProperty("additionalDirectories");
    const dirs = ["/work/other"];
    const options = engineOptions(inputs({ additionalDirectories: dirs }));
    expect(options.additionalDirectories).toEqual(["/work/other"]);
    expect(options.additionalDirectories).not.toBe(dirs);
  });

  it("starts a first turn's session by id and never resumes it", () => {
    const options = engineOptions(inputs({ session: { start: "sess-a" } }));
    expect(options.sessionId).toBe("sess-a");
    expect(options).not.toHaveProperty("resume");
  });

  it("resumes a later turn's session and never names a new one", () => {
    const options = engineOptions(inputs({ session: { resume: "sess-b" } }));
    expect(options.resume).toBe("sess-b");
    expect(options).not.toHaveProperty("sessionId");
  });

  it("asks for structured output only when the turn names a schema", () => {
    expect(engineOptions(inputs())).not.toHaveProperty("outputFormat");
    const schema = { type: "object", properties: { answer: { type: "string" } } };
    expect(engineOptions(inputs({ structuredOutputSchema: schema })).outputFormat).toEqual({ type: "json_schema", schema });
  });

  it("thinks adaptively when thinking is on and not at all when it is off", () => {
    expect(engineOptions(inputs({ thinkingMode: ThinkingMode.ENABLED })).thinking).toEqual({ type: "adaptive" });
    expect(engineOptions(inputs({ thinkingMode: ThinkingMode.DISABLED })).thinking).toEqual({ type: "disabled" });
  });
});

describe("userMessageOf", () => {
  it("wraps text as a main-thread user message under the given id", () => {
    expect(userMessageOf("hello", "22222222-2222-5222-8222-222222222222")).toEqual({
      type: "user",
      message: { role: "user", content: "hello" },
      parent_tool_use_id: null,
      uuid: "22222222-2222-5222-8222-222222222222",
    });
  });

  it("keeps content blocks, images first, as given", () => {
    const content = [
      { type: "image" as const, source: { type: "base64" as const, media_type: "image/png" as const, data: "AAAA" } },
      { type: "text" as const, text: "what is this?" },
    ];
    const message = userMessageOf(content, "33333333-3333-5333-8333-333333333333");
    expect(message.message.content).toBe(content);
    expect(message.uuid).toBe("33333333-3333-5333-8333-333333333333");
  });
});
