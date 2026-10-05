/**
 * Cursor's hook format, as this runner runs it on both engines, following
 * what `@cursor/sdk` itself does with a project hook (1.0.31's bundle, and
 * the live probe of 2026-10-05).
 *
 * EVENTS. Before a call runs it fires `preToolUse` (an MCP call as
 * `MCP:<tool>`), plus `beforeShellExecution` for a shell call and
 * `beforeMCPExecution` for an MCP call; after it succeeded, `postToolUse`,
 * plus `afterMCPExecution` for an MCP call. A group's matcher is an
 * unanchored regular expression (`""` and `*` take every call), tested
 * against the tool name, the command text for `beforeShellExecution`, and
 * `MCP:<tool>` for the two MCP events. All the events of one call are
 * offered together and their answers combine once, with every other
 * format's (`../evaluate.ts`).
 *
 * STDIN. Cursor's fields: `conversation_id` and `session_id` (the Stigmer
 * session), `generation_id` (the execution), `model`, `hook_event_name`,
 * `workspace_roots`, a null `transcript_path`, and per event `tool_name`,
 * `tool_input`, `tool_use_id`, `cwd` (`preToolUse`, `postToolUse`);
 * `command`, `cwd` (`beforeShellExecution`); the bare `tool_name`,
 * `tool_input` as a JSON string, `mcp_server_name` (the two MCP events);
 * `tool_output` (`postToolUse`) and `result_json` (`afterMCPExecution`) as
 * JSON strings.
 *
 * ENVIRONMENT. The agent shell's, plus `CURSOR_PROJECT_DIR` and
 * `CLAUDE_PROJECT_DIR`, and for a plugin's hook `CURSOR_PLUGIN_ROOT`,
 * `CLAUDE_PLUGIN_ROOT` and `PLUGIN_ROOT`; the same variables are substituted
 * in `command`. A Cursor handler has no `args`, so it always runs in a shell.
 *
 * ANSWERS. Exit code 2 denies, with what the hook printed as the reason.
 * Otherwise stdout as JSON decides: `permission` (`allow`, `deny`, `ask`)
 * with `agent_message` (the model's reason) or `user_message`,
 * `updated_input` and `additional_context`; Claude Code's
 * `hookSpecificOutput` is read too, as Cursor's documentation promises.
 * An `ask` is enforced, as Stigmer's approval card, where Cursor's own
 * engine would let the call through: a hook that asks is never skipped.
 *
 * FAILURES, Cursor's rule. A hook marked `fail_closed` denies when it
 * crashes, times out, exits with another non-zero code, or prints nothing;
 * one that is not decides nothing. Output that is not JSON denies on a
 * pre event whether or not the hook fails closed. A handler with no timeout
 * gets Cursor's default, {@link CURSOR_DEFAULT_TIMEOUT_SECONDS}.
 */

import type { HookHandler } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { parsePreToolUse, HOOK_TEXT_CAP, type PostToolUseAnswer, type PreToolUseAnswer } from "../answer.js";
import type { CursorHookEvent, HookSource } from "../hook-set.js";
import type { HookRunResult } from "../run.js";
import type { CursorToolView } from "../tool-view.js";
import type { FormatContext, HookCommand } from "./common.js";

/** Cursor's default hook timeout (`@cursor/sdk` 1.0.31). */
export const CURSOR_DEFAULT_TIMEOUT_SECONDS = 60;

/** One event a call fires, and what a group's matcher is tested against for it. */
export interface CursorEventTarget {
  readonly event: CursorHookEvent;
  readonly target: string;
}

/** The events a call fires before it runs. */
export function cursorPreEvents(view: CursorToolView): readonly CursorEventTarget[] {
  return [
    { event: "preToolUse", target: view.toolName },
    ...(view.command !== undefined ? [{ event: "beforeShellExecution" as const, target: view.command }] : []),
    ...(view.mcp !== undefined ? [{ event: "beforeMCPExecution" as const, target: `MCP:${view.mcp.tool}` }] : []),
  ];
}

/** The events a call fires after it succeeded. */
export function cursorPostEvents(view: CursorToolView): readonly CursorEventTarget[] {
  return [
    { event: "postToolUse", target: view.toolName },
    ...(view.mcp !== undefined ? [{ event: "afterMCPExecution" as const, target: `MCP:${view.mcp.tool}` }] : []),
  ];
}

/** Cursor's matcher rule: every call for `""` and `*`, else an unanchored regular expression. */
export function cursorMatches(matcher: string, target: string): boolean {
  if (matcher === "" || matcher === "*") return true;
  try {
    return new RegExp(matcher).test(target);
  } catch {
    console.warn(`[hooks] a matcher that is not a regular expression matches nothing: ${matcher}`);
    return false;
  }
}

/** What a Cursor hook reads on stdin for this event; `output` is the result's text on a post event. */
export function cursorStdin(
  event: CursorHookEvent,
  view: CursorToolView,
  callId: string,
  ctx: FormatContext,
  output?: string,
): Record<string, unknown> {
  const common = {
    conversation_id: ctx.sessionId,
    session_id: ctx.sessionId,
    generation_id: ctx.executionId,
    model: ctx.model,
    hook_event_name: event,
    workspace_roots: [ctx.workspaceRoot],
    transcript_path: null,
  };
  switch (event) {
    case "preToolUse":
      return { ...common, tool_name: view.toolName, tool_input: view.toolInput, tool_use_id: callId, cwd: ctx.workspaceRoot };
    case "beforeShellExecution":
      return { ...common, command: view.command ?? "", cwd: ctx.workspaceRoot };
    case "beforeMCPExecution":
      return { ...common, ...mcpFields(view) };
    case "postToolUse":
      return {
        ...common,
        tool_name: view.toolName,
        tool_input: view.toolInput,
        tool_output: JSON.stringify(view.mcp !== undefined ? mcpResult(output ?? "") : { output: output ?? "" }),
        tool_use_id: callId,
        cwd: ctx.workspaceRoot,
      };
    case "afterMCPExecution":
      return { ...common, ...mcpFields(view), result_json: JSON.stringify(mcpResult(output ?? "")) };
    /* v8 ignore start -- @preserve: the never arm; the compiler proves no event reaches it */
    default: {
      const exhaustive: never = event;
      throw new Error(`cursor hooks: unknown event ${String(exhaustive)}`);
    }
    /* v8 ignore stop */
  }
}

function mcpFields(view: CursorToolView): Record<string, unknown> {
  return { tool_name: view.mcp?.tool ?? view.toolName, tool_input: JSON.stringify(view.toolInput), mcp_server_name: view.mcp?.server ?? "" };
}

function mcpResult(text: string): unknown {
  return { content: [{ type: "text", text }], isError: false };
}

/** The variables a Cursor hook's command may name, and their values. */
function pathVariables(source: HookSource, ctx: FormatContext): Record<string, string> {
  return {
    CURSOR_PROJECT_DIR: ctx.workspaceRoot,
    CLAUDE_PROJECT_DIR: ctx.workspaceRoot,
    ...(source.root !== ""
      ? { CURSOR_PLUGIN_ROOT: source.root, CLAUDE_PLUGIN_ROOT: source.root, PLUGIN_ROOT: source.root }
      : {}),
  };
}

/** The command to spawn, the path variables substituted. */
export function cursorCommand(source: HookSource, handler: HookHandler, ctx: FormatContext): HookCommand {
  let command = handler.command;
  for (const [name, value] of Object.entries(pathVariables(source, ctx))) command = command.replaceAll(`\${${name}}`, value);
  return { command, args: null };
}

/** A Cursor hook's environment. */
export function cursorEnv(source: HookSource, ctx: FormatContext): Record<string, string> {
  return {
    ...ctx.baseEnv,
    ...pathVariables(source, ctx),
    // Python would otherwise write `__pycache__` into the plugin's tree,
    // which the tamper guard then rebuilds before every later run.
    ...(source.root !== "" ? { PYTHONDONTWRITEBYTECODE: "1" } : {}),
  };
}

const BLOCKING_EXIT = 2;
const PERMISSIONS: ReadonlySet<string> = new Set(["allow", "deny", "ask"]);

/** What one run of a Cursor handler answered before a call. */
export function parseCursorPre(result: HookRunResult, handler: Pick<HookHandler, "failClosed">): PreToolUseAnswer {
  const failure = failureOf(result);
  if (failure !== undefined) return failed(failure, handler.failClosed);
  const stdout = result.stdout.trim();
  if (result.exitCode === BLOCKING_EXIT) {
    const json = jsonObjectOf(stdout);
    const reason = (json !== undefined ? messageOf(json) : undefined) ?? (stdout || result.stderr.trim());
    return { decision: "deny", reason: capped(reason) || "A hook blocked this call." };
  }
  if (result.exitCode !== 0) {
    const stderr = result.stderr.trim();
    return failed(`the command exited ${result.exitCode}${stderr ? `: ${stderr.slice(0, 500)}` : ""}`, handler.failClosed);
  }
  if (stdout === "") return failed("the command printed no answer", handler.failClosed);
  const json = jsonObjectOf(stdout);
  if (json === undefined) {
    // Cursor refuses a call whose pre-execution hook answers with something
    // that is not JSON, fail-closed or not.
    return { decision: "deny", reason: "A hook answered with something that is not JSON.", error: "the answer is not JSON" };
  }
  const permission = json["permission"];
  if (typeof permission !== "string" || !PERMISSIONS.has(permission)) {
    // Claude Code's shape, which Cursor's documentation says it accepts.
    if (isObject(json["hookSpecificOutput"]) || json["decision"] !== undefined) return parsePreToolUse(result);
    const additionalContext = stringField(json, "additional_context");
    return additionalContext !== undefined ? { additionalContext: capped(additionalContext) } : {};
  }
  const reason = messageOf(json);
  const updatedInput = isObject(json["updated_input"]) ? json["updated_input"] : undefined;
  const additionalContext = stringField(json, "additional_context");
  return {
    decision: permission as "allow" | "deny" | "ask",
    ...(reason !== undefined ? { reason: capped(reason) } : {}),
    ...(updatedInput !== undefined ? { updatedInput } : {}),
    ...(additionalContext !== undefined ? { additionalContext: capped(additionalContext) } : {}),
  };
}

/** What one run of a Cursor handler handed back after a call. */
export function parseCursorPost(result: HookRunResult): PostToolUseAnswer {
  const failure = failureOf(result);
  if (failure !== undefined) return { error: failure };
  if (result.exitCode !== 0) return result.exitCode === BLOCKING_EXIT ? {} : { error: `the command exited ${result.exitCode}` };
  const json = jsonObjectOf(result.stdout.trim());
  const additionalContext = json !== undefined ? stringField(json, "additional_context") : undefined;
  return additionalContext !== undefined ? { additionalContext: capped(additionalContext) } : {};
}

/** A failed run: a refusal when the handler fails closed, else no decision. */
function failed(failure: string, failClosed: boolean): PreToolUseAnswer {
  if (!failClosed) return { error: failure };
  return { decision: "deny", reason: `A hook that must answer before this call failed (${failure}), so the call was refused.`, error: failure };
}

function failureOf(result: HookRunResult): string | undefined {
  if (result.spawnError !== undefined) return `the command did not start: ${result.spawnError}`;
  if (result.timedOut) return "the command timed out";
  if (result.exitCode === null) return "the command was stopped";
  return undefined;
}

/** The model's reason first, else the person's. */
function messageOf(json: Record<string, unknown>): string | undefined {
  return stringField(json, "agent_message") ?? stringField(json, "user_message");
}

function jsonObjectOf(text: string): Record<string, unknown> | undefined {
  if (!text.startsWith("{") || !text.endsWith("}")) return undefined;
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function capped(text: string): string {
  return text.length > HOOK_TEXT_CAP ? text.slice(0, HOOK_TEXT_CAP) : text;
}
