"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/design-tokens";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { ApiResourceReference } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import type { EnvVarDeclaration } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/declaration_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useAgent } from "./useAgent.js";
import { useUpdateAgent } from "./useUpdateAgent.js";
import {
  buildAgentProto,
  deletedReferenceLabel,
  isDeletedReference,
} from "@stigmer/client";
import { maskedEdit, saveErrorMessage } from "@stigmer/react-core/internal";
import { EmptyState } from "../empty-state/EmptyState.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { Tag } from "../internal/surface/Tag.js";
import { VisibilityBadge } from "../library/VisibilitySelector.js";
import { useManageAccess } from "../access/useManageAccess.js";
import { useCheckPermission } from "../grant/useCheckPermission.js";
import { useChannelList } from "../channel/useChannelList.js";
import { AgentProfileHeader } from "./AgentProfileHeader.js";
import type { Channel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelsPanel } from "../channel/ChannelsPanel.js";
import { ResourceDetailShell } from "../resource-detail/ResourceDetailShell.js";
import { Section } from "../resource-detail/Section.js";
import { useDetailTabs } from "../resource-detail/useDetailTabs.js";
import type { AdditionalTab, DetailAction, ResourceHeaderMeta } from "../resource-detail/types.js";
import type { TabItem } from "../tabs/Tabs.js";
import { DependencyGraph } from "../dependency-graph/DependencyGraph.js";
import { useDependencyGraph } from "../dependency-graph/useDependencyGraph.js";
import { AgentToolLists, hasToolLists } from "./AgentToolLists.js";
import { AgentHooksSection } from "./AgentHooksSection.js";
import { AgentSubagentsSection } from "./AgentSubagentsSection.js";
import { AgentMcpServersSection } from "./AgentMcpServersSection.js";
import { AgentRunDefaultsSection, type AgentRunDefaultsSave } from "./AgentRunDefaultsSection.js";
import { AgentEnvironmentSection } from "./AgentEnvironmentSection.js";
import type { DependencyNode } from "../dependency-graph/types.js";
import { InlineEditTextarea } from "../inline-edit/InlineEditTextarea.js";
import { InlineEditImage } from "../inline-edit/InlineEditImage.js";
import { InlineEditKeyValue } from "../inline-edit/InlineEditKeyValue.js";
import { InlineEditResourceList } from "../inline-edit/InlineEditResourceList.js";
import type { KeyValueRow, ResourceRefRow } from "../inline-edit/types.js";
import { ManagedByPluginNotice } from "../plugin/ManagedByPluginNotice.js";
import { PluginIcon } from "../plugin/PluginIcon.js";
import { useManagingPlugin } from "../plugin/useManagingPlugin.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";
import { useOrgIdForRef, useOrgSlugForId } from "../organization/useOrgRefs.js";
import { AgentQualityTab } from "./AgentQualityTab.js";
import { EvalRunsTab } from "../eval-run/EvalRunsTab.js";
import { AgentVersionsTab } from "./AgentVersionsTab.js";
import { useAgentVersionCount } from "./useAgentVersions.js";
import { ResourceSlugField } from "../resource-detail/RenameSlugField.js";
import { useExportResource } from "../library/useExportResource.js";
import { EditResourceYamlDialog } from "../manifest/EditResourceYamlDialog.js";
import { keptReference } from "../internal/kept-reference.js";
import type { RenamedResource } from "../resource-detail/useRenameResource.js";
import { MakeItYoursTab, type MakeItYoursLinks } from "../journey/MakeItYoursTab.js";
import { isJourneyAgentSlug } from "@stigmer/examples/journey";
import { InAppTab, type InAppLinks } from "../app-handover/InAppTab.js";

const INSTRUCTIONS_COLLAPSED_HEIGHT = "12rem";

const MAKE_IT_YOURS_TAB: TabItem = { id: "make-it-yours", label: "Make it yours" };
const OVERVIEW_TAB: TabItem = { id: "overview", label: "Overview" };
const IN_APP_TAB: TabItem = { id: "in-app", label: "In your app" };
const CHANNELS_TAB: TabItem = { id: "channels", label: "Channels" };
const QUALITY_TAB: TabItem = { id: "quality", label: "Quality" };
const EVALS_TAB: TabItem = { id: "evals", label: "Evals" };
const DEPENDENCIES_TAB: TabItem = { id: "dependencies", label: "Dependencies" };
const VERSIONS_TAB: TabItem = { id: "versions", label: "Versions" };

/** Props for {@link AgentDetailView}. */
export interface AgentDetailViewProps {
  /** Id of the organization that owns the agent (a slug is also accepted). */
  readonly org: string;
  /** Agent slug (URL-friendly identifier unique within the org). */
  readonly slug: string;
  /**
   * Called when a skill reference is clicked.
   * Provides `org` and `slug` of the referenced skill.
   */
  readonly onSkillClick?: (ref: { org: string; slug: string }) => void;
  /**
   * Called on every load of the agent: the first, and each refetch after an
   * edit made in this view. Provides its display name, id and current slug
   * for breadcrumbs, document titles, or an address that follows the
   * agent's slug (after a YAML apply renames it, the refetch by the old
   * slug answers the new one), without requiring the consumer to also call
   * {@link useAgent}.
   *
   * Not called on error or not-found states.
   */
  readonly onResourceLoad?: (meta: { name: string; id: string; slug: string }) => void;
  /**
   * Primary action rendered as a visible button in the header area.
   * Typically "Edit" for agent detail pages.
   */
  readonly primaryAction?: DetailAction;
  /**
   * Secondary actions rendered in the kebab overflow menu.
   * Typically: Copy ID, Copy slug, Duplicate, Delete. An act that changes
   * the agent declares the relation it needs (`requires: "can_delete"` for
   * Delete) and is offered only on the server's yes for this agent, as is
   * the view's own Edit YAML (`yamlActions`, `requires: "can_edit"`).
   */
  readonly actions?: readonly DetailAction[];
  /**
   * When `true`, the kebab menu also offers Edit YAML, Export YAML, Export
   * JSON and Download YAML, each reading the agent this view shows: the
   * editor opens on what is stored, after any edit made on the page, and an
   * apply shows here at once. They sit after the host's `actions` and
   * before its first `"destructive"` one. Edit YAML is offered only while
   * the agent is editable, so never for an agent a plugin installed.
   * @default false
   */
  readonly yamlActions?: boolean;
  /**
   * Additional tabs to render alongside the built-in "Overview" tab.
   * When provided (with at least one entry), a tab bar appears.
   * When omitted or empty, no tab bar is shown (single-tab suppression).
   *
   * Each entry provides both the tab metadata and the content to render.
   * The SDK manages the tab switching logic internally.
   *
   * @example
   * ```tsx
   * <AgentDetailView
   *   org="acme"
   *   slug="my-agent"
   *   additionalTabs={[
   *     { id: "dependencies", label: "Dependencies", content: <DependencyGraph /> },
   *   ]}
   * />
   * ```
   */
  readonly additionalTabs?: readonly AdditionalTab[];
  /**
   * Controlled active tab ID. When provided together with `onTabChange`,
   * the component operates in controlled mode — the consumer owns tab state.
   * When omitted, the component manages its own internal tab state.
   */
  readonly activeTab?: string;
  /**
   * Controlled tab change handler. When provided together with `activeTab`,
   * the component operates in controlled mode.
   */
  readonly onTabChange?: (tabId: string) => void;
  /**
   * Default active tab ID when in uncontrolled mode.
   * @default "overview"
   */
  readonly defaultTab?: string;
  /**
   * Called when a plugin is selected: one the agent lists in its Plugins
   * section or its dependency graph, or the one named in the "installed
   * by a plugin" notice. The host owns the route to the plugin's page. The
   * notice shows when this resource carries a live plugin's label, and
   * `editable` is then narrowed to `false`: the server refuses a client
   * edit of a plugin's resource, so no edit form is offered.
   */
  readonly onPluginClick?: (ref: { org: string; slug: string }) => void;
  /**
   * Called when an agent this agent lists as a subagent is selected, in its
   * Subagents section or its dependency graph. The host owns the route to
   * that agent's page; without it the rows are not links.
   */
  readonly onAgentClick?: (ref: { org: string; slug: string }) => void;
  /**
   * When `true`, this host allows editing: fields on the detail view become
   * click-to-edit for a person the server lets edit the agent (`can_edit`,
   * asked by the view; a reader sees a read-only page from the first
   * frame). Each field saves independently via `stigmer.agent.update()`,
   * naming only that field and carrying the etag the agent was loaded at.
   * @default false
   */
  readonly editable?: boolean;
  /**
   * Called after a successful inline field save with the updated agent.
   * Consumers can use this to refresh breadcrumbs, sync URL state, etc.
   */
  readonly onResourceUpdated?: (agent: import("@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb").Agent) => void;
  /**
   * Fired with the renamed agent after a rename from the Overview tab's
   * slug field (shown when `editable` and the caller may delete the
   * agent). A host whose address names the slug moves it to the new one;
   * the old slug keeps leading to the agent for 30 days.
   */
  readonly onRenamed?: (agent: import("@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb").Agent) => void;
  /**
   * Builds the absolute public chat URL for the chat links in the
   * Channels tab. The host application owns URL construction — its
   * configured public origin may differ from the rendering origin (e.g.
   * the desktop app). It receives the channel's id (`metadata.id`), the
   * one identity a link carries. When omitted, chat links fall back to
   * the relative `/chat/<channel id>` path.
   */
  readonly buildChatLinkUrl?: (channelId: string) => string;
  /**
   * Where the host manages Channel Apps (the console passes
   * `/settings/channel-apps`), for the Channels tab's Slack and WhatsApp
   * connect dialogs. Absent, their "Register a channel app" affordance
   * degrades to plain guidance text.
   */
  readonly channelAppsHref?: string;
  /**
   * Maps a session id to the host's session route, for the Channels tab's
   * Sessions dialog. Absent, its rows render without links.
   */
  readonly sessionHref?: (sessionId: string) => string;
  /**
   * The host's hand-off for redirect-style installs (Slack) from the
   * Channels tab, for a host whose webview cannot open the OAuth popup
   * (the desktop app opens the web console in the system browser). Called
   * with the channel being reconnected, or `null` for a new connection.
   */
  readonly onConnectExternal?: (channel: Channel | null) => void;
  /**
   * Called with a run id when the user opens one of an eval's tries from
   * the Evals tab, or a flagged run from the Quality tab; the host owns the
   * route. Tries and flagged runs are listed without links when omitted.
   */
  readonly onNavigateToRun?: (runId: string) => void;
  /**
   * Offer the "Make it yours" tab, with the host's routes for its acts:
   * drawn first among the tabs for an agent the journey made (an example's
   * agent, or one described in the person's own words) that the viewer may
   * edit (`editable`, the server's `can_edit`, not a plugin's). It changes
   * the instructions and adds a ready-made skill through this view's own
   * save, so Overview shows each change at once, and links the launcher for
   * a run on the sample or on the person's own file. The page opens on it
   * only when asked (`activeTab` or `defaultTab` `"make-it-yours"`); the
   * console's links say `?tab=make-it-yours`. Without it, no tab.
   */
  readonly makeItYours?: MakeItYoursLinks;
  /**
   * Offer the "In your app" tab, with the host's settings routes: what puts
   * this agent's chat in the builder's own product (the token route and the
   * chat for their stack, the service account and sign-in setting they
   * need, and the first person their app signs in), drawn after Overview
   * for every agent the viewer can see. The console's links say
   * `?tab=in-app`. Without it, no tab.
   */
  readonly inApp?: InAppLinks;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Operational detail hub for an Agent blueprint.
 *
 * Fetches the agent via {@link useAgent} internally and renders its
 * full configuration inside a {@link ResourceDetailShell}: a
 * standardized header with action bar, followed by structured content
 * sections (instructions, plugins, the agent's own MCP servers, tool
 * lists, hooks, skills, subagents, and environment variables). The MCP
 * servers are edited only by the organization's admins
 * ({@link AgentMcpServersSection}). Sections with no data are
 * omitted entirely — reducing visual noise per Nielsen heuristic #8.
 * The Evals tab runs test cases on the agent, with and without a plugin
 * when one is compared, and compares its versions ({@link EvalRunsTab}).
 *
 * The action bar transforms this from a read-only view into an
 * operational hub. Actions are provided by the consumer via
 * `primaryAction` and `actions` props; `yamlActions` adds the ones that
 * read the agent itself (Edit YAML and the YAML and JSON exports), so they
 * always see the copy this view holds.
 *
 * Handles loading, error, and not-found states automatically.
 * Zero Console dependencies — safe for platform builder embedding.
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * // Minimal — self-contained, fetches its own data
 * <AgentDetailView org="acme" slug="variance-reporter" />
 * ```
 *
 * @example
 * ```tsx
 * // Operational hub with actions in a Console page
 * function AgentPage({ onEdit, onDelete, onOpen }: { onEdit: () => void; onDelete: () => void; onOpen: (href: string) => void }) {
 *   return (
 *     <AgentDetailView
 *       org="acme"
 *       slug="reviewer"
 *       primaryAction={{ id: "edit", label: "Edit", onAction: onEdit }}
 *       actions={[{ id: "delete", label: "Delete", variant: "destructive", requires: "can_delete", onAction: onDelete }]}
 *       onPluginClick={({ org, slug }) => onOpen(`/plugins/${org}/${slug}`)}
 *       onSkillClick={({ org, slug }) => onOpen(`/skills/${org}/${slug}`)}
 *     />
 *   );
 * }
 * ```
 */
export function AgentDetailView({
  org,
  slug,
  onSkillClick,
  onResourceLoad,
  primaryAction,
  actions,
  yamlActions = false,
  additionalTabs,
  activeTab,
  onTabChange,
  defaultTab,
  editable: editableProp = false,
  onResourceUpdated,
  onRenamed,
  buildChatLinkUrl,
  channelAppsHref,
  sessionHref,
  onConnectExternal,
  onPluginClick,
  onAgentClick,
  onNavigateToRun,
  makeItYours,
  inApp,
  className,
}: AgentDetailViewProps) {
  const { agent, isLoading, error, refetch } = useAgent(org, slug);
  // The agent's org is compared with stored references, which name orgs by
  // id; the `org` prop may be a slug (a URL's), so it is mapped first.
  const orgIdFor = useOrgIdForRef();
  const managing = useManagingPlugin(agent?.metadata?.labels);
  // The resource the header's acts and the inline edits are checked on.
  const agentId = agent?.metadata?.id ?? "";
  const resourceRef = useMemo(() => (agentId !== "" ? { kind: "agent", id: agentId } : null), [agentId]);
  // Edits are offered only on the server's yes: a reader sees a read-only
  // page from the first frame, never a pencil while the check is in flight.
  const editCheck = useCheckPermission(editableProp ? resourceRef : null, "can_edit", { fail: "closed" });
  const mayEdit = editableProp && editCheck.allowed;
  // A plugin's resource is the plugin's to redefine; the notice says so and no edit form is offered.
  const editable = mayEdit && managing.plugin === null;
  const { update, isUpdating } = useUpdateAgent();

  // Last failed inline save, attributed to the field that was edited so
  // only that section shows the message. The backend's message is the
  // UX: server refusals arrive as actionable FAILED_PRECONDITION
  // messages.
  const [saveError, setSaveError] = useState<{
    field: string;
    message: string;
  } | null>(null);

  // Several fields saved as one edit (the run defaults write run_config
  // and harness together); a failure is attributed to `field`.
  const saveFields = useCallback(
    async (field: string, patch: Partial<import("@stigmer/client").AgentInput>): Promise<boolean> => {
      if (!agent) return false;
      setSaveError(null);
      try {
        const { resource, paths } = maskedEdit(agent, buildAgentProto, patch);
        const updated = await update(resource, paths);
        onResourceUpdated?.(updated);
        refetch();
        return true;
      } catch (err) {
        setSaveError({ field, message: saveErrorMessage(err, "agent") });
        return false;
      }
    },
    [agent, update, onResourceUpdated, refetch],
  );

  const saveField = useCallback(
    async <K extends keyof import("@stigmer/client").AgentInput>(
      field: K,
      value: import("@stigmer/client").AgentInput[K],
    ): Promise<boolean> => {
      const patch: Partial<import("@stigmer/client").AgentInput> = {};
      patch[field] = value;
      return saveFields(field, patch);
    },
    [saveFields],
  );

  const saveRunDefaults = useCallback(
    ({ harness, runConfig }: AgentRunDefaultsSave) =>
      saveFields("runConfig", { harness, runConfig }),
    [saveFields],
  );

  const clearSaveError = useCallback(() => setSaveError(null), []);

  const handleRenamed = useCallback(
    (renamed: RenamedResource) => {
      onRenamed?.(renamed as import("@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb").Agent);
      refetch();
    },
    [onRenamed, refetch],
  );

  // The eval the Quality tab's version table last opened: the Evals tab
  // mounts on it.
  const [openEvalId, setOpenEvalId] = useState<string | null>(null);

  const { tree, isEmpty: noDeps } = useDependencyGraph({
    agentName: agent?.metadata?.name || agent?.metadata?.slug || slug,
    agentOrg: agent?.metadata?.org || orgIdFor(org),
    spec: agent?.spec,
  });

  // The badge reads the history's first page; the tab pages it when opened.
  // Read again when a save here makes a new version.
  const versionCount = useAgentVersionCount(
    agent?.metadata?.org ?? null,
    agent?.metadata?.slug ?? null,
    agent?.status?.versionHash,
  );
  // One read of the agent's channels, shared by the profile header's count
  // and the Channels tab, so an add or a delete there changes both.
  const channels = useChannelList(agent?.metadata?.id ?? "", agent?.metadata?.org ?? "");

  // The journey's tab: a host that offers it, an agent the journey made,
  // and a viewer who may edit it.
  const offersMakeItYours = makeItYours !== undefined && editable && isJourneyAgentSlug(agent?.metadata?.slug ?? "");
  const offersInApp = inApp !== undefined;
  const builtInTabs = useMemo<readonly TabItem[]>(
    () => [
      ...(offersMakeItYours ? [MAKE_IT_YOURS_TAB] : []),
      OVERVIEW_TAB,
      ...(offersInApp ? [IN_APP_TAB] : []),
      CHANNELS_TAB,
      QUALITY_TAB,
      EVALS_TAB,
      ...(noDeps ? [] : [DEPENDENCIES_TAB]),
      {
        ...VERSIONS_TAB,
        ...(versionCount.count > 0 && {
          badge: versionCount.count,
          badgeIsLowerBound: versionCount.isLowerBound,
        }),
      },
    ],
    [offersMakeItYours, offersInApp, noDeps, versionCount],
  );

  const {
    effectiveTabs,
    effectiveActiveTab,
    effectiveOnTabChange,
    activeAdditionalTab,
  } = useDetailTabs({
    builtInTabs,
    additionalTabs,
    activeTab,
    onTabChange,
    defaultTab,
  });

  const handleNodeClick = useCallback(
    (node: DependencyNode) => {
      if (!node.ref) return;
      if (node.kind === "plugin") {
        onPluginClick?.(node.ref);
      } else if (node.kind === "skill") {
        onSkillClick?.(node.ref);
      } else if (node.kind === "subagent") {
        onAgentClick?.(node.ref);
      }
    },
    [onPluginClick, onSkillClick, onAgentClick],
  );

  const onResourceLoadRef = useRef(onResourceLoad);
  onResourceLoadRef.current = onResourceLoad;

  useEffect(() => {
    if (agent?.metadata?.name) {
      onResourceLoadRef.current?.({
        name: agent.metadata.name,
        id: agent.metadata.id,
        slug: agent.metadata.slug,
      });
    }
  }, [agent]);

  // Unified Manage access — visibility (General access) over explicit grants
  // (People), opened from the kebab. Derived from the loaded metadata, so the
  // action stays null until the resource is ready (and folds harmlessly into
  // the actions array meanwhile).
  const access = useManageAccess({
    resource: agent?.metadata
      ? {
          kind: ApiResourceKind.agent,
          kindString: "agent",
          id: agent.metadata.id,
          org: agent.metadata.org,
          name: agent.metadata.name,
        }
      : null,
    visibility: agent?.metadata
      ? {
          kind: "agent",
          current: agent.metadata.visibility,
          org: agent.metadata.org,
          onChanged: refetch,
        }
      : undefined,
  });

  // The actions that read the agent read this view's copy, the one its
  // inline edits and Manage access refresh, and an apply refreshes it in
  // turn: a host holding a second copy would open the editor on a stale
  // agent and write its old fields back.
  const [editYamlOpen, setEditYamlOpen] = useState(false);
  // Serialized only for a host that opted in: the others pay nothing for it.
  const { copyYaml, copyJson, downloadYaml } = useExportResource({ resource: yamlActions ? agent : null });
  const yamlMenu = useMemo<readonly DetailAction[]>(
    () =>
      yamlActions
        ? [
            ...(editable
              ? [{ id: "edit-yaml", label: "Edit YAML", group: "export", requires: "can_edit", onAction: () => setEditYamlOpen(true) }]
              : []),
            { id: "export-yaml", label: "Export YAML", group: "export", onAction: () => void copyYaml() },
            { id: "export-json", label: "Export JSON", group: "export", onAction: () => void copyJson() },
            { id: "download-yaml", label: "Download YAML", group: "export", onAction: downloadYaml },
          ]
        : [],
    [yamlActions, editable, copyYaml, copyJson, downloadYaml],
  );

  if (isLoading) return <LoadingSkeleton className={className} />;
  if (error)
    return <ErrorMessage error={error} retry={refetch} className={className} />;
  if (!agent) return <NotFoundState className={className} />;

  const meta = agent.metadata;
  const spec = agent.spec;
  const specAudit = agent.status?.audit?.specAudit;
  const agentOrg = meta?.org || orgIdFor(org);

  const headerMeta: ResourceHeaderMeta = {
    name: meta?.name || meta?.slug || "Untitled",
    id: meta?.id || "",
    org: meta?.org,
    slug: meta?.slug,
    description: undefined,
    iconUrl: editable ? undefined : spec?.iconUrl,
    icon: editable
      ? (
        <InlineEditImage
          value={spec?.iconUrl ?? ""}
          onSave={(v) => saveField("iconUrl", v || undefined)}
          isSaving={isUpdating}
          fallback={<AgentIcon className="stg:size-6 stg:text-muted-foreground" />}
          disabled={!editable}
        />
      )
      : spec?.iconUrl ? undefined : <AgentIcon className="stg:size-6 stg:text-muted-foreground" />,
    createdAt: specAudit?.createdAt ? timestampDate(specAudit.createdAt) : null,
    updatedAt: specAudit?.updatedAt ? timestampDate(specAudit.updatedAt) : null,
  };

  // Inline visibility is at-a-glance AND a shortcut into the Manage access
  // dialog — the single writer for both access axes. The chip is navigation
  // only (never edits in place); it stays a static badge for users who
  // cannot view access. An inert chip reads as "not editable" (2026-07-18
  // dogfood friction), so the shortcut is the discoverability affordance.
  const visibilityControl = meta ? (
    <VisibilityBadge
      visibility={meta.visibility}
      onClick={access.action ? access.open : undefined}
    />
  ) : undefined;

  // Manage access is the menu's one sharing item, as on every other kind:
  // "share" means giving people access. Chat links, Slack and WhatsApp are
  // the Channels tab's, reached by the tab itself.
  // The YAML actions go before the host's first destructive one, so the
  // menu reads clipboard, export, danger, sharing, the host's order kept.
  const injectedActions = [access.action].filter(
    (a): a is NonNullable<typeof a> => a != null,
  );
  const hostActions = actions ?? [];
  const firstDestructive = hostActions.findIndex((a) => a.variant === "destructive");
  const splitAt = firstDestructive === -1 ? hostActions.length : firstDestructive;
  const mergedActions = [
    ...hostActions.slice(0, splitAt),
    ...yamlMenu,
    ...hostActions.slice(splitAt),
    ...injectedActions,
  ];

  let tabContent: React.ReactNode;
  if (activeAdditionalTab) {
    tabContent = activeAdditionalTab.content;
  } else if (effectiveActiveTab === CHANNELS_TAB.id) {
    tabContent = (
      <ChannelsPanel
        agent={agent}
        buildChatLinkUrl={buildChatLinkUrl}
        channelAppsHref={channelAppsHref}
        sessionHref={sessionHref}
        onConnectExternal={onConnectExternal}
        channelList={channels}
      />
    );
  } else if (effectiveActiveTab === "quality") {
    // Grading is the agent's setting, not its definition: a plugin-managed
    // agent offers it too, to whoever the server lets edit the agent.
    tabContent = (
      <AgentQualityTab
        agent={agent}
        editable={mayEdit}
        onNavigateToRun={onNavigateToRun}
        onOpenEval={(evalId) => {
          setOpenEvalId(evalId);
          effectiveOnTabChange(EVALS_TAB.id);
        }}
      />
    );
  } else if (effectiveActiveTab === "evals") {
    // Running test cases on the agent is not an edit of its definition:
    // the tab gates its own form on can_edit, a plugin-managed agent included.
    tabContent = (
      <EvalRunsTab
        agent={agent}
        onNavigateToRun={onNavigateToRun}
        initialEvalRunId={openEvalId ?? undefined}
        onOpenPlugins={() => effectiveOnTabChange(OVERVIEW_TAB.id)}
      />
    );
  } else if (effectiveActiveTab === "dependencies" && tree) {
    tabContent = (
      <DependencyGraph
        tree={tree}
        onNodeClick={handleNodeClick}
      />
    );
  } else if (effectiveActiveTab === "versions") {
    tabContent = <AgentVersionsTab agent={agent} />;
  } else if (effectiveActiveTab === IN_APP_TAB.id && inApp) {
    tabContent = <InAppTab agent={agent} links={inApp} onOpenChannels={() => effectiveOnTabChange(CHANNELS_TAB.id)} />;
  } else if (effectiveActiveTab === MAKE_IT_YOURS_TAB.id && offersMakeItYours && makeItYours) {
    tabContent = (
      <MakeItYoursTab
        agent={agent}
        links={makeItYours}
        saveField={saveField}
        isSaving={isUpdating}
        saveError={saveError}
        onOpenVersions={() => effectiveOnTabChange(VERSIONS_TAB.id)}
      />
    );
  } else if (effectiveActiveTab === MAKE_IT_YOURS_TAB.id && makeItYours && editableProp && editCheck.isLoading) {
    // Arrived on the tab by its link while the server is still asked
    // whether this viewer may edit: hold its place rather than draw
    // Overview and swap it.
    tabContent = <LoadingRegion label="Loading" className="stg:h-48 stg:animate-pulse stg:rounded-xl stg:bg-muted" />;
  } else {
    tabContent = (
      <div className="stg:flex stg:flex-col stg:gap-6">
        {editable && (
          <ResourceSlugField
            kind="agent"
            resourceId={meta?.id ?? null}
            currentSlug={meta?.slug ?? ""}
            onRenamed={handleRenamed}
            className="stg:max-w-md"
          />
        )}
        <AgentOverview
          spec={spec}
          agentOrg={agentOrg}
          agentSlug={meta?.slug ?? slug}
          description={spec?.description}
          onSkillClick={onSkillClick}
          editable={editable}
          isSaving={isUpdating}
          saveField={saveField}
          saveRunDefaults={saveRunDefaults}
          onPluginClick={onPluginClick}
          onAgentClick={onAgentClick}
          saveError={saveError}
          clearSaveError={clearSaveError}
        />
      </div>
    );
  }

  return (
    <>
      <ResourceDetailShell
        header={headerMeta}
        identity={
          <AgentProfileHeader
            agent={agent}
            icon={headerMeta.icon ?? (headerMeta.iconUrl ? <img src={headerMeta.iconUrl} alt="" className="stg:size-full stg:object-cover" /> : null)}
            visibilityControl={visibilityControl}
            versionCount={versionCount.count > 0 ? versionCount.count : undefined}
            channelCount={channels.isLoading ? undefined : channels.channels.length}
          />
        }
        visibilityControl={visibilityControl}
        headerBanner={<ManagedByPluginNotice plugin={managing.plugin} onPluginClick={onPluginClick} />}
        primaryAction={primaryAction}
        actions={mergedActions}
        resource={resourceRef}
        tabs={effectiveTabs}
        activeTab={effectiveTabs ? effectiveActiveTab : undefined}
        onTabChange={effectiveTabs ? effectiveOnTabChange : undefined}
        tabsAriaLabel="Agent detail sections"
        className={className}
      >
        {tabContent}
      </ResourceDetailShell>
      {access.dialog}
      {/* Mounted on open, so the editor seeds from the agent as it is then
          and the CodeMirror chunk loads only when asked for. A YAML apply
          that renamed the agent reaches the host through onResourceLoad:
          the refetch by the old slug answers the new one. */}
      {editYamlOpen && (
        <EditResourceYamlDialog
          open
          onOpenChange={setEditYamlOpen}
          resource={agent}
          onApplied={() => refetch()}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Overview content — the agent's configuration sections
// ---------------------------------------------------------------------------

function AgentOverview({
  spec,
  agentOrg,
  agentSlug,
  description,
  onSkillClick,
  editable,
  isSaving,
  saveField,
  saveRunDefaults,
  onPluginClick,
  onAgentClick,
  saveError,
  clearSaveError,
}: {
  readonly spec: NonNullable<ReturnType<typeof useAgent>["agent"]>["spec"];
  readonly agentOrg: string;
  readonly agentSlug: string;
  readonly description?: string;
  readonly onSkillClick?: (ref: { org: string; slug: string }) => void;
  readonly editable?: boolean;
  readonly isSaving?: boolean;
  readonly saveField?: <K extends keyof import("@stigmer/client").AgentInput>(
    field: K,
    value: import("@stigmer/client").AgentInput[K],
  ) => Promise<boolean>;
  readonly saveRunDefaults?: (save: AgentRunDefaultsSave) => Promise<boolean>;
  readonly onPluginClick?: (ref: { org: string; slug: string }) => void;
  readonly onAgentClick?: (ref: { org: string; slug: string }) => void;
  readonly saveError?: { field: string; message: string } | null;
  readonly clearSaveError?: () => void;
}) {
  // The failed save's message, shown only under the section that owns
  // the field — a rejection of one section's edit must not appear under
  // another section's editor.
  const errorFor = (field: keyof import("@stigmer/client").AgentInput) =>
    saveError?.field === field ? saveError.message : undefined;
  const slugForOrg = useOrgSlugForId();
  const handleInstructionsSave = useCallback(
    async (v: string) => saveField?.("instructions", v || undefined) ?? false,
    [saveField],
  );

  const handlePluginsSave = useCallback(
    async (refs: ResourceRefRow[]) =>
      saveField?.(
        "plugins",
        refs.map(keptReference),
      ) ?? false,
    [saveField],
  );

  const handleSkillsSave = useCallback(
    async (refs: ResourceRefRow[]) =>
      saveField?.(
        "skillRefs",
        refs.map(keptReference),
      ) ?? false,
    [saveField],
  );

  const handleEnvSave = useCallback(
    async (rows: KeyValueRow[]) => {
      const env: Record<string, { isSecret?: boolean; description?: string; optional?: boolean }> = {};
      for (const row of rows) {
        if (row.key.trim()) {
          env[row.key.trim()] = {
            isSecret: row.isSecret || undefined,
            description: row.description || undefined,
            optional: row.optional || undefined,
          };
        }
      }
      return saveField?.("env", Object.keys(env).length > 0 ? env : undefined) ?? false;
    },
    [saveField],
  );

  const pluginRefRows: ResourceRefRow[] = useMemo(
    () =>
      (spec?.plugins ?? []).map((ref) => ({
        org: ref.org || agentOrg,
        slug: ref.slug,
        ...(ref.id ? { id: ref.id } : {}),
        label: referenceLabel(ApiResourceKind.plugin, ref, agentOrg, slugForOrg),
      })),
    [spec?.plugins, agentOrg, slugForOrg],
  );

  const skillRefRows: ResourceRefRow[] = useMemo(
    () =>
      (spec?.skillRefs ?? []).map((ref) => ({
        org: ref.org || agentOrg,
        slug: ref.slug,
        ...(ref.id ? { id: ref.id } : {}),
        label: referenceLabel(ApiResourceKind.skill, ref, agentOrg, slugForOrg),
      })),
    [spec?.skillRefs, agentOrg, slugForOrg],
  );

  const envRows: KeyValueRow[] = useMemo(
    () =>
      Object.entries(spec?.env ?? {})
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, decl]) => ({
          key,
          value: "",
          isSecret: decl.isSecret,
          description: decl.description,
          optional: decl.optional,
        })),
    [spec?.env],
  );

  const showDescription = editable || !!description;
  const showInstructions = editable || !!spec?.instructions;
  const showPlugins = editable || (spec && spec.plugins.length > 0);
  const showMcpServers = editable || (spec && spec.mcpServers.length > 0);
  const showSkills = editable || (spec && spec.skillRefs.length > 0);
  const showSubagents = editable || (spec && spec.subagents.length > 0);
  const showToolLists = !!spec && hasToolLists(spec);
  const showEnv = editable || (spec?.env && Object.keys(spec.env).length > 0);

  const [pluginsEditing, setPluginsEditing] = useState(false);
  const [skillsEditing, setSkillsEditing] = useState(false);
  const [envEditing, setEnvEditing] = useState(false);

  // Entering edit mode discards the previous attempt's error — the
  // message describes a stale draft, not the one being composed.
  const handlePluginsEditingChange = useCallback(
    (editing: boolean) => {
      if (editing) clearSaveError?.();
      setPluginsEditing(editing);
    },
    [clearSaveError],
  );
  const handleSkillsEditingChange = useCallback(
    (editing: boolean) => {
      if (editing) clearSaveError?.();
      setSkillsEditing(editing);
    },
    [clearSaveError],
  );
  const handleEnvEditingChange = useCallback(
    (editing: boolean) => {
      if (editing) clearSaveError?.();
      setEnvEditing(editing);
    },
    [clearSaveError],
  );

  return (
    <div className="stg:flex stg:flex-col stg:gap-6">
      {showDescription && (
        <Section title="Description">
          {editable ? (
            <div className="stg:max-h-20 stg:overflow-y-auto stg:p-3">
              <InlineEditTextarea
                value={spec?.description || ""}
                onSave={(v) => saveField?.("description", v || undefined) ?? Promise.resolve(false)}
                isSaving={isSaving}
                error={errorFor("description")}
                placeholder="Add a description"
                minRows={2}
              />
            </div>
          ) : (
            <div className="stg:p-3">
              <pre className="stg:whitespace-pre-wrap stg:break-words stg:text-sm stg:text-foreground stg:font-sans">
                {description}
              </pre>
            </div>
          )}
        </Section>
      )}

      {showInstructions && (
        <Section title="Instructions">
          {editable ? (
            <div className="stg:max-h-72 stg:overflow-y-auto stg:p-3">
              <InlineEditTextarea
                value={spec?.instructions ?? ""}
                onSave={handleInstructionsSave}
                isSaving={isSaving}
                error={errorFor("instructions")}
                placeholder="Add instructions for the agent"
                minRows={4}
              />
            </div>
          ) : (
            <InstructionsContent text={spec?.instructions ?? ""} />
          )}
        </Section>
      )}

      <AgentRunDefaultsSection
        spec={spec}
        editable={!!editable && saveRunDefaults !== undefined}
        isSaving={!!isSaving}
        error={errorFor("runConfig")}
        onSave={(save) => saveRunDefaults?.(save) ?? Promise.resolve(false)}
        onEditStart={clearSaveError}
      />

      <AgentEnvironmentSection
        spec={spec}
        agentOrg={agentOrg}
        editable={!!editable && saveField !== undefined}
        isSaving={!!isSaving}
        error={errorFor("environmentRef")}
        onSave={(environmentRef) => saveField?.("environmentRef", environmentRef) ?? Promise.resolve(false)}
        onEditStart={clearSaveError}
      />

      {showPlugins && (
        <Section title="Plugins" count={spec?.plugins.length} onEdit={editable ? () => handlePluginsEditingChange(!pluginsEditing) : undefined}>
          {editable ? (
            <InlineEditResourceList
              value={pluginRefRows}
              onSave={handlePluginsSave}
              isSaving={isSaving}
              error={errorFor("plugins")}
              editing={pluginsEditing}
              onEditingChange={handlePluginsEditingChange}
              onItemClick={onPluginClick ? (ref) => { if (!isDeletedReference(ref)) onPluginClick({ org: ref.org, slug: ref.slug }); } : undefined}
              itemIcon={<PluginIcon className="stg:size-4" />}
              resourceLabel="plugin"
              defaultOrg={agentOrg}
            />
          ) : (
            <PluginsContent
              refs={spec?.plugins ?? []}
              defaultOrg={agentOrg}
              onPluginClick={onPluginClick}
            />
          )}
        </Section>
      )}

      {showMcpServers && (
        <AgentMcpServersSection
          servers={spec?.mcpServers ?? []}
          org={agentOrg}
          editable={editable}
          isSaving={isSaving}
          error={errorFor("mcpServers")}
          onSave={(servers) => saveField?.("mcpServers", servers) ?? Promise.resolve(false)}
          onEditStart={clearSaveError}
        />
      )}

      {showToolLists && spec && (
        <Section title="Tools">
          <AgentToolLists tools={spec.tools} disallowedTools={spec.disallowedTools} />
        </Section>
      )}

      <AgentHooksSection hooks={spec?.hooks ?? []} />

      {showSkills && (
        <Section title="Skills" count={spec?.skillRefs.length} onEdit={editable ? () => handleSkillsEditingChange(!skillsEditing) : undefined}>
          {editable ? (
            <InlineEditResourceList
              value={skillRefRows}
              onSave={handleSkillsSave}
              isSaving={isSaving}
              error={errorFor("skillRefs")}
              editing={skillsEditing}
              onEditingChange={handleSkillsEditingChange}
              onItemClick={onSkillClick ? (ref) => { if (!isDeletedReference(ref)) onSkillClick({ org: ref.org, slug: ref.slug }); } : undefined}
              itemIcon={<SkillIcon className="stg:size-4" />}
              resourceLabel="skill"
              defaultOrg={agentOrg}
            />
          ) : (
            <SkillsContent
              refs={spec?.skillRefs ?? []}
              defaultOrg={agentOrg}
              onSkillClick={onSkillClick}
            />
          )}
        </Section>
      )}

      {showSubagents && (
        <AgentSubagentsSection
          refs={spec?.subagents ?? []}
          agentOrg={agentOrg}
          self={{ org: agentOrg, slug: agentSlug }}
          editable={editable}
          isSaving={isSaving}
          error={errorFor("subagents")}
          onSave={(refs) => saveField?.("subagents", refs) ?? Promise.resolve(false)}
          onEditStart={clearSaveError}
          onAgentClick={onAgentClick}
        />
      )}

      {showEnv && (
        <Section title="Environment Variables" count={Object.keys(spec?.env ?? {}).length} onEdit={editable ? () => handleEnvEditingChange(!envEditing) : undefined}>
          {editable ? (
            <InlineEditKeyValue
              value={envRows}
              onSave={handleEnvSave}
              isSaving={isSaving}
              error={errorFor("env")}
              editing={envEditing}
              onEditingChange={handleEnvEditingChange}
              showSecretToggle
              showOptionalToggle
              showDescription
              keyLabel="Variable name"
            />
          ) : (
            <EnvContent data={spec?.env ?? {}} />
          )}
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Internal section components
// ---------------------------------------------------------------------------

function InstructionsContent({ text }: { readonly text: string }) {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLPreElement>(null);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    setOverflows(el.scrollHeight > el.clientHeight);
  }, [text]);

  return (
    <div className="stg:relative stg:p-3">
      <pre
        ref={contentRef}
        className={cn(
          "stg:whitespace-pre-wrap stg:break-words stg:font-mono stg:text-sm stg:text-foreground stg:overflow-y-auto stg:transition-[max-height] stg:duration-200",
          !expanded && "stg:overflow-hidden",
        )}
        style={{ maxHeight: expanded ? "none" : INSTRUCTIONS_COLLAPSED_HEIGHT }}
      >
        {text}
      </pre>
      {!expanded && overflows && (
        <div className="stg:pointer-events-none stg:absolute stg:inset-x-3 stg:bottom-10 stg:h-8 stg:bg-gradient-to-t stg:from-background stg:to-transparent" />
      )}
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="stg:mt-2 stg:text-xs stg:font-medium stg:text-primary stg:transition-colors stg:hover:text-primary-muted"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/**
 * A reference as a row reads it: its slug, prefixed by its organization's
 * slug when it is another organization's; "deleted <kind>" for a target
 * deleted since it was attached, which comes back with no slug and links
 * nowhere.
 */
function referenceLabel(
  kind: ApiResourceKind,
  ref: { readonly org: string; readonly slug: string; readonly id?: string },
  defaultOrg: string,
  slugForOrg: (org: string) => string,
): string {
  if (isDeletedReference(ref)) {
    return deletedReferenceLabel(kind);
  }
  return ref.org && ref.org !== defaultOrg
    ? `${slugForOrg(ref.org)}/${ref.slug}`
    : ref.slug;
}

function PluginsContent({
  refs,
  defaultOrg,
  onPluginClick,
}: {
  readonly refs: readonly ApiResourceReference[];
  readonly defaultOrg: string;
  readonly onPluginClick?: (ref: { org: string; slug: string }) => void;
}) {
  const slugForOrg = useOrgSlugForId();
  return (
    <div className="stg:flex stg:flex-col">
      {refs.map((ref, index) => {
        const refOrg = ref.org || defaultOrg;
        const label = referenceLabel(ApiResourceKind.plugin, ref, defaultOrg, slugForOrg);
        const row = (
          <div className="stg:flex stg:items-center stg:gap-3">
            <PluginIcon className="stg:size-4 stg:shrink-0 stg:text-muted-foreground" />
            <span className="stg:text-sm stg:font-medium stg:text-foreground">
              {label}
            </span>
          </div>
        );

        return onPluginClick && !isDeletedReference(ref) ? (
          <button
            key={`${refOrg}/${ref.slug || index}`}
            type="button"
            onClick={() => onPluginClick({ org: refOrg, slug: ref.slug })}
            className={cn(
              "stg:w-full stg:rounded-md stg:px-3 stg:py-2 stg:text-left stg:transition-colors",
              "stg:hover:bg-accent-hover",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
            )}
          >
            {row}
          </button>
        ) : (
          <div key={`${refOrg}/${ref.slug || index}`} className="stg:px-3 stg:py-2">
            {row}
          </div>
        );
      })}
    </div>
  );
}

function SkillsContent({
  refs,
  defaultOrg,
  onSkillClick,
}: {
  readonly refs: readonly ApiResourceReference[];
  readonly defaultOrg: string;
  readonly onSkillClick?: (ref: { org: string; slug: string }) => void;
}) {
  const slugForOrg = useOrgSlugForId();
  return (
    <div className="stg:flex stg:flex-col">
      {refs.map((ref, index) => {
        const refOrg = ref.org || defaultOrg;
        const label = referenceLabel(ApiResourceKind.skill, ref, defaultOrg, slugForOrg);

        const row = (
          <div className="stg:flex stg:items-center stg:gap-3">
            <SkillIcon className="stg:size-4 stg:shrink-0 stg:text-muted-foreground" />
            <span className="stg:text-sm stg:font-medium stg:text-foreground">
              {label}
            </span>
          </div>
        );

        return onSkillClick && !isDeletedReference(ref) ? (
          <button
            key={ref.slug || index}
            type="button"
            onClick={() => onSkillClick({ org: refOrg, slug: ref.slug })}
            className={cn(
              "stg:w-full stg:rounded-md stg:px-3 stg:py-2 stg:text-left stg:transition-colors",
              "stg:hover:bg-accent-hover",
              "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-inset stg:focus-visible:ring-ring",
            )}
          >
            {row}
          </button>
        ) : (
          <div key={ref.slug || index} className="stg:px-3 stg:py-2">
            {row}
          </div>
        );
      })}
    </div>
  );
}

function EnvContent({
  data,
}: {
  readonly data: { [key: string]: EnvVarDeclaration };
}) {
  const entries = Object.entries(data).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <div className="stg:flex stg:flex-col stg:divide-y stg:divide-border">
      {entries.map(([name, env]) => (
        <div key={name} className="stg:flex stg:items-start stg:gap-3 stg:px-3 stg:py-2">
          <code className="stg:shrink-0 stg:font-mono stg:text-sm stg:font-medium stg:text-foreground">
            {name}
          </code>
          <Tag>{env.isSecret ? "secret" : "config"}</Tag>
          {env.description && (
            <span className="stg:text-xs stg:text-muted-foreground">
              {env.description}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared layout primitives
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Non-happy states
// ---------------------------------------------------------------------------

function LoadingSkeleton({ className }: { readonly className?: string }) {
  return (
    <LoadingRegion
      className={cn("stg:flex stg:flex-col stg:gap-6", className)}
      label="Loading agent details"
    >
      <div className="stg:flex stg:items-start stg:gap-3">
        <div className="stg:mt-1 stg:size-6 stg:shrink-0 stg:animate-pulse stg:rounded stg:bg-muted" />
        <div className="stg:flex-1 stg:space-y-2">
          <div className="stg:h-5 stg:w-48 stg:animate-pulse stg:rounded stg:bg-muted" />
          <div className="stg:h-3 stg:w-64 stg:animate-pulse stg:rounded stg:bg-muted" />
          <div className="stg:h-4 stg:w-full stg:max-w-md stg:animate-pulse stg:rounded stg:bg-muted" />
        </div>
      </div>
      {[40, 24, 16].map((h) => (
        <div key={h} className="stg:space-y-2">
          <div className="stg:h-3 stg:w-24 stg:animate-pulse stg:rounded stg:bg-muted" />
          <div
            className="stg:animate-pulse stg:rounded-lg stg:border stg:border-border stg:bg-muted-faint"
            style={{ height: `${h * 4}px` }}
          />
        </div>
      ))}
    </LoadingRegion>
  );
}

function NotFoundState({ className }: { readonly className?: string }) {
  return (
    <EmptyState
      variant="first-use"
      icon={<AgentIcon />}
      title="Agent not found"
      description="This agent doesn't exist or you don't have access to it."
      className={className}
    />
  );
}

// ---------------------------------------------------------------------------
// Icons — inline SVGs following the SDK pattern (no icon library dependency)
// ---------------------------------------------------------------------------

function AgentIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="10" height="8" rx="1.5" />
      <path d="M6 9h.01M10 9h.01" strokeWidth="2" />
      <path d="M8 2v3" />
    </svg>
  );
}

function SkillIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 1.5 4 9h4l-1 5.5L12 7H8l1-5.5Z" />
    </svg>
  );
}

