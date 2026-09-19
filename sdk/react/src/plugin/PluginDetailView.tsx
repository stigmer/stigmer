"use client";

/**
 * The operational detail hub for an installed Plugin, and where an install
 * ends: every console route lands here after the push.
 *
 * A plugin is what you install; it installs an agent, tools for your
 * agents, or both. So this view shows what the install produced (the
 * members, by kind, each a link into its own detail page) and, for each
 * MCP server, what stands between it and its first tool call (signed in,
 * Sign in, a key to give, nothing: `McpServerReadiness`); what the manifest
 * said (version, format, author); what the server warned about at install;
 * and the version history. When the plugin carries an agent, the primary
 * action is to start a session on it; when it carries tools and no agent,
 * "Use these tools" leads to an agent that will. Nothing here edits a
 * member: a plugin's resources are changed by pushing the plugin again,
 * never one by one, and the members' own pages say so.
 *
 * The shape is `SkillDetailView`'s: the resource fetched inside, rendered
 * in `ResourceDetailShell` with Manage access folded into the kebab, the
 * host adding navigation through callbacks.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { PluginMember } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/io_pb";
import { PluginDialect, type PluginSpec } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/spec_pb";
import { PluginState, type PluginStatus } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { McpServerUsageInput } from "@stigmer/sdk";
import { DIALECT_LABELS } from "@stigmer/plugin-package/client";
import { useManageAccess } from "../access/useManageAccess.js";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { VisibilityBadge } from "../library/VisibilitySelector.js";
import { ResourceDetailShell } from "../resource-detail/ResourceDetailShell.js";
import { Section } from "../resource-detail/Section.js";
import type { AdditionalTab, DetailAction, ResourceHeaderMeta } from "../resource-detail/types.js";
import { useDetailTabs } from "../resource-detail/useDetailTabs.js";
import type { StatusPhase } from "../resource-workbench/types.js";
import type { TabItem } from "../tabs/Tabs.js";
import { VersionTimeline } from "../version-history/VersionTimeline.js";
import { Button } from "../button/Button.js";
import { AddToolsToAgentDialog } from "./AddToolsToAgentDialog.js";
import { McpServerReadiness } from "./McpServerReadiness.js";
import { PluginIcon } from "./PluginIcon.js";
import { usePlugin } from "./usePlugin.js";
import { usePluginMembers } from "./usePluginMembers.js";
import { usePluginVersions } from "./usePluginVersions.js";

const OVERVIEW_TAB: TabItem = { id: "overview", label: "Overview" };
const VERSIONS_TAB: TabItem = { id: "versions", label: "Versions" };

/** A member's reference as the host navigates to it. */
export interface PluginMemberRef {
  readonly org: string;
  readonly slug: string;
}

/** Props for {@link PluginDetailView}. */
export interface PluginDetailViewProps {
  /** Organization slug the plugin is installed in. */
  readonly org: string;
  /** Plugin slug (the plugin's name). */
  readonly slug: string;
  /** Called once when the plugin has been fetched, for breadcrumbs and titles. Not called on error or not-found. */
  readonly onResourceLoad?: (meta: { name: string; id: string }) => void;
  /**
   * Called when the user asks to start a session on the plugin's agent.
   * When provided and the plugin carries an agent, "Start session" is the
   * header's primary action; the host owns the route.
   */
  readonly onStartSession?: (agent: PluginMemberRef) => void;
  /** Called when a member row is selected; the host owns the route to each kind's page. */
  readonly onSkillClick?: (ref: PluginMemberRef) => void;
  readonly onMcpServerClick?: (ref: PluginMemberRef) => void;
  readonly onAgentClick?: (ref: PluginMemberRef) => void;
  readonly onWorkflowClick?: (ref: PluginMemberRef) => void;
  /**
   * Called from "Create a new agent with these tools" with the usages the
   * creation wizard preselects, for a plugin that installed MCP servers and
   * no agent. The host owns the route to its wizard; the link is hidden when
   * omitted, and "Add to an agent" still offers the organization's agents.
   */
  readonly onCreateAgent?: (usages: readonly McpServerUsageInput[]) => void;
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
 * Operational detail hub for an installed Plugin: what it installed, what
 * its manifest declares, what the server warned about, and its versions.
 *
 * @example
 * ```tsx
 * <PluginDetailView
 *   org="acme"
 *   slug="thermos"
 *   onStartSession={({ org, slug }) => router.push(getAgentSessionUrl(org, slug))}
 *   onSkillClick={({ org, slug }) => navigateToDetail("skills", org, slug)}
 *   onMcpServerClick={({ org, slug }) => navigateToDetail("mcp-servers", org, slug)}
 *   onAgentClick={({ org, slug }) => navigateToDetail("agents", org, slug)}
 *   onCreateAgent={(usages) => router.push(`/library/agents/new?mcp=${usages.map((u) => u.mcpServerRef.slug).join(",")}`)}
 * />
 * ```
 */
export function PluginDetailView({
  org,
  slug,
  onResourceLoad,
  onStartSession,
  onSkillClick,
  onMcpServerClick,
  onAgentClick,
  onWorkflowClick,
  onCreateAgent,
  actions,
  additionalTabs,
  activeTab,
  onTabChange,
  defaultTab,
  className,
}: PluginDetailViewProps) {
  const { plugin, isLoading, error, refetch } = usePlugin(org, slug);
  const pluginId = plugin?.metadata?.id ?? null;
  const members = usePluginMembers(pluginId);
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

  const agentMember = members.byKind.agents[0];
  const primaryAction = useMemo<DetailAction | undefined>(
    () =>
      onStartSession && agentMember
        ? {
            id: "start-session",
            label: "Start session",
            onAction: () => onStartSession({ org, slug: agentMember.slug }),
          }
        : undefined,
    [onStartSession, agentMember, org],
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
    status: status ? stateToPhase(status.state) : undefined,
    statusLabel: status ? stateLabel(status.state) : undefined,
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
    tabContent = (
      <PluginOverview
        plugin={plugin}
        members={members.members}
        membersError={members.error}
        onSkillClick={onSkillClick}
        onMcpServerClick={onMcpServerClick}
        onAgentClick={onAgentClick}
        onWorkflowClick={onWorkflowClick}
        onCreateAgent={onCreateAgent}
      />
    );
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
// Overview: what the manifest said, what the install produced, what it warned
// ---------------------------------------------------------------------------

function PluginOverview({
  plugin,
  members,
  membersError,
  onSkillClick,
  onMcpServerClick,
  onAgentClick,
  onWorkflowClick,
  onCreateAgent,
}: {
  readonly plugin: Plugin;
  readonly members: readonly PluginMember[];
  readonly membersError: Error | null;
  readonly onSkillClick?: (ref: PluginMemberRef) => void;
  readonly onMcpServerClick?: (ref: PluginMemberRef) => void;
  readonly onAgentClick?: (ref: PluginMemberRef) => void;
  readonly onWorkflowClick?: (ref: PluginMemberRef) => void;
  readonly onCreateAgent?: (usages: readonly McpServerUsageInput[]) => void;
}) {
  const org = plugin.metadata?.org ?? "";
  const spec = plugin.spec;
  const status = plugin.status;
  const warnings = status?.warnings ?? [];
  const hasAgent = members.some((member) => member.kind === ApiResourceKind.agent);
  const servers = useMemo(
    () =>
      members
        .filter((member) => member.kind === ApiResourceKind.mcp_server)
        .map((member) => ({ ref: { org, slug: member.slug }, name: member.name || member.slug })),
    [members, org],
  );
  const [adding, setAdding] = useState(false);

  return (
    <div className="stg:flex stg:flex-col stg:gap-6">
      {status !== undefined && status.state === PluginState.FAILED && status.error !== "" && (
        <ErrorMessage error={new Error(status.error)} title="The last install did not complete" />
      )}

      <Section title="Installed" count={members.length}>
        {membersError ? (
          <div className="stg:p-3">
            <ErrorMessage error={membersError} />
          </div>
        ) : members.length === 0 ? (
          <p className="stg:px-3 stg:py-2.5 stg:text-sm stg:text-muted-foreground">Nothing installed yet.</p>
        ) : (
          <div className="stg:flex stg:flex-col stg:divide-y stg:divide-border">
            {members.map((member) => (
              <MemberRow
                key={`${member.kind}:${member.id}`}
                member={member}
                onClick={clickFor(member.kind, { onSkillClick, onMcpServerClick, onAgentClick, onWorkflowClick })}
                org={org}
                keysAskedAt={hasAgent ? "agent" : "connect"}
              />
            ))}
          </div>
        )}
      </Section>

      {!hasAgent && servers.length > 0 && (
        <Section title="Use these tools">
          <div className="stg:flex stg:flex-wrap stg:items-center stg:justify-between stg:gap-3 stg:px-3 stg:py-2.5">
            <p className="stg:text-sm stg:text-muted-foreground">
              This plugin installed tools and no agent. Add them to an agent to use them in a session.
            </p>
            <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
              Add to an agent
            </Button>
          </div>
          <AddToolsToAgentDialog
            org={org}
            servers={servers}
            open={adding}
            onClose={() => setAdding(false)}
            onAgentClick={onAgentClick}
            onCreateAgent={onCreateAgent}
          />
        </Section>
      )}

      {spec && <ManifestSection spec={spec} status={status} />}

      {warnings.length > 0 && (
        <Section title="Install warnings" count={warnings.length}>
          <ul className={cn(UNSTYLED_LIST, "stg:flex stg:flex-col stg:divide-y stg:divide-border")}>
            {warnings.map((warning, index) => (
              <li key={`${warning.kind}:${warning.path}:${index}`} className="stg:px-3 stg:py-2 stg:text-sm stg:text-foreground">
                {warning.message}
                {warning.path && <span className="stg:ml-2 stg:font-mono stg:text-xs stg:text-muted-foreground">{warning.path}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
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

function MemberRow({
  member,
  org,
  onClick,
  keysAskedAt,
}: {
  readonly member: PluginMember;
  readonly org: string;
  readonly onClick?: (ref: PluginMemberRef) => void;
  /** Where an MCP server's declared variables are given; passed to its readiness cell. */
  readonly keysAskedAt: "agent" | "connect";
}) {
  const row = (
    <div className="stg:flex stg:items-center stg:gap-3">
      <span className="stg:w-24 stg:shrink-0 stg:text-xs stg:uppercase stg:tracking-wider stg:text-muted-foreground">
        {kindLabel(member.kind)}
      </span>
      <span className="stg:text-sm stg:font-medium stg:text-foreground">{member.name || member.slug}</span>
      {member.name && member.name !== member.slug && (
        <span className="stg:font-mono stg:text-xs stg:text-muted-foreground">{member.slug}</span>
      )}
    </div>
  );
  const link = onClick ? (
    <button
      type="button"
      onClick={() => onClick({ org, slug: member.slug })}
      className={cn(
        "stg:min-w-0 stg:flex-1 stg:px-3 stg:py-2 stg:text-left stg:transition-colors",
        "stg:hover:bg-accent-hover",
        "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
      )}
    >
      {row}
    </button>
  ) : (
    <div className="stg:min-w-0 stg:flex-1 stg:px-3 stg:py-2">{row}</div>
  );
  // The readiness cell is the link's sibling, never its child: it carries a
  // button of its own, and a button inside a button is not markup a browser
  // or a screen reader agrees on.
  if (member.kind !== ApiResourceKind.mcp_server) return link;
  return (
    <div className="stg:flex stg:items-center stg:gap-3">
      {link}
      <McpServerReadiness org={org} slug={member.slug} keysAskedAt={keysAskedAt} className="stg:shrink-0 stg:pr-3" />
    </div>
  );
}

function clickFor(
  kind: ApiResourceKind,
  handlers: {
    readonly onSkillClick?: (ref: PluginMemberRef) => void;
    readonly onMcpServerClick?: (ref: PluginMemberRef) => void;
    readonly onAgentClick?: (ref: PluginMemberRef) => void;
    readonly onWorkflowClick?: (ref: PluginMemberRef) => void;
  },
): ((ref: PluginMemberRef) => void) | undefined {
  switch (kind) {
    case ApiResourceKind.skill:
      return handlers.onSkillClick;
    case ApiResourceKind.mcp_server:
      return handlers.onMcpServerClick;
    case ApiResourceKind.agent:
      return handlers.onAgentClick;
    case ApiResourceKind.workflow:
      return handlers.onWorkflowClick;
    default:
      return undefined;
  }
}

/** The vocabulary's word for each member kind; the CLI's install summary uses the same. */
export function kindLabel(kind: ApiResourceKind): string {
  switch (kind) {
    case ApiResourceKind.skill:
      return "Skill";
    case ApiResourceKind.mcp_server:
      return "MCP server";
    case ApiResourceKind.agent:
      return "Agent";
    case ApiResourceKind.workflow:
      return "Workflow";
    default:
      return ApiResourceKind[kind] ?? String(kind);
  }
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

function stateToPhase(state: PluginState): StatusPhase | undefined {
  switch (state) {
    case PluginState.READY:
      return "ready";
    case PluginState.FAILED:
      return "failed";
    case PluginState.INSTALLING:
      return "pending";
    case PluginState.UNSPECIFIED:
      return undefined;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function stateLabel(state: PluginState): string | undefined {
  switch (state) {
    case PluginState.READY:
      return "Installed";
    case PluginState.FAILED:
      return "Failed";
    case PluginState.INSTALLING:
      return "Installing";
    case PluginState.UNSPECIFIED:
      return undefined;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function LoadingSkeleton({ className }: { readonly className?: string }) {
  return (
    <div className={cn("stg:flex stg:flex-col stg:gap-6", className)} aria-busy="true" aria-label="Loading plugin details">
      <div className="stg:flex stg:items-start stg:gap-3">
        <div className="stg:mt-1 stg:size-6 stg:shrink-0 stg:animate-pulse stg:rounded stg:bg-muted" />
        <div className="stg:flex-1 stg:space-y-2">
          <div className="stg:h-5 stg:w-48 stg:animate-pulse stg:rounded stg:bg-muted" />
          <div className="stg:h-3 stg:w-64 stg:animate-pulse stg:rounded stg:bg-muted" />
        </div>
      </div>
      <div className="stg:h-24 stg:animate-pulse stg:rounded-lg stg:bg-muted" />
    </div>
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
