/**
 * What the Claude engine is started with for one invocation: one place, so
 * every option the harness depends on is read here and nowhere else.
 *
 * Isolation, each a measured fact of SDK 0.3.310 (`__tests__/hermetic/
 * isolation.test.ts` pins the result):
 *
 *  - `settingSources: []`: the engine reads none of the workspace's own
 *    configuration, so a repository's hooks, permissions, `CLAUDE.md`,
 *    `.mcp.json`, skills, agents and commands never load. Nothing is set
 *    aside in the workspace, because nothing there is read.
 *  - `strictMcpConfig`: only the servers handed over here exist.
 *  - `skills: []`, and no `Skill` tool: the engine's bundled skills stay out
 *    of every request. `enabledPlugins` turns its built-in plugins off.
 *  - `attribution` empty: the engine adds no co-author lines of its own.
 *  - `verbatimPrompts`: the person's text reaches the model as written, with
 *    no slash-command or `@path` dispatch, as it does on every engine.
 *
 * The tools are an explicit set ({@link offeredBuiltins}): the file tools,
 * `Bash` (served by the host, `host-shell.ts`, through `toolAliases`), the
 * to-do list and `ToolSearch`, behind which the engine defers every MCP
 * tool and some of its own built-ins ({@link engineTools}). Never a tool that starts a process as the engine's child
 * (`PowerShell`, `Monitor`, `LSP`), fetches from the engine's own process
 * (`WebFetch`, `WebSearch`), or reaches past the turn (sessions, schedules,
 * teams, plan mode, questions to the person). Plan mode offers the read
 * tools alone. The agent's tool lists narrow the set (`shared/tool-lists.ts`).
 *
 * The gate is both mechanisms over one decision (`gate.ts`):
 * `permissions.ask: ["*"]` brings every call to `canUseTool`, which the
 * `PreToolUse` callback cannot skip.
 *
 * The system prompt is the engine's preset with this turn's append, rendered
 * fresh every request (`snapshot: false`): the append changes between turns,
 * and a recorded prompt would keep the first turn's (`prompt.ts`).
 */

import type { McpServerConfig, Options, SDKUserMessage, SessionStore, ThinkingConfig } from "@anthropic-ai/claude-agent-sdk";
import type { ClaudeTool } from "@stigmer/tool-vocabulary";
import { ThinkingMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import type { ToolScope } from "../../shared/tool-lists.js";
import type { EffectiveThinkingMode } from "../../shared/thinking-mode.js";
import { HOST_SHELL_TOOL } from "./host-shell.js";

/**
 * The engine's built-ins this harness may offer, in the order the engine
 * lists them, each with the Claude tool a list names it by, and whether the
 * engine defers it behind its tool search (measured on SDK 0.3.310: the
 * first request lists these by name only, `__tests__/hermetic/isolation.test.ts`).
 */
const OFFERABLE: readonly { readonly name: string; readonly listedAs: ClaudeTool | null; readonly writes: boolean; readonly deferred: boolean }[] = [
  { name: "Read", listedAs: "Read", writes: false, deferred: false },
  { name: "Write", listedAs: "Write", writes: true, deferred: false },
  { name: "Edit", listedAs: "Edit", writes: true, deferred: false },
  { name: "NotebookEdit", listedAs: "NotebookEdit", writes: true, deferred: true },
  { name: "Glob", listedAs: "Glob", writes: false, deferred: false },
  { name: "Grep", listedAs: "Grep", writes: false, deferred: false },
  { name: HOST_SHELL_TOOL.engineName, listedAs: "Bash", writes: true, deferred: false },
  { name: "TodoWrite", listedAs: "TodoWrite", writes: false, deferred: true },
];

/** The engine's tool search: offered whenever a tool the engine defers is, since a deferred tool is reachable only through it. */
export const TOOL_SEARCH = "ToolSearch";

/**
 * The engine's tools for a turn: the built-ins offered, and its tool search
 * when any of them, or any MCP tool, is one the engine defers. The one list
 * both the engine (`tools`) and the gate's closed world read, so a tool the
 * engine is given is never one the gate calls unoffered.
 */
export function engineTools(builtins: readonly string[], anyMcpTool: boolean): string[] {
  const deferred = anyMcpTool || OFFERABLE.some((tool) => tool.deferred && builtins.includes(tool.name));
  return deferred ? [...builtins, TOOL_SEARCH] : [...builtins];
}

/** The tool the engine adds of its own for a turn with an answer schema (`outputFormat`), which the model answers through (SDK 0.3.310). */
export const STRUCTURED_OUTPUT_TOOL = "StructuredOutput";

/** The tools the engine adds to a turn's own from its options, which the gate's closed world must know too. */
export function engineAddedTools(structuredOutput: boolean): string[] {
  return structuredOutput ? [STRUCTURED_OUTPUT_TOOL] : [];
}

/** The engine's built-in names, each mapped to the Claude tool it is (for a tool list's resolution). */
export const CLAUDE_ENGINE_TOOL_COVERS: ReadonlyMap<string, readonly ClaudeTool[]> = new Map(
  OFFERABLE.flatMap((tool) => (tool.listedAs === null ? [] : [[tool.name, [tool.listedAs]] as const])),
);

/** The built-ins a turn offers: in scope, and read-only in plan mode (the header). */
export function offeredBuiltins(scope: ToolScope, planMode: boolean): string[] {
  return OFFERABLE.filter((tool) => (!planMode || !tool.writes) && (tool.listedAs === null || scope.allowsClaudeTool(tool.listedAs))).map((tool) => tool.name);
}

/** What one invocation's options are built from. */
export interface EngineOptionsInputs {
  readonly cwd: string;
  readonly additionalDirectories: readonly string[];
  readonly env: Record<string, string>;
  /** The built-ins offered ({@link offeredBuiltins}). */
  readonly builtins: readonly string[];
  /** Every in-process server: the host's shell, when offered, and the bridged ones, by name. */
  readonly mcpServers: Readonly<Record<string, McpServerConfig>>;
  /** Whether any MCP tool is offered, which the engine defers behind its tool search. */
  readonly anyMcpTool: boolean;
  readonly systemAppend: string;
  readonly model: string;
  readonly thinkingMode: EffectiveThinkingMode;
  readonly hooks: NonNullable<Options["hooks"]>;
  readonly canUseTool: NonNullable<Options["canUseTool"]>;
  readonly sessionStore: SessionStore;
  /** The session to start (a first turn) or resume. */
  readonly session: { readonly start: string } | { readonly resume: string };
  readonly abortController: AbortController;
  readonly structuredOutputSchema: Record<string, unknown> | undefined;
  readonly stderr: (data: string) => void;
}

/** The engine's options for one invocation (the header). */
export function engineOptions(inputs: EngineOptionsInputs): Options {
  const tools = engineTools(inputs.builtins, inputs.anyMcpTool);
  const shell = tools.includes(HOST_SHELL_TOOL.engineName);
  return {
    cwd: inputs.cwd,
    ...(inputs.additionalDirectories.length > 0 ? { additionalDirectories: [...inputs.additionalDirectories] } : {}),
    env: inputs.env,
    settingSources: [],
    strictMcpConfig: true,
    permissionMode: "default",
    tools,
    ...(shell ? { toolAliases: { [HOST_SHELL_TOOL.engineName]: HOST_SHELL_TOOL.aliasedName } } : {}),
    mcpServers: { ...inputs.mcpServers },
    skills: [],
    settings: {
      permissions: { ask: ["*"] },
      attribution: { commit: "", pr: "" },
      enabledPlugins: Object.fromEntries(BUILT_IN_PLUGINS.map((plugin) => [plugin, false])),
    },
    includePartialMessages: true,
    forwardSubagentText: true,
    verbatimPrompts: true,
    systemPrompt: { type: "preset", preset: "claude_code", append: inputs.systemAppend, snapshot: false },
    model: inputs.model,
    thinking: thinkingOf(inputs.thinkingMode),
    hooks: inputs.hooks,
    canUseTool: inputs.canUseTool,
    sessionStore: inputs.sessionStore,
    sessionStoreFlush: "batched",
    ...("start" in inputs.session ? { sessionId: inputs.session.start } : { resume: inputs.session.resume }),
    abortController: inputs.abortController,
    ...(inputs.structuredOutputSchema !== undefined ? { outputFormat: { type: "json_schema", schema: inputs.structuredOutputSchema } } : {}),
    stderr: inputs.stderr,
  };
}

/** The engine's built-in plugins, each turned off (the header). The ids the engine reports in its init. */
export const BUILT_IN_PLUGINS: readonly string[] = ["cc-plugin-agents-md@builtin", "cc-plugin-plugin-authoring@builtin"];

/** The turn's thinking mode in the engine's form: the model decides how much when it thinks at all. */
function thinkingOf(mode: EffectiveThinkingMode): ThinkingConfig {
  return mode === ThinkingMode.ENABLED ? { type: "adaptive" } : { type: "disabled" };
}

/** One message of the prompt stream: the person's text (and images first, as content blocks) under an id. */
export function userMessageOf(content: SDKUserMessage["message"]["content"], uuid: string): SDKUserMessage {
  return { type: "user", message: { role: "user", content }, parent_tool_use_id: null, uuid: uuid as SDKUserMessage["uuid"] };
}
