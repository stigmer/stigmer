// Framework-agnostic words for a hook set, for every Stigmer surface.
//
// A plugin's recorded hooks (`PluginStatus.hooks`) and an agent's inline hooks
// (`AgentSpec.hooks`) are one `HookConfig`. The CLI's `validate`, `push` and
// `get`, and the console's plugin and agent pages, describe it in the same
// words: a one-line summary per format, and plain words beside each event's
// own name. Events and commands are always shown verbatim beside these words,
// because the exact strings are what runs.

import { HookFormat } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";

export { HookFormat };

/** A hook format as the plugin reader and the CLI spell it. */
export type HookFormatName = "claude-code" | "cursor";

/** The product each format comes from, for sentences. */
export const HOOK_FORMAT_LABELS: Readonly<Record<HookFormatName, string>> = {
  "claude-code": "Claude Code",
  cursor: "Cursor",
};

/**
 * Maps the wire format to its name. An unset format is Claude Code's: the
 * server fills an inline block's omitted format with it at apply.
 */
export function hookFormatName(format: HookFormat): HookFormatName {
  return format === HookFormat.CURSOR ? "cursor" : "claude-code";
}

/**
 * `Claude Code format: PreToolUse 2, PostToolUse 1`: handlers per event, in
 * first-seen order. Hooks in either format run on both engines when an agent
 * references the plugin.
 */
export function hooksSummary(
  format: HookFormatName,
  groups: readonly {
    readonly event: string;
    readonly handlers: readonly unknown[];
  }[],
): string {
  const perEvent = new Map<string, number>();
  for (const group of groups) {
    perEvent.set(group.event, (perEvent.get(group.event) ?? 0) + group.handlers.length);
  }
  const counts = [...perEvent].map(([event, n]) => `${event} ${n}`).join(", ");
  return `${HOOK_FORMAT_LABELS[format]} format: ${counts}`;
}

/**
 * Plain words for every event Stigmer runs, in both formats' spellings. The
 * keys are the plugin reader's run events (`RUN_EVENTS` in
 * `@stigmer/plugin-package`); an event outside them is never recorded.
 */
const EVENT_LABELS: ReadonlyMap<string, string> = new Map([
  ["PreToolUse", "Before a tool call"],
  ["PostToolUse", "After a tool call"],
  ["preToolUse", "Before a tool call"],
  ["postToolUse", "After a tool call"],
  ["beforeShellExecution", "Before a shell command"],
  ["beforeMCPExecution", "Before an MCP tool call"],
  ["afterMCPExecution", "After an MCP tool call"],
]);

/**
 * Returns plain words for a hook event ("Before a tool call" for
 * `PreToolUse`), or `null` for an event Stigmer does not run, so a caller
 * shows the event's own name alone rather than a wrong description.
 */
export function hookEventLabel(event: string): string | null {
  return EVENT_LABELS.get(event) ?? null;
}

/**
 * Plain words for a group's matcher: an empty matcher or `*` matches every
 * tool; any other matcher is shown verbatim.
 */
export function hookMatcherLabel(matcher: string): string | null {
  return matcher === "" || matcher === "*" ? "every tool" : null;
}
