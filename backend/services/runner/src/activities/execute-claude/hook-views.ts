/**
 * How an agent's hooks see a call on the Claude engine, in both hook
 * formats (`shared/hooks/tool-view.ts` has the shared shapes and the native
 * engine's views).
 *
 * To a Claude Code hook a call is itself: this engine is Claude Code's, so
 * a built-in keeps its name and its input as the model wrote it, the host's
 * shell is `Bash` (the name the model called; the aliased name,
 * `host-shell.ts`, reaches only the gate), and an MCP tool is
 * `mcp__<slug>__<tool>` with its server as the native views show it (a
 * plugin's as `plugin:<plugin>:<server>`, an agent's own by its name). The
 * platform's own servers reach no hook.
 *
 * To a Cursor hook, the rows follow what Cursor's own engine sends a hook,
 * as the native rows do:
 *
 *   Bash          -> Shell {command, cwd}
 *   Read          -> Read
 *   Write, Edit   -> Write (the edit's fields kept)
 *   Grep {path}   -> Grep {file_path}
 *   Glob {pattern, path} -> Grep {pattern: "", glob: pattern, file_path: path}
 *   an MCP tool   -> MCP:<tool>, and the bare tool with its server's slug
 *
 * `NotebookEdit`, `TodoWrite`, `Agent`, `Skill`, `ToolSearch` and
 * `StructuredOutput` have no Cursor row: Cursor's engine has none of them.
 *
 * The inverse of each row restores the call, so view-then-inverse is the
 * identity on what the engine offers (pinned by the module's test). A
 * rewrite the engine cannot take is answered with why, and the evaluator
 * refuses the call (`shared/hooks/evaluate.ts`).
 */

import type { HookFormatName } from "../../shared/hooks/hook-set.js";
import { mcpServerView, type CallViews, type CursorToolView, type HookServerName, type HookToolViews, type ViewedCall } from "../../shared/hooks/tool-view.js";
import { HOST_SHELL_TOOL } from "./host-shell.js";

type Args = Record<string, unknown>;

/** What the views read from the turn. */
export interface ClaudeViewContext {
  /** The workspace's primary directory: the shell's working directory. */
  readonly workspaceRoot: string;
  /** The turn's servers but the platform's, by slug, with the names Claude Code gives them. */
  readonly serverNames: ReadonlyMap<string, HookServerName>;
  /** The platform's own servers, which no hook sees. */
  readonly platformServerSlugs: ReadonlySet<string>;
}

/** One Cursor row: the view of a Claude call, and the way back. */
interface CursorRow {
  readonly name: string;
  readonly toView: (args: Args, root: string) => Args;
  readonly toClaude: (input: Args) => Args | string;
}

/** The fields of Cursor's Write that each of this engine's file tools does not take. */
const WRITE_FIELDS_NOT_TAKEN: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["Edit", new Set(["content"])],
  ["Write", new Set(["old_string", "new_string", "replace_all"])],
]);

function renamed(args: Args, from: string, to: string): Args {
  if (!(from in args)) return { ...args };
  const { [from]: value, ...rest } = args;
  return { ...rest, [to]: value };
}

const SAME: Pick<CursorRow, "toView" | "toClaude"> = { toView: (args) => ({ ...args }), toClaude: (input) => ({ ...input }) };

/** The engine's tools Cursor's hooks have a name for, by the engine's names. */
const CURSOR_ROWS: ReadonlyMap<string, CursorRow> = new Map<string, CursorRow>([
  ["Read", { name: "Read", ...SAME }],
  ["Write", { name: "Write", ...SAME }],
  ["Edit", { name: "Write", ...SAME }],
  ["Grep", { name: "Grep", toView: (args) => renamed(args, "path", "file_path"), toClaude: (input) => renamed(input, "file_path", "path") }],
  [
    "Glob",
    {
      name: "Grep",
      toView: (args, root) => {
        const { pattern, path, ...rest } = args;
        return { ...rest, pattern: "", glob: pattern, file_path: path ?? root, output_mode: "files_with_matches" };
      },
      toClaude: (input) => {
        const { pattern, glob, file_path, output_mode: _mode, ...rest } = input;
        if (typeof pattern === "string" && pattern !== "") return "the hook gave a file listing a search pattern, which the listing tool cannot take";
        return { ...rest, ...(glob !== undefined ? { pattern: glob } : {}), ...(file_path !== undefined ? { path: file_path } : {}) };
      },
    },
  ],
]);

/** The engine's names a view exists for, per format, for the module's test. */
export const CLAUDE_VIEWED_TOOLS: Readonly<Record<HookFormatName, readonly string[]>> = {
  "claude-code": ["Read", "Write", "Edit", "NotebookEdit", "Glob", "Grep", HOST_SHELL_TOOL.engineName, "TodoWrite", "Agent", "Skill", "ToolSearch", "StructuredOutput"],
  cursor: [HOST_SHELL_TOOL.engineName, ...CURSOR_ROWS.keys()],
};

/**
 * The hooks' views of the Claude engine's calls for one turn, in both
 * formats. A call is named as the gate hands it over: a built-in by its
 * engine name, the host's shell as `Bash`, an MCP tool by its bare name
 * with its server's slug.
 */
export class ClaudeToolViews implements HookToolViews {
  constructor(private readonly ctx: ClaudeViewContext) {}

  viewsOf(call: ViewedCall): CallViews {
    if (call.serverSlug !== "") {
      if (this.ctx.platformServerSlugs.has(call.serverSlug)) return {};
      return {
        "claude-code": {
          toolName: `mcp__${call.serverSlug}__${call.name}`,
          toolInput: { ...call.args },
          mcpServer: mcpServerView(this.ctx.serverNames, call.serverSlug),
        },
        cursor: { toolName: `MCP:${call.name}`, toolInput: { ...call.args }, mcp: { tool: call.name, server: call.serverSlug } },
      };
    }
    const cursor = this.cursorViewOf(call);
    return {
      ...(CLAUDE_VIEWED_TOOLS["claude-code"].includes(call.name) ? { "claude-code": { toolName: call.name, toolInput: { ...call.args } } } : {}),
      ...(cursor !== undefined ? { cursor } : {}),
    };
  }

  argsFrom(call: ViewedCall, format: HookFormatName, rewrite: Args): Args | string {
    // Cursor lays a rewrite over the call's own arguments; Claude Code's replaces the input whole.
    if (format === "claude-code") return { ...rewrite };
    if (call.serverSlug !== "") return { ...call.args, ...rewrite };
    const foreign = Object.keys(rewrite).filter((key) => WRITE_FIELDS_NOT_TAKEN.get(call.name)?.has(key));
    if (foreign.length > 0) return `the hook rewrote ${foreign.join(", ")}, which this harness's ${call.name} does not take`;
    const input = { ...this.cursorViewOf(call)?.toolInput, ...rewrite };
    if (call.name === HOST_SHELL_TOOL.engineName) {
      const { cwd, ...rest } = input;
      if (cwd !== undefined && cwd !== "" && cwd !== this.ctx.workspaceRoot) {
        return "the hook moved the command to another directory, which this harness's shell cannot take";
      }
      return rest;
    }
    const row = CURSOR_ROWS.get(call.name);
    return row === undefined ? input : row.toClaude(input);
  }

  private cursorViewOf(call: ViewedCall): CursorToolView | undefined {
    if (call.name === HOST_SHELL_TOOL.engineName) {
      const command = typeof call.args["command"] === "string" ? call.args["command"] : "";
      return { toolName: "Shell", toolInput: { ...call.args, cwd: this.ctx.workspaceRoot }, command };
    }
    const row = CURSOR_ROWS.get(call.name);
    return row === undefined ? undefined : { toolName: row.name, toolInput: row.toView(call.args, this.ctx.workspaceRoot) };
  }
}
