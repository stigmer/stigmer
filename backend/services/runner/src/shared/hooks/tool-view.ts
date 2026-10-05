/**
 * Claude Code's view of a native tool call: the `tool_name`, `tool_input`
 * and `mcp_server` a Claude Code hook reads, and the way back for the input
 * a hook rewrites (`updatedInput`).
 *
 * One rule shapes every row: a native argument keeps its value, a field is
 * renamed only where Claude's name differs, a path becomes real and
 * absolute (Claude promises hooks an absolute `file_path`; the native
 * engine speaks paths rooted at the workspace, `middleware/
 * path-normalization.ts`), and an argument Claude does not have rides along
 * unchanged. The rows:
 *
 *   execute     -> Bash        read_file  -> Read       write_file -> Write
 *   edit_file   -> Edit        glob       -> Glob       grep       -> Grep
 *   ls {path}   -> Glob {pattern: "*", path}
 *   task {description, subagent_type}
 *               -> Agent {prompt: description, description, subagent_type}
 *   write_todos -> TodoWrite   web_fetch  -> WebFetch
 *
 * `delete` is never bound (`deepagents-profiles.ts`), so it has no row.
 *
 * An MCP tool is `mcp__<server>__<tool>`, its server an organisation's
 * resource (`mcp_server.source: "managed"`); a server a plugin brought with
 * it is named as Claude Code names a plugin's own server,
 * `mcp__plugin_<plugin>_<server>__<tool>` with `source: "plugin"`, so a
 * plugin's matchers find its tools unchanged. Stigmer's own tools (`think`,
 * and the channel, conversation and memory attachments) have no view and
 * never reach a hook: no plugin can name them, as no tool list can.
 *
 * The inverse of each row restores the native call, so view-then-inverse is
 * the identity on what the engine binds (pinned by the module's test).
 */

import { join } from "node:path";

/** A call as a Claude Code hook sees it. */
export interface ToolView {
  readonly toolName: string;
  readonly toolInput: Record<string, unknown>;
  /** Present for an MCP tool: Claude Code's `mcp_server` stdin field. */
  readonly mcpServer?: { readonly name: string; readonly source: "managed" | "plugin" };
}

/** How Claude Code names a plugin's own server: the plugin's name and the server's key in it. */
export interface PluginServerName {
  readonly plugin: string;
  readonly server: string;
}

/** What the views read from the turn. */
export interface NativeViewContext {
  /** The real directory the workspace's virtual `/` stands for. */
  readonly workspaceRoot: string;
  /** A real absolute path back to the engine's virtual one; `undefined` leaves it as written. */
  readonly toVirtualPath: (realPath: string) => string | undefined;
  /** Each bound MCP tool's server slug, by the tool's bound name. */
  readonly toolServerMap: ReadonlyMap<string, string>;
  /** The servers a plugin brought, by slug, with the names Claude Code gives them. */
  readonly pluginServers: ReadonlyMap<string, PluginServerName>;
  /** The platform's own servers, which no hook sees. */
  readonly platformServerSlugs: ReadonlySet<string>;
}

type Args = Record<string, unknown>;

interface PathMapping {
  readonly real: (value: unknown) => unknown;
  readonly virtual: (value: unknown) => unknown;
}

interface BuiltinRow {
  readonly claude: string;
  readonly toClaude: (args: Args, paths: PathMapping) => Args;
  readonly toNative: (input: Args, paths: PathMapping) => Args;
}

/** A row whose only difference from Claude's tool is a path argument. */
function pathRow(claude: string, pathArg: string | undefined): BuiltinRow {
  if (pathArg === undefined) {
    return { claude, toClaude: (args) => ({ ...args }), toNative: (input) => ({ ...input }) };
  }
  return {
    claude,
    toClaude: (args, paths) => withMapped(args, pathArg, paths.real),
    toNative: (input, paths) => withMapped(input, pathArg, paths.virtual),
  };
}

function withMapped(args: Args, key: string, map: (value: unknown) => unknown): Args {
  return key in args ? { ...args, [key]: map(args[key]) } : { ...args };
}

const GLOB_EVERYTHING = "*";

/** The native tools Claude Code has a name for, by their bound names. */
const BUILTIN_ROWS: ReadonlyMap<string, BuiltinRow> = new Map<string, BuiltinRow>([
  ["execute", pathRow("Bash", undefined)],
  ["read_file", pathRow("Read", "file_path")],
  ["write_file", pathRow("Write", "file_path")],
  ["edit_file", pathRow("Edit", "file_path")],
  ["glob", pathRow("Glob", "path")],
  ["grep", pathRow("Grep", "path")],
  [
    "ls",
    {
      claude: "Glob",
      toClaude: (args, paths) => ({ pattern: GLOB_EVERYTHING, ...withMapped(args, "path", paths.real) }),
      toNative: (input, paths) => {
        const { pattern: _pattern, ...rest } = input;
        return withMapped(rest, "path", paths.virtual);
      },
    },
  ],
  [
    "task",
    {
      claude: "Agent",
      toClaude: (args) => ({ prompt: args["description"], ...args }),
      toNative: (input) => {
        const { prompt, ...rest } = input;
        return prompt === undefined ? rest : { ...rest, description: prompt };
      },
    },
  ],
  ["write_todos", pathRow("TodoWrite", undefined)],
  ["web_fetch", pathRow("WebFetch", undefined)],
]);

/** The native names a view exists for, for the module's test. */
export const NATIVE_VIEWED_TOOLS: readonly string[] = [...BUILTIN_ROWS.keys()];

/** Claude Code's views of the native engine's calls for one turn. */
export class NativeToolViews {
  private readonly paths: PathMapping;

  constructor(private readonly ctx: NativeViewContext) {
    this.paths = {
      real: (value) => {
        if (typeof value !== "string" || !value.startsWith("/")) return value;
        return value === "/" ? ctx.workspaceRoot : join(ctx.workspaceRoot, value);
      },
      // A hook's rewrite may name a path any way it likes (absolute, real,
      // relative to the workspace); the engine takes only the virtual form.
      virtual: (value) => (typeof value === "string" && value !== "" ? (ctx.toVirtualPath(value) ?? value) : value),
    };
  }

  /** The call as Claude Code shows it to a hook, or `undefined` when no hook may see it. */
  viewOf(name: string, args: Args): ToolView | undefined {
    const slug = this.ctx.toolServerMap.get(name);
    if (slug !== undefined) {
      if (this.ctx.platformServerSlugs.has(slug)) return undefined;
      const owned = this.ctx.pluginServers.get(slug);
      return owned !== undefined
        ? {
            toolName: `mcp__plugin_${owned.plugin}_${owned.server}__${name}`,
            toolInput: { ...args },
            mcpServer: { name: `plugin:${owned.plugin}:${owned.server}`, source: "plugin" },
          }
        : { toolName: `mcp__${slug}__${name}`, toolInput: { ...args }, mcpServer: { name: slug, source: "managed" } };
    }
    const row = BUILTIN_ROWS.get(name);
    return row === undefined ? undefined : { toolName: row.claude, toolInput: row.toClaude(args, this.paths) };
  }

  /** A hook's rewritten input as the native call's arguments. */
  nativeArgsOf(name: string, input: Args): Args {
    const row = this.ctx.toolServerMap.has(name) ? undefined : BUILTIN_ROWS.get(name);
    return row === undefined ? { ...input } : row.toNative(input, this.paths);
  }
}

/**
 * A call's result as Claude Code shapes `tool_response` for a PostToolUse
 * hook, where its fields can be derived from the text the engine returned:
 * `Bash` gets its output as `stdout` (deepagents merges the two streams, so
 * `stderr` is empty), a file tool its `filePath` beside the output, an MCP
 * tool a text content block; anything else the text itself.
 */
export function claudeToolResponse(view: ToolView, output: string): unknown {
  if (view.mcpServer !== undefined) return [{ type: "text", text: output }];
  switch (view.toolName) {
    case "Bash":
      return { stdout: output, stderr: "", interrupted: false, isImage: false };
    case "Read":
    case "Write":
    case "Edit":
      return { filePath: view.toolInput["file_path"], output };
    default:
      return output;
  }
}
