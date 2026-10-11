"use client";

// The agent page's Hooks section: the hooks written in the agent itself,
// with every command each runs, as `HookConfigList` (the plugin page's)
// shows them. A plugin's hooks come with the plugin: the agent's Plugins
// section lists the plugins, and each plugin's page shows its hooks, so
// nothing here reads a plugin. The block is shown, never edited:
// hand-written hooks are YAML, as Claude Code's settings files are. A
// sub-agent has no hooks of its own (it runs its parent's), so nothing here
// reads one. Pinned by `__tests__/AgentDetailView.hooks.test.tsx`.

import { cn } from "@stigmer/theme";
import type { HookSource } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { HookConfigList } from "../plugin/HookConfigList.js";
import { Section } from "../resource-detail/Section.js";

/** Props for {@link AgentHooksSection}. */
export interface AgentHooksSectionProps {
  /** `AgentSpec.hooks`, in the agent's order. */
  readonly hooks: readonly HookSource[];
}

/**
 * Lists the hooks written in an agent, with every command each runs;
 * renders nothing for an agent with none.
 */
export function AgentHooksSection({ hooks }: AgentHooksSectionProps) {
  const inline = hooks.flatMap((source) => (source.source.case === "inline" ? [source.source.value] : []));
  if (inline.length === 0) return null;
  return (
    <Section title="Hooks" count={inline.length}>
      <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:divide-y stg:divide-border")} aria-label="Hook sources">
        {inline.map((config, index) => (
          <li key={`inline:${index}`} className="stg:flex stg:min-w-0 stg:flex-col">
            <p className="stg:px-3 stg:pt-2.5 stg:text-sm stg:font-medium stg:text-foreground">Written in this agent</p>
            <HookConfigList config={config} />
          </li>
        ))}
      </ul>
    </Section>
  );
}
