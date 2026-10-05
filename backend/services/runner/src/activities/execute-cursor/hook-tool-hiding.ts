/**
 * The Cursor tools a turn hides because an agent's hook would have answered
 * for them and Cursor never shows them to a hook.
 *
 * Web fetch and web search reach the model through Cursor's dynamic tools
 * and fire no hook event, and a `task` delegation fires none either (live
 * probes, 2026-10-05, `cursor-hook-protocol.live.test.ts`). A hook whose
 * matcher would take them would silently not run, a policy that vanished;
 * an absent tool keeps the policy instead. So, through the SDK's own tool
 * options:
 *  - web fetch and web search are hidden when any PreToolUse hook's matcher
 *    takes them, a match-everything matcher included;
 *  - the sub-agent tool is hidden only when a matcher names it (takes it
 *    and does not take every tool): a sub-agent's own calls still reach
 *    every hook, so a match-everything hook still sees all its work.
 *
 * A Claude Code matcher is tested against Claude's names (`WebFetch`,
 * `WebSearch`, `Agent`), a Cursor one against Cursor's (`WebFetch` and the
 * SDK's `Fetch`, `WebSearch`, `Task`).
 */

import { cursorMatches } from "../../shared/hooks/formats/cursor.js";
import type { HookEntry, HookSet } from "../../shared/hooks/hook-set.js";
import { matcherMatches } from "../../shared/hooks/matcher.js";

/** A name no tool has: a matcher that takes it takes every tool. */
const NO_SUCH_TOOL = "\u0000";

/** One SDK tool, and the names each format's hooks would use for it. */
interface Hideable {
  /** The `@cursor/sdk` `ToolName`. */
  readonly sdkName: string;
  readonly claude: readonly string[];
  readonly cursor: readonly string[];
  /** Hidden by a match-everything matcher too. */
  readonly byMatchAll: boolean;
}

const HIDEABLE: readonly Hideable[] = [
  { sdkName: "webFetch", claude: ["WebFetch"], cursor: ["WebFetch", "Fetch"], byMatchAll: true },
  { sdkName: "webSearch", claude: ["WebSearch"], cursor: ["WebSearch"], byMatchAll: true },
  { sdkName: "task", claude: ["Agent"], cursor: ["Task"], byMatchAll: false },
];

function takes(entry: HookEntry, name: string): boolean {
  return entry.format === "cursor" ? cursorMatches(entry.matcher, name) : matcherMatches(entry.matcher, name);
}

/** The SDK tool names to hide this turn, in a stable order. */
export function toolsHiddenByHooks(set: HookSet): readonly string[] {
  const pre = set.all.filter((entry) => entry.event === "PreToolUse" || entry.event === "preToolUse");
  return HIDEABLE.filter((tool) =>
    pre.some((entry) => {
      const names = entry.format === "cursor" ? tool.cursor : tool.claude;
      if (!names.some((name) => takes(entry, name))) return false;
      return tool.byMatchAll || !takes(entry, NO_SUCH_TOOL);
    }),
  ).map((tool) => tool.sdkName);
}

/** The SDK's tool options with the hidden tools taken out: off an allow-list, onto the deny-list. */
export function withToolsHidden<T extends string>(
  options: { readonly tools?: T[]; readonly disallowedTools?: T[] },
  hidden: readonly T[],
): { readonly tools?: T[]; readonly disallowedTools?: T[] } {
  if (hidden.length === 0) return options;
  if (options.tools !== undefined) return { tools: options.tools.filter((name) => !hidden.includes(name)) };
  return { disallowedTools: [...new Set([...(options.disallowedTools ?? []), ...hidden])] };
}
