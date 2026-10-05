/**
 * The contract's hooks as real commands, shared by every substrate so both
 * engines run the very same hooks: each logs what it reads on stdin, then
 * answers as its behaviour says, in its format (Claude Code's JSON, or
 * Cursor's `permission`), grouped into the turn's sources one per plugin
 * and format.
 */

import { create } from "@bufbuild/protobuf";
import { HookGroupSchema, HookHandlerSchema, type HookGroup } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import type { HookSourceGroups } from "../../shared/hooks/hook-set.js";
import type { ContractHook, ContractHookBehaviour, ProposedAction } from "./types.js";

/** One word of a bash command, quoted. */
export function shellWord(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The bash command a contract hook runs: log its stdin, then answer as `does`
 * says, in the hook's format (Claude Code's JSON, or Cursor's `permission`).
 * Shared with the Cursor substrate, so both engines run the very same hooks.
 */
export function contractHookCommand(
  does: ContractHookBehaviour,
  files: { runs: string; state: string },
  format: "claude-code" | "cursor",
  rewriteInput: (action: ProposedAction) => Record<string, unknown>,
): string {
  const log = `cat >> ${shellWord(files.runs)}; echo >> ${shellWord(files.runs)}; `;
  const print = (json: unknown) => `printf '%s' ${shellWord(JSON.stringify(json))}`;
  const decide = (permissionDecision: string, extra: { reason?: string; updatedInput?: unknown; additionalContext?: string } = {}) =>
    format === "cursor"
      ? print({
          permission: permissionDecision,
          ...(extra.reason ? { agent_message: extra.reason } : {}),
          ...(extra.updatedInput ? { updated_input: extra.updatedInput } : {}),
          ...(extra.additionalContext ? { additional_context: extra.additionalContext } : {}),
        })
      : print({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision,
            ...(extra.reason ? { permissionDecisionReason: extra.reason } : {}),
            ...(extra.updatedInput ? { updatedInput: extra.updatedInput } : {}),
            ...(extra.additionalContext ? { additionalContext: extra.additionalContext } : {}),
          },
        });
  if ("hang" in does) return `${log}sleep 30`;
  if ("exit" in does) return `${log}printf '%s' ${shellWord(does.stderr ?? "")} >&2; exit ${does.exit}`;
  if ("invalidJson" in does) return `${log}printf '%s' 'this is not json'`;
  if ("postBlock" in does) {
    return log + print({
      decision: "block",
      reason: does.postBlock,
      ...(does.context ? { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: does.context } } : {}),
    });
  }
  if (does.answer === "ask-then-deny") {
    return `${log}if [ -e ${shellWord(files.state)} ]; then ${decide("deny", { reason: "asked once already" })}; ` +
      `else : > ${shellWord(files.state)}; ${decide("ask")}; fi`;
  }
  return log + decide(does.answer, {
    ...(does.reason ? { reason: does.reason } : {}),
    ...(does.rewrite ? { updatedInput: rewriteInput(does.rewrite) } : {}),
    ...(does.context ? { additionalContext: does.context } : {}),
  });
}

/** The contract's hooks as the turn's sources: one per plugin and format, in first-seen order. */
export function contractHookSources(
  hooks: readonly ContractHook[],
  files: { runs: string; state: string },
  pluginRoot: string,
  rewriteInput: (action: ProposedAction) => Record<string, unknown>,
): HookSourceGroups[] {
  const bySource = new Map<string, { plugin: string; format: "claude-code" | "cursor"; groups: HookGroup[] }>();
  for (const hook of hooks) {
    const plugin = hook.plugin ?? "safety";
    const format = hook.format ?? "claude-code";
    const key = `${plugin}\n${format}`;
    const source = bySource.get(key) ?? { plugin, format, groups: [] };
    source.groups.push(create(HookGroupSchema, {
      event: hook.event,
      matcher: hook.matcher,
      handlers: [create(HookHandlerSchema, {
        command: contractHookCommand(hook.does, files, format, rewriteInput),
        timeoutSeconds: "hang" in hook.does ? 1 : 0,
        condition: hook.condition ?? "",
        failClosed: hook.failClosed ?? false,
      })],
    }));
    bySource.set(key, source);
  }
  return [...bySource.values()].map(({ plugin, format, groups }) => ({
    source: { plugin, root: pluginRoot, data: pluginRoot, options: new Map() },
    format,
    groups,
  }));
}
