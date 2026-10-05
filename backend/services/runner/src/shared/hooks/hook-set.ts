/**
 * The turn's hooks, in the order the agent lists their sources.
 *
 * An agent's `hooks` are sources: a plugin whose recorded hooks apply, or a
 * block written in the agent itself (`AgentSpec.hooks`). Each source's tool
 * events become entries here, each carrying the source it came from: the
 * plugin's slug (the name a run records as the deciding hook, empty for the
 * agent's own block), the directories its commands run against, and the
 * values its `${user_config.KEY}` references resolve to. Only the two
 * events this runner runs, `PreToolUse` and `PostToolUse`, become entries;
 * install and apply have already named every other event as not run.
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

/** The tool events this runner runs. */
export type HookEvent = "PreToolUse" | "PostToolUse";

const RUN_EVENTS: ReadonlySet<string> = new Set<HookEvent>(["PreToolUse", "PostToolUse"]);

/** Whether this runner runs a group of this event. */
export function isRunEvent(event: string): event is HookEvent {
  return RUN_EVENTS.has(event);
}

/** Where one entry's hooks come from, and what their commands run with. */
export interface HookSource {
  /** The plugin's slug; `""` for the agent's own hooks block. */
  readonly plugin: string;
  /** `${CLAUDE_PLUGIN_ROOT}`; `""` for the agent's own block, which has none. */
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
  /** The source's position in the agent's list. */
  readonly order: number;
  readonly event: HookEvent;
  readonly matcher: string;
  readonly handlers: readonly HookHandler[];
}

/** One source and its recorded groups, as the turn resolved them. */
export interface HookSourceGroups {
  readonly source: HookSource;
  readonly groups: readonly HookGroup[];
}

/** The turn's hooks. */
export class HookSet {
  private constructor(private readonly entries: readonly HookEntry[]) {}

  /** The set over the agent's sources, in its order; groups of events this runner does not run are left out. */
  static of(sources: readonly HookSourceGroups[]): HookSet {
    const entries: HookEntry[] = [];
    sources.forEach(({ source, groups }, order) => {
      for (const group of groups) {
        if (!isRunEvent(group.event) || group.handlers.length === 0) continue;
        entries.push({
          source,
          order,
          event: group.event as HookEvent,
          matcher: group.matcher,
          handlers: group.handlers,
        });
      }
    });
    return new HookSet(entries);
  }

  /** Whether any source contributes a hook this runner runs. */
  get isEmpty(): boolean {
    return this.entries.length === 0;
  }

  /** The entries for one event, in source order. */
  forEvent(event: HookEvent): readonly HookEntry[] {
    return this.entries.filter((entry) => entry.event === event);
  }

  /** Whether any entry runs a handler in shell form (no `args`), which needs `bash`. */
  get needsShell(): boolean {
    return this.entries.some((entry) => entry.handlers.some((handler) => handler.args.length === 0));
  }
}
