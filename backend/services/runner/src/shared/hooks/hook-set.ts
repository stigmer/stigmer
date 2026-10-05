/**
 * The turn's hooks, in the order the agent lists their sources.
 *
 * An agent's `hooks` are sources: a plugin whose recorded hooks apply, or a
 * block written in the agent itself (`AgentSpec.hooks`). Each source's tool
 * events become entries here, each carrying the source it came from: the
 * plugin's slug (the name a run records as the deciding hook, empty for the
 * agent's own block), the hook format its groups are written in, the
 * directories its commands run against, and the values its
 * `${user_config.KEY}` references resolve to. Only the events this runner
 * runs become entries, per format (`formats/*.ts`); install and apply have
 * already named every other event as not run.
 *
 * Order matters only for attribution: when two hooks give the winning
 * answer, the first source in the agent's list is recorded as the decider
 * (`evaluate.ts`).
 */

import type { HookGroup, HookHandler } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";

/** Claude Code's `${user_config.KEY}`; global, so read it only with `matchAll` or `replace`. */
export const USER_CONFIG_REFERENCE = /\$\{user_config\.([A-Za-z_][A-Za-z0-9_]*)\}/g;

/**
 * The `KEY`s a handler's `${user_config.KEY}` references reach: in its
 * command and arguments in exec form, where Claude Code substitutes them. A
 * shell-form command cannot reference them (`evaluate.ts`).
 */
export function userConfigKeys(handler: HookHandler): readonly string[] {
  if (handler.args.length === 0) return [];
  return [handler.command, ...handler.args].flatMap((value) => [...value.matchAll(USER_CONFIG_REFERENCE)].map((m) => m[1]!));
}

/** The two hook formats a source may be written in. */
export type HookFormatName = "claude-code" | "cursor";

/** Claude Code's tool events this runner runs. */
export type ClaudeHookEvent = "PreToolUse" | "PostToolUse";

/** Cursor's tool events this runner runs. */
export type CursorHookEvent = "preToolUse" | "beforeShellExecution" | "beforeMCPExecution" | "postToolUse" | "afterMCPExecution";

/** A tool event this runner runs, in either format. */
export type HookEvent = ClaudeHookEvent | CursorHookEvent;

/** The events this runner runs, per format: the plugin library's run set (`normalise/hooks.ts` `RUN_EVENTS`). */
const RUN_EVENTS: Readonly<Record<HookFormatName, ReadonlySet<string>>> = {
  "claude-code": new Set<ClaudeHookEvent>(["PreToolUse", "PostToolUse"]),
  cursor: new Set<CursorHookEvent>(["preToolUse", "beforeShellExecution", "beforeMCPExecution", "postToolUse", "afterMCPExecution"]),
};

/** Whether this runner runs a group of this event in this format (Claude Code's when the format is not given). */
export function isRunEvent(event: string, format: HookFormatName = "claude-code"): event is HookEvent {
  return RUN_EVENTS[format].has(event);
}

/** Where one entry's hooks come from, and what their commands run with. */
export interface HookSource {
  /** The plugin's slug; `""` for the agent's own hooks block. */
  readonly plugin: string;
  /** `${CLAUDE_PLUGIN_ROOT}` (`${CURSOR_PLUGIN_ROOT}`); `""` for the agent's own block, which has none. */
  readonly root: string;
  /** `${CLAUDE_PLUGIN_DATA}`; `""` for the agent's own block. */
  readonly data: string;
  /** The value of each `${user_config.KEY}` the source's hooks reference, by `KEY`. */
  readonly options: ReadonlyMap<string, string>;
  /** Run before each of the source's commands: a plugin's tamper guard. */
  readonly beforeRun?: () => Promise<void>;
}

/** One group of one source: an event, its matcher and its handlers. */
export interface HookEntry {
  readonly source: HookSource;
  /** The format the source's groups are written in. */
  readonly format: HookFormatName;
  /** The source's position in the agent's list. */
  readonly order: number;
  readonly event: HookEvent;
  readonly matcher: string;
  readonly handlers: readonly HookHandler[];
}

/** One source and its recorded groups, as the turn resolved them. */
export interface HookSourceGroups {
  readonly source: HookSource;
  /** Claude Code's when absent. */
  readonly format?: HookFormatName;
  readonly groups: readonly HookGroup[];
}

/** The turn's hooks. */
export class HookSet {
  private constructor(private readonly entries: readonly HookEntry[]) {}

  /** The set over the agent's sources, in its order; groups of events this runner does not run are left out. */
  static of(sources: readonly HookSourceGroups[]): HookSet {
    const entries: HookEntry[] = [];
    sources.forEach(({ source, format = "claude-code", groups }, order) => {
      for (const group of groups) {
        if (!isRunEvent(group.event, format) || group.handlers.length === 0) continue;
        entries.push({ source, format, order, event: group.event, matcher: group.matcher, handlers: group.handlers });
      }
    });
    return new HookSet(entries);
  }

  /** Whether any source contributes a hook this runner runs. */
  get isEmpty(): boolean {
    return this.entries.length === 0;
  }

  /** Every entry, in source order. */
  get all(): readonly HookEntry[] {
    return this.entries;
  }

  /** Whether any entry runs a handler in shell form (no `args`), which needs `bash`; every Cursor handler does. */
  get needsShell(): boolean {
    return this.entries.some((entry) => entry.handlers.some((handler) => handler.args.length === 0));
  }

  /** The longest any one handler may run, in seconds, each handler's own or its format's default. */
  longestTimeoutSeconds(defaultFor: (format: HookFormatName) => number): number {
    let longest = 0;
    for (const entry of this.entries) {
      for (const handler of entry.handlers) {
        longest = Math.max(longest, handler.timeoutSeconds > 0 ? handler.timeoutSeconds : defaultFor(entry.format));
      }
    }
    return longest;
  }
}
