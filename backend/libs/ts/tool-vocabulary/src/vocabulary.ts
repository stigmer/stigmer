/**
 * Claude Code's tool vocabulary as Stigmer reads it: the built-in names a
 * tool list may carry, and, per engine, which of those names each engine
 * tool does the work of.
 *
 * One home for both readings of the same tables. The runner reads them
 * forwards: a list names Claude tools, the engine binds its own, and a scope
 * asks "is this engine tool covered by something in scope?". The control
 * plane reads them backwards: a recorded run carries engine names, and a
 * grader written against Claude Code (`tool_used: Bash`) must see the call
 * under the Claude name it would have had there ({@link claudeNameOf}). Kept
 * in a library both import so the two readings cannot drift.
 *
 * Pure data and pure functions: no engine import, no I/O. The resolution of
 * a list (layers, specifiers, the refusal) stays the runner's
 * (`backend/services/runner/src/shared/tool-lists.ts`).
 *
 * Trade-offs, each stated once:
 *  - A table lists engine names in a fixed order and each name's covered
 *    Claude tools in a fixed order. The reverse reading takes the first
 *    covered tool, so the order is part of the contract, pinned by tests.
 *  - `Skill` is a Claude name no engine tool covers: both engines activate a
 *    skill by reading its `SKILL.md`, which is a read. The runner gives
 *    `Skill` its own meaning (a deny hides skills); the tables never list it.
 *  - Names Claude Code has that Stigmer runs nothing for (`AskUserQuestion`,
 *    `NotebookRead`, the task tools) are not in {@link ClaudeTool}: a list
 *    entry naming one is an entry naming no tool, which the runner ignores
 *    with a log line. They still appear in {@link READ_ONLY_EVAL_TOOLS},
 *    which is the plugin-eval format's own list, quoted whole.
 */

/** Claude Code's built-in tool names a Stigmer tool list may carry. */
export type ClaudeTool =
  | "Bash"
  | "Read"
  | "Write"
  | "Edit"
  | "Glob"
  | "Grep"
  | "Agent"
  | "WebFetch"
  | "WebSearch"
  | "TodoWrite"
  | "NotebookEdit"
  | "Skill";

/** Every {@link ClaudeTool}, in declaration order. */
export const CLAUDE_TOOLS: readonly ClaudeTool[] = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "Glob",
  "Grep",
  "Agent",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "NotebookEdit",
  "Skill",
];

const CLAUDE_TOOL_SET: ReadonlySet<string> = new Set<string>(CLAUDE_TOOLS);

/** Whether a bare name (no specifier) is a {@link ClaudeTool}. */
export function isClaudeTool(name: string): name is ClaudeTool {
  return CLAUDE_TOOL_SET.has(name);
}

/** Claude Code's older spellings, still accepted there: `Task` is `Agent`. */
export const CLAUDE_TOOL_ALIASES: ReadonlyMap<string, ClaudeTool> = new Map([["Task", "Agent"]]);

/**
 * The native engine's tool names and the Claude tools each covers. `delete`
 * is listed for completeness: the runner never binds it (file review needs
 * every removal to go through a reviewable write).
 */
export const NATIVE_TOOL_COVERS: ReadonlyMap<string, readonly ClaudeTool[]> = new Map([
  ["execute", ["Bash"]],
  ["read_file", ["Read"]],
  ["write_file", ["Write"]],
  ["edit_file", ["Edit"]],
  ["delete", ["Write"]],
  ["glob", ["Glob"]],
  ["ls", ["Glob"]],
  ["grep", ["Grep"]],
  ["task", ["Agent"]],
  ["web_fetch", ["WebFetch"]],
  ["write_todos", ["TodoWrite"]],
]);

/**
 * The names the Cursor `preToolUse` hook reports, and the Claude tools each
 * covers. The hook reports every file mutation, create or edit, as `Write`,
 * so `Write` covers both.
 */
export const CURSOR_HOOK_TOOL_COVERS: ReadonlyMap<string, readonly ClaudeTool[]> = new Map([
  ["Shell", ["Bash"]],
  ["Read", ["Read"]],
  ["Write", ["Write", "Edit"]],
  ["StrReplace", ["Edit"]],
  ["Delete", ["Write"]],
  ["Glob", ["Glob"]],
  ["Grep", ["Grep"]],
  ["SemanticSearch", ["Grep"]],
  ["Task", ["Agent"]],
  ["WebFetch", ["WebFetch"]],
  ["WebSearch", ["WebSearch"]],
  ["updateTodos", ["TodoWrite"]],
  ["TodoWrite", ["TodoWrite"]],
  ["EditNotebook", ["NotebookEdit"]],
]);

/**
 * The `@cursor/sdk` `AgentOptions.tools` / `disallowedTools` vocabulary (its
 * `ToolName` literals, 1.0.31) and the Claude tools each covers. These are
 * also the names a recorded Cursor transcript carries. `mcp` is absent on
 * purpose: it is the whole MCP family, all-or-nothing, so MCP narrowing is
 * the hook's. A name with no Claude tool is an engine extra.
 */
export const CURSOR_SDK_TOOL_COVERS: ReadonlyMap<string, readonly ClaudeTool[]> = new Map([
  ["shell", ["Bash"]],
  ["read", ["Read"]],
  ["edit", ["Write", "Edit"]],
  ["delete", ["Write"]],
  ["glob", ["Glob"]],
  ["ls", ["Glob"]],
  ["grep", ["Grep"]],
  ["semSearch", ["Grep"]],
  ["task", ["Agent"]],
  ["webFetch", ["WebFetch"]],
  ["webSearch", ["WebSearch"]],
  ["updateTodos", ["TodoWrite"]],
  ["readTodos", ["TodoWrite"]],
]);

/** The SDK's built-in names with no Claude tool: hidden by an allow-list, left alone by a deny-list. */
export const CURSOR_SDK_EXTRA_TOOLS: readonly string[] = [
  "readLints",
  "askQuestion",
  "await",
  "generateImage",
  "applyAgentDiff",
];

/** The engines whose recorded tool calls {@link claudeNameOf} reads. */
export type ToolEngine = "native" | "cursor";

/** The table a recorded call of each engine is named in. */
function recordedTable(engine: ToolEngine): ReadonlyMap<string, readonly ClaudeTool[]> {
  switch (engine) {
    case "native":
      return NATIVE_TOOL_COVERS;
    case "cursor":
      // A Cursor transcript records the SDK's names, not the hook's.
      return CURSOR_SDK_TOOL_COVERS;
    /* v8 ignore start -- @preserve: the never arm; the compiler proves no engine reaches it */
    default: {
      const exhaustive: never = engine;
      throw new Error(`recordedTable: unknown engine ${String(exhaustive)}`);
    }
    /* v8 ignore stop */
  }
}

/**
 * The Claude Code name a recorded engine tool call reads as, for graders and
 * judges. An engine name reads as the first Claude tool its table entry
 * lists; a tool that covers both `Write` and `Edit` reads as `Write` when
 * its file change is an add and as `Edit` otherwise; an engine tool with no
 * Claude name keeps its own. Built-in calls only: an MCP call is named from
 * its server, which a bare tool name cannot carry.
 */
export function claudeNameOf(engine: ToolEngine, engineToolName: string, fileChange?: "add" | "modify"): string {
  const covers = recordedTable(engine).get(engineToolName);
  const first = covers?.[0];
  if (first === undefined) return engineToolName;
  if (covers?.includes("Write") === true && covers.includes("Edit")) {
    return fileChange === "add" ? "Write" : "Edit";
  }
  return first;
}

/**
 * The plugin-eval format's read-only tool set, quoted whole and in its
 * order: the read-only tools a case may list, granted without the eval's
 * `allow_tools`. A case that lists none is granted none of them. Some
 * names here are not {@link ClaudeTool}s, because Stigmer runs nothing for
 * them; a list carrying them ignores them.
 */
export const READ_ONLY_EVAL_TOOLS: readonly string[] = [
  "Read",
  "Glob",
  "Grep",
  "NotebookRead",
  "Skill",
  "AskUserQuestion",
  "Agent",
  "TodoWrite",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskUpdate",
  "TaskStop",
];
