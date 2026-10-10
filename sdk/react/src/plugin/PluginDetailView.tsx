"use client";

/**
 * The operational detail hub for an installed Plugin, and where an install
 * ends: every console route lands here after the push.
 *
 * A plugin is one thing, used whole: an agent or a conversation lists it
 * and gets its skills, its agents, its hooks and its MCP servers. So this
 * view says what the plugin holds, from the lists its status recorded at
 * install (nothing is installed beside it), and offers the two ways to use
 * it: "Start a chat" (a conversation with the assistant that lists the
 * plugin, through the host's route) and "Add to an agent" (the plugin put
 * on one of the organization's agents). Each MCP server shows how it is
 * reached, what stands between it and its first tool call (signed in, Sign
 * in, a key to give: `PluginServerSignIn`, over the person's My vault), and
 * "Check tools", which lists the server's tools now. The skills and agents
 * are listed by the names a turn uses (`<plugin>:<skill>`); the hooks with
 * every command each runs (`HookConfigList`), beside the hooks Stigmer
 * does not run (the warnings of `HOOK_WARNING_KINDS`); the keys the plugin
 * declares; what the manifest said; what else the push warned about; and
 * the version history. Nothing here edits the plugin: it changes by being
 * pushed again.
 *
 * The shape is `SkillDetailView`'s: the resource fetched inside, rendered
 * in `ResourceDetailShell` with Manage access folded into the kebab, the
 * host adding navigation through callbacks.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginDialect, type PluginSpec } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/spec_pb";
import type { PluginStatus, PluginWarning } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ResourceRef } from "@stigmer/sdk";
import { HOOK_WARNING_KINDS } from "@stigmer/plugin-package";
import { DIALECT_LABELS } from "@stigmer/plugin-package/client";
import { useManageAccess } from "../access/useManageAccess.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { VisibilityBadge } from "../library/VisibilitySelector.js";
import { ResourceDetailShell } from "../resource-detail/ResourceDetailShell.js";
import { Section } from "../resource-detail/Section.js";
import type { AdditionalTab, DetailAction, ResourceHeaderMeta } from "../resource-detail/types.js";
import { useDetailTabs } from "../resource-detail/useDetailTabs.js";
import type { TabItem } from "../tabs/Tabs.js";
import { VersionTimeline } from "../version-history/VersionTimeline.js";
import { Button } from "../button/Button.js";
import { AddPluginToAgentDialog } from "./AddPluginToAgentDialog.js";
import { HookConfigList } from "./HookConfigList.js";
import { PluginIcon } from "./PluginIcon.js";
import { summariseInstall } from "./PluginInstallDialog.js";
import { PluginServerRow } from "./PluginServerRow.js";
import { usePlugin } from "./usePlugin.js";
import { usePluginVersions } from "./usePluginVersions.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";

const OVERVIEW_TAB: TabItem = { id: "overview", label: "Overview" };
const VERSIONS_TAB: TabItem = { id: "versions", label: "Versions" };

/** Props for {@link PluginDetailView}. */
export interface PluginDetailViewProps {
  /** Id of the organization the plugin is installed in (a slug is also accepted). */
  readonly org: string;
  /** Plugin slug (the plugin's name). */
  readonly slug: string;
  /** Called once when the plugin has been fetched, for breadcrumbs and titles. Not called on error or not-found. */
  readonly onResourceLoad?: (meta: { name: string; id: string }) => void;
  /**
   * Called from "Start a chat" with the plugin's reference: the host opens
   * a new conversation with the assistant whose `plugins` list it. When
   * provided, "Start a chat" is the header's primary action.
   */
  readonly onStartChat?: (plugin: ResourceRef) => void;
  /** Called from "Open agent" after the plugin was added to one; the host owns the route. */
  readonly onAgentClick?: (ref: ResourceRef) => void;
  /** Secondary actions rendered in the kebab overflow menu (remove lives here). */
  readonly actions?: readonly DetailAction[];
  /** Additional tabs beside the built-in Overview and Versions. */
  readonly additionalTabs?: readonly AdditionalTab[];
  readonly activeTab?: string;
  readonly onTabChange?: (tabId: string) => void;
  /** @default "overview" */
  readonly defaultTab?: string;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Operational detail hub for an installed Plugin: what it holds, how to
 * use it, each server's sign-in and tools, its hooks, what its manifest
 * declares, what the push warned about, and its versions.
 *
 * @example
 * ```tsx
 * <PluginDetailView
 *   org="acme"
 *   slug="linear"
 *   onStartChat={({ org, slug }) => router.push(getPluginChatUrl(org, slug))}
 *   onAgentClick={({ org, slug }) => navigateToDetail("agents", org, slug)}
 * />
 * ```
 */
export function PluginDetailView({
  org,
  slug,
  onResourceLoad,
  onStartChat,
  onAgentClick,
  actions,
  additionalTabs,
  activeTab,
  onTabChange,
  defaultTab,
  className,
}: PluginDetailViewProps) {
  const { plugin, isLoading, error, refetch } = usePlugin(org, slug);
  const { versions, isEmpty: noVersions } = usePluginVersions(org, slug);

  const builtInTabs = useMemo<readonly TabItem[]>(
    () => (noVersions ? [OVERVIEW_TAB] : [OVERVIEW_TAB, VERSIONS_TAB]),
    [noVersions],
  );
  const { effectiveTabs, effectiveActiveTab, effectiveOnTabChange, activeAdditionalTab } = useDetailTabs({
    builtInTabs,
    additionalTabs,
    activeTab,
    onTabChange,
    defaultTab,
  });

  const onResourceLoadRef = useRef(onResourceLoad);
  onResourceLoadRef.current = onResourceLoad;
  useEffect(() => {
    if (plugin?.metadata?.name) {
      onResourceLoadRef.current?.({ name: plugin.metadata.name, id: plugin.metadata.id });
    }
  }, [plugin]);

  const access = useManageAccess({
    resource: plugin?.metadata
      ? {
          kind: ApiResourceKind.plugin,
          kindString: "plugin",
          id: plugin.metadata.id,
          org: plugin.metadata.org,
          name: plugin.metadata.name,
        }
      : null,
    visibility: plugin?.metadata
      ? { kind: "plugin", current: plugin.metadata.visibility, org: plugin.metadata.org, onChanged: refetch }
      : undefined,
  });

  const pluginOrg = plugin?.metadata?.org || org;
  const pluginSlug = plugin?.metadata?.slug || slug;
  const primaryAction = useMemo<DetailAction | undefined>(
    () =>
      onStartChat
        ? {
            id: "start-chat",
            label: "Start a chat",
            onAction: () => onStartChat({ org: pluginOrg, slug: pluginSlug }),
          }
        : undefined,
    [onStartChat, pluginOrg, pluginSlug],
  );

  if (isLoading) return <LoadingSkeleton className={className} />;
  if (error) return <ErrorMessage error={error} retry={refetch} className={className} />;
  if (!plugin) return <NotFoundState className={className} />;

  const meta = plugin.metadata;
  const status = plugin.status;
  const specAudit = status?.audit?.specAudit;

  const headerMeta: ResourceHeaderMeta = {
    name: meta?.name || meta?.slug || "Untitled",
    id: meta?.id || "",
    org: meta?.org,
    slug: meta?.slug,
    description: plugin.spec?.description || undefined,
    icon: <PluginIcon className="stg:size-6 stg:text-muted-foreground" />,
    createdAt: specAudit?.createdAt ? timestampDate(specAudit.createdAt) : null,
    updatedAt: specAudit?.updatedAt ? timestampDate(specAudit.updatedAt) : null,
  };

  const visibilityControl = meta ? (
    <VisibilityBadge visibility={meta.visibility} onClick={access.action ? access.open : undefined} />
  ) : undefined;
  const mergedActions = access.action ? [...(actions ?? []), access.action] : actions;

  let tabContent: React.ReactNode;
  if (activeAdditionalTab) {
    tabContent = activeAdditionalTab.content;
  } else if (effectiveActiveTab === "versions" && versions.length > 0) {
    tabContent = <VersionTimeline entries={versions} />;
  } else {
    tabContent = <PluginOverview plugin={plugin} org={org} onStartChat={onStartChat} onAgentClick={onAgentClick} />;
  }

  return (
    <>
      <ResourceDetailShell
        header={headerMeta}
        visibilityControl={visibilityControl}
        primaryAction={primaryAction}
        actions={mergedActions}
        tabs={effectiveTabs}
        activeTab={effectiveTabs ? effectiveActiveTab : undefined}
        onTabChange={effectiveTabs ? effectiveOnTabChange : undefined}
        tabsAriaLabel="Plugin detail sections"
        className={className}
      >
        {tabContent}
      </ResourceDetailShell>
      {access.dialog}
    </>
  );
}

// ---------------------------------------------------------------------------
// Overview: what the plugin holds, how to use it, what the push warned
// ---------------------------------------------------------------------------

function PluginOverview({
  plugin,
  org,
  onStartChat,
  onAgentClick,
}: {
  readonly plugin: Plugin;
  /** The organization the page is viewed in: its runner lists tools, and My vault there holds logins. */
  readonly org: string;
  readonly onStartChat?: (plugin: ResourceRef) => void;
  readonly onAgentClick?: (ref: ResourceRef) => void;
}) {
  const pluginOrg = plugin.metadata?.org || org;
  const slug = plugin.metadata?.slug ?? "";
  const name = plugin.metadata?.name || slug;
  const pluginId = plugin.metadata?.id ?? "";
  const spec = plugin.spec;
  const status = plugin.status;
  const servers = status?.mcpServers ?? [];
  const skills = status?.skills ?? [];
  const agents = status?.agents ?? [];
  const hookConfig = status?.hooks !== undefined && status.hooks.groups.length > 0 ? status.hooks : undefined;
  const hookWarnings = (status?.warnings ?? []).filter((warning) => isHookWarning(warning.kind));
  const warnings = (status?.warnings ?? []).filter((warning) => !isHookWarning(warning.kind));
  const variables = Object.entries(status?.env ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const offer = useMemo(
    () => ({ plugin: { org: pluginOrg, slug }, name, servers: servers.map((server) => server.name) }),
    [pluginOrg, slug, name, servers],
  );
  const [adding, setAdding] = useState(false);

  return (
    <div className="stg:flex stg:flex-col stg:gap-6">
      <Section title="Use this plugin">
        <div className="stg:flex stg:flex-wrap stg:items-center stg:justify-between stg:gap-3 stg:px-3 stg:py-2.5">
          <p className="stg:text-sm stg:text-muted-foreground">
            Holds {summariseInstall({ plugin })}. A chat or an agent that uses it gets all of it.
          </p>
          <span className="stg:flex stg:flex-wrap stg:gap-2">
            {onStartChat && (
              <Button variant="outline" size="sm" onClick={() => onStartChat({ org: pluginOrg, slug })}>
                Start a chat
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
              Add to an agent
            </Button>
          </span>
        </div>
        <AddPluginToAgentDialog
          org={pluginOrg}
          offer={offer}
          open={adding}
          onClose={() => setAdding(false)}
          onAgentClick={onAgentClick}
        />
      </Section>

      {servers.length > 0 && (
        <Section title="MCP servers" count={servers.length}>
          <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:divide-y stg:divide-border")} aria-label="MCP servers">
            {servers.map((server) => (
              <PluginServerRow key={server.name} org={org} pluginId={pluginId} pluginName={name} server={server} />
            ))}
          </ul>
        </Section>
      )}

      {skills.length > 0 && (
        <Section title="Skills" count={skills.length}>
          <NamedList
            label="Skills"
            items={skills.map((skill) => ({ name: skill.name, turnName: `${name}:${skill.name}`, description: skill.description }))}
          />
        </Section>
      )}

      {agents.length > 0 && (
        <Section title="Agents" count={agents.length}>
          <NamedList
            label="Agents"
            items={agents.map((agent) => ({ name: agent.name, turnName: `${name}:${agent.name}`, description: agent.description }))}
          />
        </Section>
      )}

      {(hookConfig !== undefined || hookWarnings.length > 0) && (
        <Section title="Hooks" count={hookConfig?.groups.length}>
          {hookConfig !== undefined ? (
            <HookConfigList config={hookConfig} />
          ) : (
            <p className="stg:px-3 stg:py-2.5 stg:text-sm stg:text-muted-foreground">None of this plugin&apos;s hooks run on Stigmer.</p>
          )}
          {hookWarnings.length > 0 && (
            <div className="stg:border-t stg:border-border">
              <h4 className="stg:px-3 stg:pt-2.5 stg:text-xs stg:font-medium stg:text-muted-foreground">Not run on Stigmer</h4>
              <WarningList warnings={hookWarnings} label="Hooks not run on Stigmer" />
            </div>
          )}
        </Section>
      )}

      {variables.length > 0 && (
        <Section title="Keys" count={variables.length}>
          <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:divide-y stg:divide-border")} aria-label="Keys this plugin reads">
            {variables.map(([key, declaration]) => (
              <li key={key} className="stg:flex stg:flex-wrap stg:items-baseline stg:gap-x-2 stg:px-3 stg:py-2 stg:text-sm">
                <code className="stg:font-mono stg:text-xs stg:text-foreground">{key}</code>
                <span className="stg:text-xs stg:text-muted-foreground">
                  {[declaration.isSecret ? "secret" : "setting", declaration.optional ? "optional" : "required"].join(", ")}
                </span>
                {declaration.description && <span className="stg:text-xs stg:text-muted-foreground">{declaration.description}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {spec && <ManifestSection spec={spec} status={status} />}

      {warnings.length > 0 && (
        <Section title="Install warnings" count={warnings.length}>
          <WarningList warnings={warnings} />
        </Section>
      )}
    </div>
  );
}

/** Skills or agents by their own name and the name a turn uses, each with what it is for. */
function NamedList({
  label,
  items,
}: {
  readonly label: string;
  readonly items: readonly { readonly name: string; readonly turnName: string; readonly description: string }[];
}) {
  return (
    <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:divide-y stg:divide-border")} aria-label={label}>
      {items.map((item) => (
        <li key={item.name} className="stg:flex stg:flex-col stg:gap-0.5 stg:px-3 stg:py-2">
          <span className="stg:flex stg:flex-wrap stg:items-baseline stg:gap-x-2">
            <span className="stg:text-sm stg:font-medium stg:text-foreground">{item.name}</span>
            <span className="stg:font-mono stg:text-xs stg:text-muted-foreground">{item.turnName}</span>
          </span>
          {item.description && <span className="stg:text-xs stg:text-muted-foreground">{item.description}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Whether an install warning names a hook Stigmer does not run; the wire carries the library's kind verbatim. */
function isHookWarning(kind: string): boolean {
  const hookKinds: ReadonlySet<string> = HOOK_WARNING_KINDS;
  return hookKinds.has(kind);
}

function WarningList({ warnings, label }: { readonly warnings: readonly PluginWarning[]; readonly label?: string }) {
  return (
    <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:divide-y stg:divide-border")} aria-label={label}>
      {warnings.map((warning, index) => (
        <li key={`${warning.kind}:${warning.path}:${index}`} className="stg:px-3 stg:py-2 stg:text-sm stg:text-foreground">
          {warning.message}
          {warning.path && <span className="stg:ml-2 stg:font-mono stg:text-xs stg:text-muted-foreground">{warning.path}</span>}
        </li>
      ))}
    </ul>
  );
}

function ManifestSection({ spec, status }: { readonly spec: PluginSpec; readonly status: PluginStatus | undefined }) {
  const rows: readonly (readonly [string, string])[] = [
    ["Version", spec.version],
    ["Format", dialectLabel(spec.dialect)],
    ["Author", [spec.author?.name, spec.author?.email && `<${spec.author.email}>`].filter(Boolean).join(" ")],
    ["Homepage", spec.homepage],
    ["Repository", spec.repository],
    ["License", spec.license],
    ["Digest", status?.digest ? status.digest.slice(0, 12) : ""],
  ];
  const present = rows.filter(([, value]) => value !== "");
  if (present.length === 0) return null;
  return (
    <Section title="Manifest">
      <dl className="stg:grid stg:grid-cols-[auto_1fr] stg:gap-x-6 stg:gap-y-1.5 stg:px-3 stg:py-2.5 stg:text-sm">
        {present.map(([label, value]) => (
          <div key={label} className="stg:contents">
            <dt className="stg:text-muted-foreground">{label}</dt>
            <dd className={cn("stg:min-w-0 stg:break-words stg:text-foreground", label === "Digest" && "stg:font-mono stg:text-xs")}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

function dialectLabel(dialect: PluginDialect): string {
  switch (dialect) {
    case PluginDialect.AGENT_PLUGINS:
      return DIALECT_LABELS["agent-plugins"];
    case PluginDialect.CLAUDE:
      return DIALECT_LABELS.claude;
    case PluginDialect.CURSOR:
      return DIALECT_LABELS.cursor;
    case PluginDialect.CODEX:
      return DIALECT_LABELS.codex;
    case PluginDialect.UNSPECIFIED:
      return "";
    default: {
      const exhaustive: never = dialect;
      return String(exhaustive);
    }
  }
}

function LoadingSkeleton({ className }: { readonly className?: string }) {
  return (
    <LoadingRegion className={cn("stg:flex stg:flex-col stg:gap-6", className)} label="Loading plugin details">
      <div className="stg:flex stg:items-start stg:gap-3">
        <div className="stg:mt-1 stg:size-6 stg:shrink-0 stg:animate-pulse stg:rounded stg:bg-muted" />
        <div className="stg:flex-1 stg:space-y-2">
          <div className="stg:h-5 stg:w-48 stg:animate-pulse stg:rounded stg:bg-muted" />
          <div className="stg:h-3 stg:w-64 stg:animate-pulse stg:rounded stg:bg-muted" />
        </div>
      </div>
      <div className="stg:h-24 stg:animate-pulse stg:rounded-lg stg:bg-muted" />
    </LoadingRegion>
  );
}

function NotFoundState({ className }: { readonly className?: string }) {
  return (
    <div role="status" className={cn("stg:flex stg:flex-col stg:items-center stg:gap-2 stg:py-12 stg:text-center", className)}>
      <PluginIcon className="stg:size-10 stg:text-muted-foreground-faint" />
      <p className="stg:text-sm stg:font-medium stg:text-muted-foreground">Plugin not installed</p>
      <p className="stg:text-xs stg:text-muted-foreground">No plugin with this name is installed in the organization.</p>
    </div>
  );
}
