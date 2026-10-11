/**
 * How an agent's hooks see a call on the Cursor engine: the call as
 * Cursor's own hook payload carries it (`preToolUse` for a built-in,
 * `beforeMCPExecution` for an MCP tool, which names the server), in both
 * hook formats (`shared/hooks/tool-view.ts` has the shared shapes and the
 * native engine's views).
 *
 * Cursor's view is the payload as Cursor sent it, for every tool Cursor
 * shows a hook. Claude Code's view, as `@cursor/sdk` 1.0.31 sends each tool
 * (live probe, 2026-10-05):
 *
 *   Shell {command, cwd, timeout}  -> Bash {command, timeout}
 *   Read {file_path}               -> Read
 *   Write {file_path, content}     -> Write, also matched as Edit (a create
 *                                     and an edit are both Write here, the
 *                                     SDK's own reading of a Claude matcher)
 *   Delete {file_path}             -> Write {file_path, content: ""}, so a
 *                                     hook that guards a file's writes guards
 *                                     its deletion too
 *   Grep {pattern: "", glob, file_path} -> Glob {pattern: glob, path}
 *   Grep {pattern, file_path, …}   -> Grep {pattern, path, …}
 *   an MCP tool                    -> mcp__<server>__<tool>, or a plugin's
 *                                     own server as Claude Code names it
 *
 * Any other tool Cursor shows a hook (`WriteShellStdin`, whose payload
 * carries no text; `ReadLints`; the MCP resource tools) has no Claude Code
 * view and reaches no Claude Code hook. A tool Cursor shows no hook at all
 * (web fetch and web search, a sub-agent's start) reaches neither format;
 * the turn hides it when a hook would have matched it (`hook-tool-hiding.ts`).
 *
 * A rewrite is taken back to Cursor's payload and allowed only where
 * Cursor's engine applies it ({@link APPLIED_FIELDS}, each tool adapter's
 * `applyUpdatedInput` in the 1.0.31 bundle): a file's new content, any MCP
 * call, or a Claude view built from another tool cannot be applied, so a
 * hook that rewrites them refuses the call instead of letting it run as
 * the model wrote it.
 */

import { isAbsolute, resolve } from "node:path";
import type { HookFormatName } from "../../shared/hooks/hook-set.js";
import type { CallViews, CursorToolView, HookToolViews, PluginServerName, ToolView, ViewedCall } from "../../shared/hooks/tool-view.js";

type Args = Record<string, unknown>;

/**
 * The fields of each tool's input a hook's `updated_input` may change on this
 * engine: those Cursor's engine applies. A write's or a deletion's new path
 * is checked again by the hook server (`hook-server.ts`), since the gate's
 * capture and its secret-like path block judged the path the model wrote.
 */
export const APPLIED_FIELDS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["Shell", new Set(["command", "cwd", "timeout"])],
  ["Read", new Set(["file_path"])],
  ["Write", new Set(["file_path"])],
  ["Delete", new Set(["file_path"])],
  ["Grep", new Set(["pattern", "file_path"])],
  ["List", new Set(["file_path"])],
  ["Fetch", new Set(["url"])],
  ["ReadLints", new Set(["file_path"])],
]);

/** What the views read from the turn. */
export interface CursorViewContext {
  readonly workspaceRoot: string;
  /** The servers a plugin brought, by slug, with the names Claude Code gives them. */
  readonly pluginServers: ReadonlyMap<string, PluginServerName>;
  /** The platform's own servers, which no hook sees. */
  readonly platformServerSlugs: ReadonlySet<string>;
}

/** A Cursor listing: a `Grep` with an empty pattern over the files a glob takes. */
function isListing(args: Args): boolean {
  return args["pattern"] === "" && typeof args["glob"] === "string";
}

/**
 * The name the call's transcript row carries: the stream's name for the
 * tool, which differs from the hook's (`Shell` streams as `shell`, a create
 * or an edit as `edit`, a listing as `glob`); an MCP call's row is its tool.
 */
export function rowNameOf(call: ViewedCall): string {
  if (call.serverSlug !== "") return call.name;
  switch (call.name) {
    case "Write":
      return "edit";
    case "Grep":
      return isListing(call.args) ? "glob" : "grep";
    case "List":
      return "ls";
    case "ReadLints":
      return "readLints";
    default:
      return call.name.toLowerCase();
  }
}

/** The hooks' views of the Cursor engine's calls for one turn, in both formats. */
export class CursorEngineToolViews implements HookToolViews {
  private readonly unseen = new Set<string>();

  constructor(private readonly ctx: CursorViewContext) {}

  viewsOf(call: ViewedCall): CallViews {
    if (call.serverSlug !== "") return this.mcpViews(call);
    const cursor: CursorToolView = {
      toolName: call.name,
      toolInput: { ...call.args },
      ...(call.name === "Shell" ? { command: typeof call.args["command"] === "string" ? call.args["command"] : "" } : {}),
    };
    const claude = this.claudeViewOf(call);
    if (claude === undefined && !this.unseen.has(call.name)) {
      this.unseen.add(call.name);
      console.log(`[hooks] Cursor's ${call.name} has no Claude Code name; it reaches only Cursor-format hooks`);
    }
    return { cursor, ...(claude !== undefined ? { "claude-code": claude } : {}) };
  }

  argsFrom(call: ViewedCall, format: HookFormatName, input: Args): Args | string {
    if (call.serverSlug !== "") return "Cursor's engine applies no rewrite of an MCP call";
    const next = format === "cursor" ? { ...call.args, ...input } : this.fromClaude(call, input);
    if (typeof next === "string") return next;
    if (typeof next["file_path"] === "string" && next["file_path"] !== "" && !isAbsolute(next["file_path"])) {
      next["file_path"] = resolve(this.ctx.workspaceRoot, next["file_path"]);
    }
    const applied = APPLIED_FIELDS.get(call.name) ?? new Set<string>();
    const changed = [...new Set([...Object.keys(call.args), ...Object.keys(next)])].filter(
      (key) => JSON.stringify(call.args[key]) !== JSON.stringify(next[key]),
    );
    const unapplied = changed.filter((key) => !applied.has(key));
    if (unapplied.length > 0) {
      return `Cursor's engine does not apply a rewrite of ${call.name}'s ${unapplied.join(", ")}`;
    }
    return next;
  }

  private mcpViews(call: ViewedCall): CallViews {
    const slug = call.serverSlug;
    if (this.ctx.platformServerSlugs.has(slug)) return {};
    const owned = this.ctx.pluginServers.get(slug);
    const claude: ToolView = {
      toolName: `mcp__${slug}__${call.name}`,
      toolInput: { ...call.args },
      mcpServer: { name: owned === undefined ? slug : `plugin:${owned.plugin}:${owned.server}`, source: "plugin" },
    };
    return {
      "claude-code": claude,
      cursor: { toolName: `MCP:${call.name}`, toolInput: { ...call.args }, mcp: { tool: call.name, server: slug } },
    };
  }

  private claudeViewOf(call: ViewedCall): ToolView | undefined {
    const args = call.args;
    switch (call.name) {
      case "Shell":
        return { toolName: "Bash", toolInput: { command: args["command"], ...(typeof args["timeout"] === "number" ? { timeout: args["timeout"] } : {}) } };
      case "Read":
        return { toolName: "Read", toolInput: { file_path: args["file_path"] } };
      case "Write":
        return { toolName: "Write", toolInput: { file_path: args["file_path"], content: args["content"] }, aliases: ["Edit"] };
      case "Delete":
        return { toolName: "Write", toolInput: { file_path: args["file_path"], content: "" } };
      case "Grep": {
        if (isListing(args)) return { toolName: "Glob", toolInput: { pattern: args["glob"], path: args["file_path"] } };
        const { file_path, ...rest } = args;
        return { toolName: "Grep", toolInput: { ...rest, path: file_path } };
      }
      default:
        return undefined;
    }
  }

  /** A Claude Code view's rewrite, back in Cursor's payload; a string says why it cannot be taken back. */
  private fromClaude(call: ViewedCall, input: Args): Args | string {
    // Laid over the call's arguments, though a Claude Code rewrite replaces
    // the input: Cursor's engine applies only the fields a rewrite gives
    // (each tool's `applyUpdatedInput`), so a field the hook left out keeps
    // the model's value there whatever is sent. Every field the hook gave wins.
    const args = call.args;
    switch (call.name) {
      case "Shell":
        return { ...args, command: input["command"], ...(typeof input["timeout"] === "number" ? { timeout: input["timeout"] } : {}) };
      case "Read":
        return { ...args, file_path: input["file_path"] };
      case "Write":
        return { ...args, file_path: input["file_path"], content: input["content"] };
      case "Grep": {
        if (isListing(args)) return { ...args, glob: input["pattern"], file_path: input["path"] };
        const { path, ...rest } = input;
        return { ...args, ...rest, file_path: path };
      }
      default:
        return `a Claude Code hook sees Cursor's ${call.name} as another tool, so its rewrite cannot be taken back`;
    }
  }
}
