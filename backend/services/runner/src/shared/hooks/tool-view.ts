/**
 * How a hook sees a tool call: the call in each hook format's own terms, and
 * the way back for the input a hook rewrites. A call reaches a format's
 * hooks only under a name that format has for it; a call no format names
 * reaches no hook (Stigmer's own tools, a tool one engine has and the other
 * format never shows a hook).
 *
 * This module holds the shared shapes and the NATIVE engine's views. The
 * Cursor engine's are its adapter's (`execute-cursor/hook-views.ts`), built
 * from the hook payload Cursor sent.
 *
 * One rule shapes every native row: a native argument keeps its value, a
 * field is renamed only where the format's name differs, a path becomes real
 * and absolute (both formats promise hooks an absolute path; the native
 * engine speaks paths rooted at the workspace, `middleware/
 * path-normalization.ts`), and an argument the format does not have rides
 * along unchanged. The Claude Code rows:
 *
 *   execute     -> Bash        read_file  -> Read       write_file -> Write
 *   edit_file   -> Edit        glob       -> Glob       grep       -> Grep
 *   ls {path}   -> Glob {pattern: "*", path}
 *   task {description, subagent_type}
 *               -> Agent {prompt: description, description, subagent_type}
 *   write_todos -> TodoWrite   web_fetch  -> WebFetch
 *
 * The Cursor rows follow what Cursor's own engine sends a hook
 * (`@cursor/sdk` 1.0.31, live, 2026-10-05): a create and an edit are both
 * `Write`, a glob and a listing are both `Grep` with an empty pattern and a
 * `glob`, a command is `Shell` with its `cwd`:
 *
 *   execute     -> Shell {command, cwd}
 *   read_file   -> Read        write_file, edit_file -> Write (the edit's fields kept)
 *   grep {path} -> Grep {file_path}
 *   glob {pattern, path} -> Grep {pattern: "", glob: pattern, file_path: path}
 *   ls {path}   -> Grep {pattern: "", glob: "*", file_path: path}
 *
 *   web_fetch   -> WebFetch (a matcher on Cursor's `Fetch` takes it too: unanchored)
 *
 * `task` and `write_todos` have no Cursor row: Cursor shows a hook no
 * delegation and has no todo tool in 1.0.31. Web fetch reaches no hook on
 * Cursor's own engine either, which hides the tool from an agent whose
 * hooks would take it (`execute-cursor/hook-tool-hiding.ts`); this engine
 * binds it always, so a Cursor-format hook sees it here under the name that
 * hiding matches, and its policy holds. `delete` is never bound
 * (`deepagents-profiles.ts`), so it has no row in either format.
 *
 * An MCP tool is Claude's `mcp__<server>__<tool>`: every server a hook can
 * see is a plugin's, whose name in a turn is already the segment Claude Code
 * builds (`plugin_<plugin>_<server>`, shared/plugin-servers.ts), shown to
 * a hook as `plugin:<plugin>:<server>` with `source: "plugin"`, so a
 * plugin's matchers find its tools unchanged. To Cursor's hooks it is
 * `MCP:<tool>` on `preToolUse`, and the bare tool with its server's slug on
 * `beforeMCPExecution`. Stigmer's own tools (the channel, conversation and
 * memory attachments) have no view and never reach a hook: no plugin can
 * name them, as no tool list can.
 *
 * The inverse of each row restores the native call, so view-then-inverse is
 * the identity on what the engine binds (pinned by the module's test).
 */

import { isDeepStrictEqual } from "node:util";
import { join } from "node:path";
import type { HookFormatName } from "./hook-set.js";

type Args = Record<string, unknown>;

/** A call as a Claude Code hook sees it. */
export interface ToolView {
  readonly toolName: string;
  readonly toolInput: Args;
  /** Further names a matcher takes the call by: the Cursor engine's `Write` is Claude's `Write` and `Edit` alike. */
  readonly aliases?: readonly string[];
  /** Present for an MCP tool: Claude Code's `mcp_server` stdin field. */
  readonly mcpServer?: { readonly name: string; readonly source: "plugin" };
}

/** A call as a Cursor hook sees it. */
export interface CursorToolView {
  /** `preToolUse`'s `tool_name`: the built-in's name, or `MCP:<tool>`. */
  readonly toolName: string;
  readonly toolInput: Args;
  /** Present for a shell call: `beforeShellExecution`'s `command`. */
  readonly command?: string;
  /** Present for an MCP call: `beforeMCPExecution`'s bare `tool_name` and `mcp_server_name`. */
  readonly mcp?: { readonly tool: string; readonly server: string };
}

/** One call as each format's hooks see it; a format with no name for the call has no view. */
export interface CallViews {
  readonly "claude-code"?: ToolView;
  readonly cursor?: CursorToolView;
}

/** The call a view is asked about: the engine's name, its arguments, and its MCP server (`""` for a built-in). */
export interface ViewedCall {
  readonly name: string;
  readonly args: Args;
  readonly serverSlug: string;
}

/** One engine's views of its calls, for the evaluator (`evaluate.ts`). */
export interface HookToolViews {
  viewsOf(call: ViewedCall): CallViews;
  /**
   * A hook's rewritten input, in its format's view, as the call's arguments
   * in the engine's own shape; a string says why the engine cannot run the
   * call as the hook rewrote it.
   */
  argsFrom(call: ViewedCall, format: HookFormatName, input: Args): Args | string;
}

/**
 * Whether a hook's rewrite hands back the input it saw: all of it for a
 * Claude Code hook, whose rewrite replaces the input; every key it names for
 * a Cursor one, whose rewrite is laid over the call's. Such a rewrite is no
 * rewrite, even where the engine could not take one back.
 */
export function rewriteEchoes(seen: Args, format: HookFormatName, input: Args): boolean {
  const before = asJson(seen);
  const after = asJson(input);
  if (format === "claude-code") return isDeepStrictEqual(after, before);
  return Object.keys(after).every((key) => isDeepStrictEqual(after[key], before[key]));
}

/** A value as JSON would carry it: an absent key and an undefined one are alike. */
function asJson(value: Args): Args {
  return JSON.parse(JSON.stringify(value)) as Args;
}

/** How Claude Code names a plugin's own server: the plugin's name and the server's key in it. */
export interface PluginServerName {
  readonly plugin: string;
  readonly server: string;
}

/** What the native views read from the turn. */
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

interface PathMapping {
  readonly real: (value: unknown) => unknown;
  readonly virtual: (value: unknown) => unknown;
}

interface Row {
  readonly name: string;
  readonly toView: (args: Args, paths: PathMapping) => Args;
  /** The native arguments back, or why a rewrite cannot be taken back. */
  readonly toNative: (input: Args, paths: PathMapping) => Args | string;
}

/** A row whose only difference from the format's tool is a path argument. */
function pathRow(name: string, pathArg: string | undefined): Row {
  if (pathArg === undefined) {
    return { name, toView: (args) => ({ ...args }), toNative: (input) => ({ ...input }) };
  }
  return {
    name,
    toView: (args, paths) => withMapped(args, pathArg, paths.real),
    toNative: (input, paths) => withMapped(input, pathArg, paths.virtual),
  };
}

/** A row that renames the native path argument `from` to the format's `to`. */
function renamedPathRow(name: string, from: string, to: string): Row {
  return {
    name,
    toView: (args, paths) => renamed(withMapped(args, from, paths.real), from, to),
    toNative: (input, paths) => withMapped(renamed(input, to, from), from, paths.virtual),
  };
}

function withMapped(args: Args, key: string, map: (value: unknown) => unknown): Args {
  return key in args ? { ...args, [key]: map(args[key]) } : { ...args };
}

function renamed(args: Args, from: string, to: string): Args {
  if (!(from in args)) return { ...args };
  const { [from]: value, ...rest } = args;
  return { ...rest, [to]: value };
}

const GLOB_EVERYTHING = "*";

/** The native tools Claude Code has a name for, by their bound names. */
const CLAUDE_ROWS: ReadonlyMap<string, Row> = new Map<string, Row>([
  ["execute", pathRow("Bash", undefined)],
  ["read_file", pathRow("Read", "file_path")],
  ["write_file", pathRow("Write", "file_path")],
  ["edit_file", pathRow("Edit", "file_path")],
  ["glob", pathRow("Glob", "path")],
  ["grep", pathRow("Grep", "path")],
  [
    "ls",
    {
      name: "Glob",
      toView: (args, paths) => ({ pattern: GLOB_EVERYTHING, ...withMapped(args, "path", paths.real) }),
      toNative: (input, paths) => {
        const { pattern: _pattern, ...rest } = input;
        return withMapped(rest, "path", paths.virtual);
      },
    },
  ],
  [
    "task",
    {
      name: "Agent",
      toView: (args) => ({ prompt: args["description"], ...args }),
      toNative: (input) => {
        const { prompt, ...rest } = input;
        return prompt === undefined ? rest : { ...rest, description: prompt };
      },
    },
  ],
  ["write_todos", pathRow("TodoWrite", undefined)],
  ["web_fetch", pathRow("WebFetch", undefined)],
]);

/** A Cursor listing: an empty search pattern over files matching a glob, from `path`. */
function cursorListingRow(globOf: (args: Args) => unknown, toNativeArgs: (glob: unknown, rest: Args) => Args | string): Row {
  return {
    name: "Grep",
    toView: (args, paths) => {
      const { pattern: _pattern, path, ...rest } = args;
      return { ...rest, pattern: "", glob: globOf(args), file_path: paths.real(path ?? "/"), output_mode: "files_with_matches" };
    },
    toNative: (input, paths) => {
      const { pattern, glob, file_path, output_mode: _mode, ...rest } = input;
      if (typeof pattern === "string" && pattern !== "") {
        return "the hook gave a file listing a search pattern, which the listing tool cannot take";
      }
      return toNativeArgs(glob, { ...rest, ...(file_path !== undefined ? { path: paths.virtual(file_path) } : {}) });
    },
  };
}

/** The fields of Cursor's Write that each of this engine's file tools does not take. */
const WRITE_FIELDS_NOT_TAKEN: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["edit_file", new Set(["content"])],
  ["write_file", new Set(["old_string", "new_string", "replace_all"])],
]);

/** The native tools Cursor's hooks have a name for, by their bound names. */
const CURSOR_ROWS: ReadonlyMap<string, Row> = new Map<string, Row>([
  ["read_file", pathRow("Read", "file_path")],
  ["write_file", pathRow("Write", "file_path")],
  ["edit_file", pathRow("Write", "file_path")],
  ["grep", renamedPathRow("Grep", "path", "file_path")],
  ["glob", cursorListingRow((args) => args["pattern"], (glob, rest) => ({ ...rest, pattern: glob }))],
  [
    "ls",
    cursorListingRow(
      () => GLOB_EVERYTHING,
      (glob, rest) => (glob === GLOB_EVERYTHING || glob === undefined ? rest : "the hook gave a directory listing a glob, which the listing tool cannot take"),
    ),
  ],
  ["web_fetch", pathRow("WebFetch", undefined)],
]);

/** The native names a view exists for, per format, for the module's test. */
export const NATIVE_VIEWED_TOOLS: Readonly<Record<HookFormatName, readonly string[]>> = {
  "claude-code": [...CLAUDE_ROWS.keys()],
  cursor: ["execute", ...CURSOR_ROWS.keys()],
};

/** The hooks' views of the native engine's calls for one turn, in both formats. */
export class NativeToolViews implements HookToolViews {
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

  /** The call as Claude Code shows it to a hook, or `undefined` when no Claude Code hook may see it. */
  viewOf(name: string, args: Args): ToolView | undefined {
    return this.viewsOf({ name, args, serverSlug: this.ctx.toolServerMap.get(name) ?? "" })["claude-code"];
  }

  viewsOf(call: ViewedCall): CallViews {
    const slug = this.ctx.toolServerMap.get(call.name);
    if (slug !== undefined) {
      if (this.ctx.platformServerSlugs.has(slug)) return {};
      const owned = this.ctx.pluginServers.get(slug);
      return {
        "claude-code": {
          toolName: `mcp__${slug}__${call.name}`,
          toolInput: { ...call.args },
          mcpServer: { name: owned === undefined ? slug : `plugin:${owned.plugin}:${owned.server}`, source: "plugin" },
        },
        cursor: { toolName: `MCP:${call.name}`, toolInput: { ...call.args }, mcp: { tool: call.name, server: slug } },
      };
    }
    const claude = CLAUDE_ROWS.get(call.name);
    return {
      ...(claude !== undefined ? { "claude-code": { toolName: claude.name, toolInput: claude.toView(call.args, this.paths) } } : {}),
      ...(this.cursorViewOf(call) ?? {}),
    };
  }

  argsFrom(call: ViewedCall, format: HookFormatName, rewrite: Args): Args | string {
    // Cursor lays a rewrite over the call's own arguments, so a Cursor-format
    // hook names only what it changes; Claude Code's replaces the input whole.
    if (this.ctx.toolServerMap.has(call.name)) return format === "cursor" ? { ...call.args, ...rewrite } : { ...rewrite };
    // Cursor's Write is both a create and an edit; this engine's are two
    // tools, and each ignores the other's fields.
    const foreign = format === "cursor" ? Object.keys(rewrite).filter((key) => WRITE_FIELDS_NOT_TAKEN.get(call.name)?.has(key)) : [];
    if (foreign.length > 0) return `the hook rewrote ${foreign.join(", ")}, which this engine's ${call.name} does not take`;
    const input = format === "cursor" ? { ...this.cursorViewOf(call)?.cursor.toolInput, ...rewrite } : rewrite;
    if (format === "cursor" && call.name === "execute") {
      const cwd = input["cwd"];
      if (cwd !== undefined && cwd !== "" && cwd !== this.ctx.workspaceRoot) {
        return "the hook moved the command to another directory, which this engine's shell cannot take";
      }
      const { cwd: _cwd, ...rest } = input;
      return rest;
    }
    const row = (format === "cursor" ? CURSOR_ROWS : CLAUDE_ROWS).get(call.name);
    return row === undefined ? { ...input } : row.toNative(input, this.paths);
  }

  private cursorViewOf(call: ViewedCall): { cursor: CursorToolView } | undefined {
    if (call.name === "execute") {
      const command = typeof call.args["command"] === "string" ? call.args["command"] : "";
      return { cursor: { toolName: "Shell", toolInput: { ...call.args, cwd: this.ctx.workspaceRoot }, command } };
    }
    const row = CURSOR_ROWS.get(call.name);
    return row === undefined ? undefined : { cursor: { toolName: row.name, toolInput: row.toView(call.args, this.paths) } };
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
