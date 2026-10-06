// One hook set, read-only: a plugin's recorded hooks (`PluginStatus.hooks`)
// or an agent's inline hooks, shown the same way on the plugin page and the
// agent page. One row per group: the event in plain words beside its own
// name ("Before a tool call · PreToolUse"), the matcher ("every tool" when
// empty or `*`), and each handler's command and arguments verbatim, with its
// timeout and `if` condition when set, and whether it refuses the call when
// it fails or times out (Cursor's `failClosed`). Verbatim for the reason
// `AgentToolLists` gives: the exact strings are what runs, and a person
// deciding whether to trust a plugin reads every command it will run. The
// words come from `@stigmer/sdk` (`hook-words.ts`), which the CLI prints
// too. Pinned by `__tests__/HookConfigList.test.tsx`.

import { cn } from "@stigmer/theme";
import type { HookConfig, HookGroup, HookHandler } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { HOOK_FORMAT_LABELS, hookEventLabel, hookFormatName, hookMatcherLabel } from "@stigmer/sdk";
import { UNSTYLED_LIST } from "../internal/element-resets.js";

/** Props for {@link HookConfigList}. */
export interface HookConfigListProps {
  /** The hook set to show. */
  readonly config: HookConfig;
  /** Additional CSS classes for the root list. */
  readonly className?: string;
}

/**
 * Lists every hook in a hook set: each event, its matcher, and every
 * command it runs, verbatim.
 *
 * @example
 * ```tsx
 * {plugin.status?.hooks && <HookConfigList config={plugin.status.hooks} />}
 * ```
 */
export function HookConfigList({ config, className }: HookConfigListProps) {
  const format = HOOK_FORMAT_LABELS[hookFormatName(config.format)];
  return (
    <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:divide-y stg:divide-border", className)} aria-label={`Hooks (${format} format)`}>
      {config.groups.map((group, index) => (
        <HookGroupRow key={`${group.event}:${index}`} group={group} />
      ))}
    </ul>
  );
}

function HookGroupRow({ group }: { readonly group: HookGroup }) {
  const words = hookEventLabel(group.event);
  const everyTool = hookMatcherLabel(group.matcher);
  return (
    <li className="stg:flex stg:min-w-0 stg:flex-col stg:gap-1.5 stg:px-3 stg:py-2.5">
      <div className="stg:flex stg:flex-wrap stg:items-baseline stg:gap-x-2 stg:gap-y-0.5 stg:text-sm">
        {words !== null && <span className="stg:font-medium stg:text-foreground">{words}</span>}
        <code className="stg:font-mono stg:text-xs stg:text-muted-foreground">{group.event}</code>
        <span className="stg:text-xs stg:text-muted-foreground">
          {everyTool !== null ? (
            `on ${everyTool}`
          ) : (
            <>
              on <code className="stg:break-all stg:font-mono stg:text-foreground">{group.matcher}</code>
            </>
          )}
        </span>
      </div>
      <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:gap-1")} aria-label={`Commands run ${words ?? group.event}`}>
        {group.handlers.map((handler, index) => (
          <HandlerRow key={index} handler={handler} />
        ))}
      </ul>
    </li>
  );
}

function HandlerRow({ handler }: { readonly handler: HookHandler }) {
  const details = [
    handler.condition !== "" ? { label: "only if", value: handler.condition } : null,
    handler.timeoutSeconds > 0 ? { label: "timeout", value: `${handler.timeoutSeconds}s` } : null,
  ].filter((detail): detail is { label: string; value: string } => detail !== null);
  const anyDetail = details.length > 0 || handler.failClosed;
  return (
    <li className="stg:flex stg:min-w-0 stg:flex-col stg:gap-0.5">
      <code className="stg:block stg:min-w-0 stg:whitespace-pre-wrap stg:break-all stg:rounded stg:bg-muted-subtle stg:px-1.5 stg:py-1 stg:font-mono stg:text-xs stg:text-foreground">
        {[handler.command, ...handler.args.map(argWord)].join(" ")}
      </code>
      {anyDetail && (
        <span className="stg:flex stg:flex-wrap stg:gap-x-3 stg:text-xs stg:text-muted-foreground">
          {details.map((detail) => (
            <span key={detail.label}>
              {detail.label} <code className="stg:break-all stg:font-mono">{detail.value}</code>
            </span>
          ))}
          {handler.failClosed && <span>refuses the call if it fails or times out</span>}
        </span>
      )}
    </li>
  );
}

/**
 * An exec-form argument as one visible word: quoted when it is empty or
 * holds whitespace or a quote, so where one argument ends stays readable.
 * The command itself is shown as written (a shell-form command is the
 * shell's text).
 */
function argWord(arg: string): string {
  return /^[^\s'"]+$/.test(arg) ? arg : JSON.stringify(arg);
}
