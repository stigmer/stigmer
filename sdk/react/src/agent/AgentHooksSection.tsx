"use client";

// The agent page's Hooks section: which hooks guard this agent's tool calls,
// and every command they run. Each plugin source names its plugin (a link to
// the plugin's page) and lists the hooks the plugin recorded at install,
// read by reference; a plugin the server cannot read says that the agent's
// next run will be refused, which is what the runner does with a hook source
// it cannot load. The inline block reads "Written in this agent". Both lists
// are `HookConfigList`, the plugin page's.
//
// When the page is editable, the plugin sources are edited with the generic
// add form the Skills and MCP Servers sections use: remove a plugin, or type
// one in. The caller saves through `withPluginHooks`, so a plugin added here
// declares the variables its hooks read exactly as "Add to an agent" does.
// The inline block is shown, never edited: hand-written hooks are YAML, as
// Claude Code's settings files are. A sub-agent has no hooks of its own (it
// runs its parent's), so nothing here reads one. Pinned by
// `__tests__/AgentDetailView.hooks.test.tsx`.

import { useMemo } from "react";
import { cn } from "@stigmer/theme";
import type { HookSource } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { HookConfig } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { InlineEditResourceList } from "../inline-edit/InlineEditResourceList.js";
import type { ResourceRefRow } from "../inline-edit/types.js";
import { useOrgSlugForId } from "../organization/useOrgRefs.js";
import { HookConfigList } from "../plugin/HookConfigList.js";
import { PluginIcon } from "../plugin/PluginIcon.js";
import { usePlugin } from "../plugin/usePlugin.js";
import { Section } from "../resource-detail/Section.js";

/** Props for {@link AgentHooksSection}. */
export interface AgentHooksSectionProps {
  /** `AgentSpec.hooks`, in the agent's order. */
  readonly hooks: readonly HookSource[];
  /** The agent's organization id: a reference without an org belongs to it. */
  readonly agentOrg: string;
  /** Called when a plugin's name is selected; the host owns the route. */
  readonly onPluginClick?: (ref: { org: string; slug: string }) => void;
  /** Whether the plugin sources can be edited. */
  readonly editable?: boolean;
  readonly isSaving?: boolean;
  /** The last refused save, shown under the list. */
  readonly error?: string;
  /** Controlled editing state of the plugin list. */
  readonly editing?: boolean;
  readonly onEditingChange?: (editing: boolean) => void;
  /** Saves the plugin sources as listed; the inline block is kept by the caller. */
  readonly onSave?: (plugins: ResourceRefRow[]) => Promise<boolean>;
}

/**
 * Lists the hooks that guard an agent's tool calls, by source, with every
 * command each runs; renders nothing for a read-only agent with no hooks.
 */
export function AgentHooksSection({
  hooks,
  agentOrg,
  onPluginClick,
  editable = false,
  isSaving,
  error,
  editing = false,
  onEditingChange,
  onSave,
}: AgentHooksSectionProps) {
  const slugForOrg = useOrgSlugForId();
  const pluginRows: ResourceRefRow[] = useMemo(
    () =>
      hooks.flatMap((source) => {
        if (source.source.case !== "plugin") return [];
        const ref = source.source.value;
        const org = ref.org || agentOrg;
        return [{ org, slug: ref.slug, label: org !== agentOrg ? `${slugForOrg(org)}/${ref.slug}` : ref.slug }];
      }),
    [hooks, agentOrg, slugForOrg],
  );
  const inline = hooks.flatMap((source) => (source.source.case === "inline" ? [source.source.value] : []));

  if (!editable && hooks.length === 0) return null;
  const canEdit = editable && onSave !== undefined;

  return (
    <Section title="Hooks" count={hooks.length} onEdit={canEdit ? () => onEditingChange?.(!editing) : undefined}>
      {canEdit && editing ? (
        <InlineEditResourceList
          value={pluginRows}
          onSave={onSave}
          isSaving={isSaving}
          error={error}
          editing={editing}
          onEditingChange={onEditingChange}
          itemIcon={<PluginIcon className="stg:size-4" />}
          resourceLabel="plugin"
          defaultOrg={agentOrg}
        />
      ) : (
        <>
          {hooks.length === 0 && (
            <p className="stg:px-3 stg:py-2.5 stg:text-sm stg:text-muted-foreground">
              No hooks. Switch a plugin&apos;s hooks on to guard this agent&apos;s tool calls.
            </p>
          )}
          {(pluginRows.length > 0 || inline.length > 0) && (
            <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:divide-y stg:divide-border")} aria-label="Hook sources">
              {pluginRows.map((row) => (
                <PluginHooksRow key={`${row.org}/${row.slug}`} row={row} onPluginClick={onPluginClick} />
              ))}
              {inline.map((config, index) => (
                <InlineHooksRow key={`inline:${index}`} config={config} />
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="stg:px-3 stg:py-2 stg:text-sm stg:text-destructive">
              {error}
            </p>
          )}
        </>
      )}
    </Section>
  );
}

function PluginHooksRow({ row, onPluginClick }: { readonly row: ResourceRefRow; readonly onPluginClick?: (ref: { org: string; slug: string }) => void }) {
  const { plugin, isLoading, error } = usePlugin(row.org, row.slug);
  const name = plugin?.metadata?.name || row.label || row.slug;
  const hooks = plugin?.status?.hooks;
  return (
    <li className="stg:flex stg:min-w-0 stg:flex-col">
      <div className="stg:flex stg:items-center stg:gap-2 stg:px-3 stg:pt-2.5 stg:text-sm">
        <PluginIcon className="stg:size-4 stg:shrink-0 stg:text-muted-foreground" />
        {onPluginClick ? (
          <button
            type="button"
            onClick={() => onPluginClick({ org: row.org, slug: row.slug })}
            className="stg:rounded stg:font-medium stg:text-foreground stg:underline-offset-2 stg:hover:underline stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring"
          >
            {name}
          </button>
        ) : (
          <span className="stg:font-medium stg:text-foreground">{name}</span>
        )}
        <span className="stg:text-xs stg:text-muted-foreground">plugin</span>
      </div>
      {isLoading ? (
        <p className="stg:px-3 stg:py-2 stg:text-sm stg:text-muted-foreground">Reading the plugin&apos;s hooks…</p>
      ) : error !== null || plugin === null ? (
        <p role="note" className="stg:px-3 stg:py-2 stg:text-sm stg:text-destructive">
          This plugin could not be read; the agent&apos;s next run will be refused.
        </p>
      ) : hooks !== undefined && hooks.groups.length > 0 ? (
        <HookConfigList config={hooks} />
      ) : (
        <p className="stg:px-3 stg:py-2 stg:text-sm stg:text-muted-foreground">None of this plugin&apos;s hooks run on Stigmer.</p>
      )}
    </li>
  );
}

function InlineHooksRow({ config }: { readonly config: HookConfig }) {
  return (
    <li className="stg:flex stg:min-w-0 stg:flex-col">
      <p className="stg:px-3 stg:pt-2.5 stg:text-sm stg:font-medium stg:text-foreground">Written in this agent</p>
      <HookConfigList config={config} />
    </li>
  );
}
