/**
 * Tool-scope middleware — the Stigmer harness's enforcement of an agent's two
 * tool lists (`tools`, `disallowed_tools`; resolved by `shared/tool-lists.ts`).
 *
 * The shape is deepagents' own `createToolExclusionMiddleware` (1.14.1): the
 * one seam that reaches every tool a graph binds, its filesystem and `task`
 * tools included, on the parent and on every sub-agent graph alike.
 *  - `wrapModelCall` removes the out-of-scope tools from `request.tools`, so
 *    the model never sees them.
 *  - `wrapToolCall` answers a call to an out-of-scope tool (a model can still
 *    name one it was never shown) with an error `ToolMessage` carrying
 *    `outOfScopeMessage`, without running the handler.
 *
 * Where it sits: after path normalization, so the `.stigmer/` confinement
 * below reads canonical virtual paths, and AHEAD of the approval gate, so a
 * listed-out call is refused before it could reach an approval card. It is
 * installed whenever the scope carries a list, independent of the gate: under
 * auto-approve-all the gate is absent and the lists still bind. The gate is
 * its second caller ({@link toolScopeRefusal}): a hook's rewrite replaces the
 * arguments this middleware judged, so the gate has the same graph's scope
 * judge them again, under the pre-armed bypass too.
 *
 * How a refusal reaches the timeline: a call that never runs its handler
 * fires no tool events, so the middleware says so itself, on the graph's
 * custom stream ({@link TOOL_REFUSED_EVENT}, through the runtime's `writer`),
 * and the Stigmer harness's translator folds it into the call's row as a failure with
 * this message — no approval card, no provenance, the row settled as the
 * refusal happens rather than at the end of the turn.
 *
 * How a tool is attributed:
 *  - An MCP tool is the one its engine name stands for in the turn's index
 *    (`mcpIndex`, `shared/mcp-tool-names.ts`): the model is offered and
 *    calls every server's tool as `mcp__<server>__<tool>`, one name per
 *    tool, so the name alone is exact, for a tool the model is shown and
 *    for a call it makes, and two servers' tools of one name are judged
 *    apart (stigmer#1860). The lists judge the server and the bare tool.
 *  - A tool of a platform server (the synthesized channel, conversation and
 *    memory attachments, `TurnMcp.platformServerSlugs`) is always in scope:
 *    no plugin can name them and an agent without them cannot answer its
 *    channel.
 *  - Every other tool is the engine's, judged by its Stigmer-harness name
 *    (`STIGMER_TOOL_COVERS`): a name the table does not carry is an engine
 *    extra (hidden only by an allow-list).
 *  - `stop_background_command` is judged as `execute`: it exists only
 *    beside the shell (`shell.ts`) and can only end a command the shell
 *    started, so it is in scope exactly when the shell is. It is not a row
 *    of the vocabulary's table, where graders would read every stop as a
 *    `Bash` call.
 *
 * `Read` excluded is the one exception to "out of scope is hidden":
 * `read_file` is how the agent reads the platform's `.stigmer/` content (its
 * skills, attached inputs, the approved plan; `platform-route.ts`) and the
 * results and history deepagents offloads from the agent's own turn
 * (`/large_tool_results/`, `/conversation_history/`). Those are the platform's
 * and the agent's own outputs, each a route to a backend outside the
 * workspace (`platform-route.ts`), so `read_file` stays bound and visible and
 * a call is refused unless {@link ToolScopeConfig.admitsRoutedRead} admits
 * its path.
 *
 * A scope that denies `Skill` (`ToolScope.hidesSkills`) refuses a `read_file`
 * of a skill's files under `.stigmer/` (`shared/skill-mount.ts`
 * `skillContentReadCheck`: mounted skills and plugin trees, matched without
 * regard to case, by the path's text and by the real path it resolves to,
 * so a link inside the platform dir pointing at a skill is refused too)
 * whether or not `Read` is in scope: hidden skills are not
 * read through the one tool that activates them. Only the read is held:
 * grep, glob and the shell can still reach a skill an earlier turn left on
 * disk. Denying `Skill` withdraws the turn's skills (none is listed or
 * mounted) and refuses their activation; it is not a file wall, and a
 * scope that must keep a file from the agent denies those tools as well.
 *
 * Pinned by `__tests__/tool-scope.test.ts` on a real deepagents graph.
 */

import { ToolMessage } from "@langchain/core/messages";
import { STIGMER_TOOL_COVERS } from "@stigmer/tool-vocabulary";
import { outOfScopeMessage, type ToolScope } from "../shared/tool-lists.js";
import { SHELL_TOOL_NAME, STOP_BACKGROUND_TOOL_NAME } from "../activities/execute-deep-agent/shell-tool.js";
import type { McpToolIndex } from "../shared/mcp-tool-names.js";
import type { StigmerMiddleware, ToolCallRequest } from "./types.js";

/**
 * The custom-stream event a refusal writes (`translator.ts` reads it). The
 * payload is the call as the model made it and the message: a refused call
 * fires no tool events, so nothing else on the stream carries them. The
 * approval gate writes it too when a hook refuses a call, with the hook's
 * provenance beside it, when an unattended turn skips a call that would
 * ask, with `unattended_skip` beside it, and when an approved call is not the
 * call its card showed, with none (the call as it would have run).
 */
export const TOOL_REFUSED_EVENT = "stigmer.tool_refused";

/** The {@link TOOL_REFUSED_EVENT} payload. */
export interface ToolRefusedPayload {
  readonly name: typeof TOOL_REFUSED_EVENT;
  readonly tool_call_id: string;
  readonly tool_name: string;
  readonly input: Record<string, unknown>;
  readonly message: string;
  /**
   * Set when the approval gate refused the call: `"hook"` when a hook did,
   * `"unattended_skip"` when no one could answer its ask. A tool list's
   * refusal carries none, nor an approved call that changed.
   */
  readonly policy_source?: "hook" | "unattended_skip";
  /** The refusing or asking plugin's slug (`""` for the agent's own hooks block or the default), beside `policy_source`. */
  readonly policy_hook?: string;
}

/** The runtime's custom-stream writer, when the graph streams with one. */
export function customStreamWriterOf<T>(runtime: unknown): ((chunk: T) => void) | undefined {
  if (runtime === null || typeof runtime !== "object" || !("writer" in runtime)) return undefined;
  const writer = (runtime as { writer: unknown }).writer;
  return typeof writer === "function" ? (chunk) => void writer(chunk) : undefined;
}

/** The engine name a tool is judged by: its own, but the stop tool's, which is the shell's (the header). */
function scopeNameOf(name: string): string {
  return name === STOP_BACKGROUND_TOOL_NAME ? SHELL_TOOL_NAME : name;
}

/** The Stigmer harness's file-read tool and the argument that names its file. */
const READ_TOOL = "read_file";
const READ_PATH_ARG = "file_path";

export interface ToolScopeConfig {
  /** The scope this graph enforces: the agent's, or a sub-agent's narrowed from it. */
  readonly scope: ToolScope;
  /** The server and bare tool each MCP engine name stands for. */
  readonly mcpIndex: McpToolIndex;
  /** The platform's own servers, outside every list. */
  readonly platformServerSlugs: ReadonlySet<string>;
  /**
   * Whether `read_file` may still read this canonical virtual path when the
   * scope excludes `Read`: the platform route and deepagents' offload roots
   * (`platform-route.ts` `admitsRoutedRead`). Injected by the harness, which
   * knows its routes as this middleware does not.
   */
  readonly admitsRoutedRead: (virtualPath: string) => Promise<boolean>;
  /**
   * Whether `read_file` of this canonical virtual path would open a skill's
   * files, asked only when the scope denies `Skill`
   * (`shared/skill-mount.ts` `skillContentReadCheck`). Injected by the
   * harness, which knows the platform dir the real path is judged in.
   */
  readonly readsSkillContent: (virtualPath: string) => Promise<boolean>;
}

function toolNameOf(tool: unknown): string | undefined {
  if (tool === null || typeof tool !== "object" || !("name" in tool)) return undefined;
  const name = (tool as { name: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

/** Whether the MCP tool `name` stands for is in scope; `undefined` for a name no server listed. */
function mcpToolInScope(config: ToolScopeConfig, name: string): boolean | undefined {
  const owner = config.mcpIndex.ownerOf(name);
  if (owner === undefined) return undefined;
  return config.platformServerSlugs.has(owner.slug) || config.scope.allowsMcpTool(owner.slug, owner.tool);
}

/** Whether a call may run, by the name the model called. */
async function callable(config: ToolScopeConfig, request: ToolCallRequest): Promise<boolean> {
  const { scope } = config;
  const { name, args } = request.toolCall;
  const mcp = mcpToolInScope(config, name);
  if (mcp !== undefined) return mcp;
  const path = args[READ_PATH_ARG];
  const read = name === READ_TOOL && typeof path === "string";
  // The read alone: grep, glob and the shell are out of this check's scope (the header says why).
  if (read && scope.hidesSkills && (await config.readsSkillContent(path))) return false;
  if (scope.allowsEngineTool(scopeNameOf(name), STIGMER_TOOL_COVERS)) return true;
  return read && (await config.admitsRoutedRead(path));
}

/**
 * The scope's answer to a call: `undefined` when it may run (always, for an
 * unrestricted scope), or the refusal, its event already written. The
 * middleware's own check, and the approval gate's on a hook's rewritten
 * arguments, which this graph's scope judges again as the Claude engine's
 * gate does (`execute-claude/gate.ts`).
 */
export async function toolScopeRefusal(config: ToolScopeConfig, request: ToolCallRequest): Promise<ToolMessage | undefined> {
  if (!config.scope.restricted || (await callable(config, request))) return undefined;
  const { name, id, args } = request.toolCall;
  const message = outOfScopeMessage(name, config.scope);
  customStreamWriterOf<ToolRefusedPayload>(request.runtime)?.({ name: TOOL_REFUSED_EVENT, tool_call_id: id ?? "", tool_name: name, input: args, message });
  return new ToolMessage({ content: message, tool_call_id: id ?? "", name, status: "error" });
}

/** The middleware; see the module header. Install only when `scope.restricted`. */
export function createToolScopeMiddleware(config: ToolScopeConfig): StigmerMiddleware {
  const { scope } = config;

  /** Whether a tool the model is shown stays visible: `read_file` always does (the header's exception). */
  const visible = (tool: unknown): boolean => {
    const name = toolNameOf(tool);
    if (name === undefined) return true;
    const mcp = mcpToolInScope(config, name);
    if (mcp !== undefined) return mcp;
    if (name === READ_TOOL) return true;
    return scope.allowsEngineTool(scopeNameOf(name), STIGMER_TOOL_COVERS);
  };

  return {
    name: "ToolScopeMiddleware",

    wrapModelCall(request, handler) {
      if (!request.tools) return handler(request);
      return handler({ ...request, tools: request.tools.filter(visible) });
    },

    async wrapToolCall(request, handler) {
      return (await toolScopeRefusal(config, request)) ?? handler(request);
    },
  };
}
