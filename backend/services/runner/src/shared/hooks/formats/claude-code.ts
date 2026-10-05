/**
 * Claude Code's hook format, as this runner runs it: which events a call
 * fires and what their matchers are tested against, what a hook reads on
 * stdin and in its environment, and how its answer is read (`../answer.ts`).
 *
 * A call fires `PreToolUse` before it runs and `PostToolUse` after it
 * succeeded; a group's matcher is tested against the call's Claude name and
 * every alias it has (`../tool-view.ts`), by Claude's rule (`../matcher.ts`).
 *
 * stdin is Claude Code's input for the event: `session_id` (the Stigmer
 * session), an empty `transcript_path` (Stigmer keeps no Claude transcript
 * file), `cwd`, `permission_mode`, `hook_event_name`, `tool_name`,
 * `tool_input`, `tool_use_id`, `mcp_server` for an MCP tool, `agent_id` and
 * `agent_type` inside a sub-agent, and on PostToolUse `tool_response`.
 *
 * The environment is the agent shell's (`buildShellEnv`, the runner's own
 * credentials stripped), plus `CLAUDE_PROJECT_DIR`, and for a plugin's hook
 * `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, the open format's
 * `PLUGIN_ROOT`, and `CLAUDE_PLUGIN_OPTION_<KEY>` for each value its hooks
 * reference in exec form; a key no exec-form handler references is not
 * exported, unlike Claude Code, which exports every declared option
 * (stigmer#1912). The three path variables are also substituted in `command`
 * and `args`, and `${user_config.KEY}` in an exec-form handler's; a
 * shell-form command that reaches for `${user_config.KEY}` does not run, as
 * in Claude Code, because the shell would re-parse the value.
 */

import type { HookHandler } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { USER_CONFIG_REFERENCE, type ClaudeHookEvent, type HookSource } from "../hook-set.js";
import { matcherMatches } from "../matcher.js";
import { DEFAULT_HOOK_TIMEOUT_SECONDS } from "../run.js";
import type { ToolView } from "../tool-view.js";
import type { FormatContext, HookCommand, HookScope } from "./common.js";

export { parsePostToolUse as parseClaudePost, parsePreToolUse as parseClaudePre } from "../answer.js";

/** Claude Code's default command-hook timeout. */
export const CLAUDE_DEFAULT_TIMEOUT_SECONDS = DEFAULT_HOOK_TIMEOUT_SECONDS;

/** The names a Claude Code matcher takes this call by. */
export function claudeTargets(view: ToolView): readonly string[] {
  return [view.toolName, ...(view.aliases ?? [])];
}

/** Whether a Claude Code group's matcher takes any of the call's names. */
export function claudeMatches(matcher: string, view: ToolView): boolean {
  return claudeTargets(view).some((name) => matcherMatches(matcher, name));
}

/** What a Claude Code hook reads on stdin for this event. */
export function claudeStdin(
  event: ClaudeHookEvent,
  view: ToolView,
  callId: string,
  scope: HookScope,
  ctx: FormatContext,
  response?: unknown,
): Record<string, unknown> {
  return {
    session_id: ctx.sessionId,
    transcript_path: "",
    cwd: ctx.workspaceRoot,
    permission_mode: ctx.permissionMode,
    hook_event_name: event,
    tool_name: view.toolName,
    tool_input: view.toolInput,
    tool_use_id: callId,
    ...(view.mcpServer ? { mcp_server: view.mcpServer } : {}),
    ...(scope.subAgent ? { agent_id: scope.subAgent.id, agent_type: scope.subAgent.type } : {}),
    ...(event === "PostToolUse" ? { tool_response: response } : {}),
  };
}

/** The command and arguments to spawn, placeholders substituted; a string says why it cannot run. */
export function claudeCommand(source: HookSource, handler: HookHandler, ctx: FormatContext): HookCommand | string {
  const execForm = handler.args.length > 0;
  if (!execForm && handler.command.includes("${user_config.")) {
    return "a shell-form command cannot reference ${user_config.*}; pass the value in args (exec form)";
  }
  const substitute = (value: string): string => {
    let out = value.replaceAll("${CLAUDE_PROJECT_DIR}", ctx.workspaceRoot);
    if (source.root !== "") {
      out = out.replaceAll("${CLAUDE_PLUGIN_ROOT}", source.root).replaceAll("${CLAUDE_PLUGIN_DATA}", source.data);
    }
    if (execForm) {
      out = out.replace(USER_CONFIG_REFERENCE, (match, key: string) => source.options.get(key) ?? match);
    }
    return out;
  };
  return { command: substitute(handler.command), args: execForm ? handler.args.map(substitute) : null };
}

/** A Claude Code hook's environment. */
export function claudeEnv(source: HookSource, ctx: FormatContext): Record<string, string> {
  const env: Record<string, string> = { ...ctx.baseEnv, CLAUDE_PROJECT_DIR: ctx.workspaceRoot };
  if (source.root !== "") {
    env["CLAUDE_PLUGIN_ROOT"] = source.root;
    env["CLAUDE_PLUGIN_DATA"] = source.data;
    env["PLUGIN_ROOT"] = source.root;
    // Python would otherwise write `__pycache__` into the plugin's tree,
    // which the tamper guard then rebuilds before every later run.
    env["PYTHONDONTWRITEBYTECODE"] = "1";
  }
  for (const [key, value] of source.options) env[`CLAUDE_PLUGIN_OPTION_${key.toUpperCase()}`] = value;
  return env;
}
