"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type {
  McpServerUsage,
  SubAgent,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import type { ApiResourceReference } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useAgent } from "./useAgent.js";
import { useUpdateAgent } from "./useUpdateAgent.js";
import { toAgentUpdateInput } from "@stigmer/sdk";
import { toError } from "../internal/toError.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { VisibilityBadge } from "../library/VisibilitySelector.js";
import { useManageAccess } from "../access/useManageAccess.js";
import { AgentShareList } from "../sharing/AgentShareList.js";
import { ResourceDetailShell } from "../resource-detail/ResourceDetailShell.js";
import { Section } from "../resource-detail/Section.js";
import { useDetailTabs } from "../resource-detail/useDetailTabs.js";
import type { AdditionalTab, DetailAction, ResourceHeaderMeta } from "../resource-detail/types.js";
import type { TabItem } from "../tabs/Tabs.js";
import { DependencyGraph } from "../dependency-graph/DependencyGraph.js";
import { useDependencyGraph } from "../dependency-graph/useDependencyGraph.js";
import type { DependencyNode } from "../dependency-graph/types.js";
import { InlineEditTextarea } from "../inline-edit/InlineEditTextarea.js";
import { InlineEditImage } from "../inline-edit/InlineEditImage.js";
import { InlineEditKeyValue } from "../inline-edit/InlineEditKeyValue.js";
import { InlineEditResourceList } from "../inline-edit/InlineEditResourceList.js";
import type { KeyValueRow, ResourceRefRow } from "../inline-edit/types.js";
import { AgentInstanceList } from "../agent-instance/AgentInstanceList.js";

const INSTRUCTIONS_COLLAPSED_HEIGHT = "12rem";

const OVERVIEW_TAB: TabItem = { id: "overview", label: "Overview" };
const INSTANCES_TAB: TabItem = { id: "instances", label: "Instances" };
const SHARES_TAB: TabItem = { id: "shares", label: "Shares" };
const DEPENDENCIES_TAB: TabItem = { id: "dependencies", label: "Dependencies" };

/** Props for {@link AgentDetailView}. */
export interface AgentDetailViewProps {
  /** Organization slug that owns the agent. */
  readonly org: string;
  /** Agent slug (URL-friendly identifier unique within the org). */
  readonly slug: string;
  /**
   * Called when an MCP server reference is clicked.
   * Provides `org` and `slug` of the referenced MCP server so the
   * consumer can wire navigation. When the reference has no explicit
   * org, the agent's own org is used as fallback.
   */
  readonly onMcpServerClick?: (ref: { org: string; slug: string }) => void;
  /**
   * Called when a skill reference is clicked.
   * Provides `org` and `slug` of the referenced skill.
   */
  readonly onSkillClick?: (ref: { org: string; slug: string }) => void;
  /**
   * Called once when the agent resource has been fetched successfully.
   * Provides the resource display name for use cases like breadcrumbs,
   * document titles, or analytics — without requiring the consumer to
   * also call {@link useAgent}.
   *
   * Not called on error or not-found states.
   */
  readonly onResourceLoad?: (meta: { name: string; id: string }) => void;
  /**
   * Primary action rendered as a visible button in the header area.
   * Typically "Edit" for agent detail pages.
   */
  readonly primaryAction?: DetailAction;
  /**
   * Secondary actions rendered in the kebab overflow menu.
   * Typically: Copy ID, Copy slug, Export JSON, Duplicate, Delete.
   */
  readonly actions?: readonly DetailAction[];
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
   * When `true`, fields on the detail view become click-to-edit.
   * Each field saves independently via `stigmer.agent.update()`.
   * @default false
   */
  readonly editable?: boolean;
  /**
   * Called after a successful inline field save with the updated agent.
   * Consumers can use this to refresh breadcrumbs, sync URL state, etc.
   */
  readonly onResourceUpdated?: (agent: import("@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb").Agent) => void;
  /**
   * Called when the user clicks "Create Instance" in the Instances tab.
   * Opens the create instance dialog.
   */
  readonly onCreateInstanceClick?: () => void;
  /**
   * Builds the absolute public chat URL for shares in the Shares tab.
   * The host application owns URL construction — its configured public
   * origin may differ from the rendering origin (e.g. the desktop app).
   * When omitted, share links fall back to the relative
   * `/chat/<org>/<slug>` path.
   */
  readonly buildShareUrl?: (org: string, slug: string) => string;
  /**
   * The viewer's active organization slug, feeding the Shares and
   * Instances tabs. It scopes both lists to this org's rows (a member
   * of several orgs sees the current org context only), and a share
   * created in the Shares tab lands in this org — its URL, billing,
   * and credentials — which for another org's marketplace-public agent
   * is a **cross-org share** (decision 013). Omit to default to the
   * agent's own org.
   */
  readonly viewerOrg?: string;
  /**
   * Called when the user clicks an instance row in the Instances tab.
   * Typically opens an instance detail panel.
   */
  readonly onInstanceClick?: (instance: AgentInstance) => void;
  /**
   * Called when the user clicks "Start session" on a specific instance.
   * The session is created pre-bound to the chosen instance's environment.
   */
  readonly onInstanceStartSessionClick?: (instance: AgentInstance) => void;
  /**
   * Called when the user clicks "Delete" on a specific instance.
   */
  readonly onInstanceDeleteClick?: (instance: AgentInstance) => void;
  /**
   * Increment this value to trigger a refetch of the instance list.
   * Useful after externally creating or deleting an instance.
   */
  readonly instancesRefreshKey?: number;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Operational detail hub for an Agent blueprint.
 *
 * Fetches the agent via {@link useAgent} internally and renders its
 * full configuration inside a {@link ResourceDetailShell}: a
 * standardized header with action bar, followed by structured content
 * sections (instructions, MCP server usages, skills,
 * sub-agents, and environment variables). Sections with no data are
 * omitted entirely — reducing visual noise per Nielsen heuristic #8.
 *
 * The action bar transforms this from a read-only view into an
 * operational hub. Actions are provided by the consumer via
 * `primaryAction` and `actions` props.
 *
 * Handles loading, error, and not-found states automatically.
 * Zero Console dependencies — safe for platform builder embedding.
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * // Minimal — self-contained, fetches its own data
 * <AgentDetailView org="acme" slug="pr-review-agent" />
 * ```
 *
 * @example
 * ```tsx
 * // Operational hub with actions in a Console page
 * <AgentDetailView
 *   org={org}
 *   slug={slug}
 *   primaryAction={{ id: "edit", label: "Edit", onAction: handleEdit }}
 *   actions={[
 *     { id: "copy-id", label: "Copy ID", onAction: () => copyId(id) },
 *     { id: "delete", label: "Delete", variant: "destructive", onAction: handleDelete },
 *   ]}
 *   onMcpServerClick={({ org, slug }) => navigateToDetail("mcp-servers", org, slug)}
 *   onSkillClick={({ org, slug }) => navigateToDetail("skills", org, slug)}
 * />
 * ```
 */
export function AgentDetailView({
  org,
  slug,
  onMcpServerClick,
  onSkillClick,
  onResourceLoad,
  primaryAction,
  actions,
  additionalTabs,
  activeTab,
  onTabChange,
  defaultTab,
  editable = false,
  onResourceUpdated,
  buildShareUrl,
  viewerOrg,
  onCreateInstanceClick,
  onInstanceClick,
  onInstanceStartSessionClick,
  onInstanceDeleteClick,
  instancesRefreshKey,
  className,
}: AgentDetailViewProps) {
  const { agent, isLoading, error, refetch } = useAgent(org, slug);
  const { update, isUpdating } = useUpdateAgent();

  // Last failed inline save, attributed to the field that was edited so
  // only that section shows the message. The backend's message is the
  // UX (DD-006): server refusals arrive as actionable FAILED_PRECONDITION
  // messages.
  const [saveError, setSaveError] = useState<{
    field: string;
    message: string;
  } | null>(null);

  const saveField = useCallback(
    async <K extends keyof import("@stigmer/sdk").AgentInput>(
      field: K,
      value: import("@stigmer/sdk").AgentInput[K],
    ): Promise<boolean> => {
      if (!agent) return false;
      setSaveError(null);
      const input = toAgentUpdateInput(agent);
      (input as unknown as Record<string, unknown>)[field] = value;
      try {
        const updated = await update(input);
        onResourceUpdated?.(updated);
        refetch();
        return true;
      } catch (err) {
        setSaveError({ field, message: toError(err).message });
        return false;
      }
    },
    [agent, update, onResourceUpdated, refetch],
  );

  const clearSaveError = useCallback(() => setSaveError(null), []);

  const { tree, isEmpty: noDeps } = useDependencyGraph({
    agentName: agent?.metadata?.name || agent?.metadata?.slug || slug,
    agentOrg: agent?.metadata?.org || org,
    spec: agent?.spec,
  });

  const builtInTabs = useMemo<readonly TabItem[]>(
    () =>
      noDeps
        ? [OVERVIEW_TAB, INSTANCES_TAB, SHARES_TAB]
        : [OVERVIEW_TAB, INSTANCES_TAB, SHARES_TAB, DEPENDENCIES_TAB],
    [noDeps],
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
      if (node.kind === "mcp-server") {
        onMcpServerClick?.(node.ref);
      } else if (node.kind === "skill") {
        onSkillClick?.(node.ref);
      }
    },
    [onMcpServerClick, onSkillClick],
  );

  const onResourceLoadRef = useRef(onResourceLoad);
  onResourceLoadRef.current = onResourceLoad;

  useEffect(() => {
    if (agent?.metadata?.name) {
      onResourceLoadRef.current?.({ name: agent.metadata.name, id: agent.metadata.id });
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

  if (isLoading) return <LoadingSkeleton className={className} />;
  if (error)
    return <ErrorMessage error={error} retry={refetch} className={className} />;
  if (!agent) return <NotFoundState className={className} />;

  const meta = agent.metadata;
  const spec = agent.spec;
  const specAudit = agent.status?.audit?.specAudit;
  const agentOrg = meta?.org || org;

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

  // Share — the sibling consent to Manage access: visibility governs who
  // can read the blueprint; sharing governs who can chat with the running
  // agent (billed to the org that owns each share). Pure navigation to
  // the Shares tab, so it renders unconditionally (like the tab itself);
  // all capability gating lives in the tab, next to its affordances.
  const shareAction: DetailAction = {
    id: "share",
    label: "Share",
    group: "sharing",
    onAction: () => effectiveOnTabChange(SHARES_TAB.id),
  };

  // Share precedes Manage access within the "sharing" group.
  const injectedActions = [shareAction, access.action].filter(
    (a): a is NonNullable<typeof a> => a != null,
  );
  const mergedActions = [...(actions ?? []), ...injectedActions];

  let tabContent: React.ReactNode;
  if (activeAdditionalTab) {
    tabContent = activeAdditionalTab.content;
  } else if (effectiveActiveTab === "instances") {
    tabContent = (
      <AgentInstanceList
        agentId={meta?.id ?? ""}
        defaultInstanceId={agent.status?.defaultInstanceId}
        org={org}
        viewerOrg={viewerOrg}
        onCreateClick={onCreateInstanceClick}
        onInstanceClick={onInstanceClick}
        onStartSessionClick={onInstanceStartSessionClick}
        onDeleteClick={onInstanceDeleteClick}
        refreshKey={instancesRefreshKey}
      />
    );
  } else if (effectiveActiveTab === "shares") {
    tabContent = (
      <AgentShareList
        agent={agent}
        viewerOrg={viewerOrg}
        buildShareUrl={buildShareUrl}
      />
    );
  } else if (effectiveActiveTab === "dependencies" && tree) {
    tabContent = (
      <DependencyGraph
        tree={tree}
        onNodeClick={handleNodeClick}
      />
    );
  } else {
    tabContent = (
      <AgentOverview
        spec={spec}
        agentOrg={agentOrg}
        description={spec?.description}
        onMcpServerClick={onMcpServerClick}
        onSkillClick={onSkillClick}
        editable={editable}
        isSaving={isUpdating}
        saveField={saveField}
        saveError={saveError}
        clearSaveError={clearSaveError}
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
        tabsAriaLabel="Agent detail sections"
        className={className}
      >
        {tabContent}
      </ResourceDetailShell>
      {access.dialog}
    </>
  );
}

// ---------------------------------------------------------------------------
// Overview content — the agent's configuration sections
// ---------------------------------------------------------------------------

function AgentOverview({
  spec,
  agentOrg,
  description,
  onMcpServerClick,
  onSkillClick,
  editable,
  isSaving,
  saveField,
  saveError,
  clearSaveError,
}: {
  readonly spec: NonNullable<ReturnType<typeof useAgent>["agent"]>["spec"];
  readonly agentOrg: string;
  readonly description?: string;
  readonly onMcpServerClick?: (ref: { org: string; slug: string }) => void;
  readonly onSkillClick?: (ref: { org: string; slug: string }) => void;
  readonly editable?: boolean;
  readonly isSaving?: boolean;
  readonly saveField?: <K extends keyof import("@stigmer/sdk").AgentInput>(
    field: K,
    value: import("@stigmer/sdk").AgentInput[K],
  ) => Promise<boolean>;
  readonly saveError?: { field: string; message: string } | null;
  readonly clearSaveError?: () => void;
}) {
  // The failed save's message, shown only under the section that owns
  // the field — a rejection of one section's edit must not appear under
  // another section's editor.
  const errorFor = (field: keyof import("@stigmer/sdk").AgentInput) =>
    saveError?.field === field ? saveError.message : undefined;
  const handleInstructionsSave = useCallback(
    async (v: string) => saveField?.("instructions", v || undefined) ?? false,
    [saveField],
  );

  const handleMcpServersSave = useCallback(
    async (refs: ResourceRefRow[]) =>
      saveField?.(
        "mcpServerUsages",
        refs.map((r) => ({
          mcpServerRef: { org: r.org, slug: r.slug },
        })),
      ) ?? false,
    [saveField],
  );

  const handleSkillsSave = useCallback(
    async (refs: ResourceRefRow[]) =>
      saveField?.(
        "skillRefs",
        refs.map((r) => ({ org: r.org, slug: r.slug })),
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

  const mcpRefRows: ResourceRefRow[] = useMemo(
    () =>
      (spec?.mcpServerUsages ?? []).map((u) => ({
        org: u.mcpServerRef?.org || agentOrg,
        slug: u.mcpServerRef?.slug ?? "",
        label:
          u.mcpServerRef?.org && u.mcpServerRef.org !== agentOrg
            ? `${u.mcpServerRef.org}/${u.mcpServerRef.slug}`
            : u.mcpServerRef?.slug ?? "",
      })),
    [spec?.mcpServerUsages, agentOrg],
  );

  const skillRefRows: ResourceRefRow[] = useMemo(
    () =>
      (spec?.skillRefs ?? []).map((ref) => ({
        org: ref.org || agentOrg,
        slug: ref.slug,
        label:
          ref.org && ref.org !== agentOrg
            ? `${ref.org}/${ref.slug}`
            : ref.slug,
      })),
    [spec?.skillRefs, agentOrg],
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
  const showMcpServers = editable || (spec && spec.mcpServerUsages.length > 0);
  const showSkills = editable || (spec && spec.skillRefs.length > 0);
  const showSubAgents = editable || (spec && spec.subAgents.length > 0);
  const showEnv = editable || (spec?.env && Object.keys(spec.env).length > 0);

  const [mcpEditing, setMcpEditing] = useState(false);
  const [skillsEditing, setSkillsEditing] = useState(false);
  const [envEditing, setEnvEditing] = useState(false);

  // Entering edit mode discards the previous attempt's error — the
  // message describes a stale draft, not the one being composed.
  const handleMcpEditingChange = useCallback(
    (editing: boolean) => {
      if (editing) clearSaveError?.();
      setMcpEditing(editing);
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

      {showMcpServers && (
        <Section title="MCP Servers" count={spec?.mcpServerUsages.length} onEdit={editable ? () => handleMcpEditingChange(!mcpEditing) : undefined}>
          {editable ? (
            <InlineEditResourceList
              value={mcpRefRows}
              onSave={handleMcpServersSave}
              isSaving={isSaving}
              error={errorFor("mcpServerUsages")}
              editing={mcpEditing}
              onEditingChange={handleMcpEditingChange}
              onItemClick={onMcpServerClick ? (ref) => onMcpServerClick({ org: ref.org, slug: ref.slug }) : undefined}
              itemIcon={<McpServerIcon className="stg:size-4" />}
              resourceLabel="MCP server"
              defaultOrg={agentOrg}
            />
          ) : (
            <McpUsagesContent
              usages={spec?.mcpServerUsages ?? []}
              defaultOrg={agentOrg}
              onMcpServerClick={onMcpServerClick}
            />
          )}
        </Section>
      )}

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
              onItemClick={onSkillClick ? (ref) => onSkillClick({ org: ref.org, slug: ref.slug }) : undefined}
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

      {showSubAgents && (
        <SubAgentsSection
          subAgents={spec?.subAgents ?? []}
          editable={editable}
          isSaving={isSaving}
          error={errorFor("subAgents")}
          onSave={(subs) => saveField?.("subAgents", subs.length > 0 ? subs : undefined) ?? Promise.resolve(false)}
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

function McpUsagesContent({
  usages,
  defaultOrg,
  onMcpServerClick,
}: {
  readonly usages: readonly McpServerUsage[];
  readonly defaultOrg: string;
  readonly onMcpServerClick?: (ref: { org: string; slug: string }) => void;
}) {
  return (
    <div className="stg:flex stg:flex-col">
      {usages.map((usage, index) => {
        const ref = usage.mcpServerRef;
        if (!ref) return null;

        const refOrg = ref.org || defaultOrg;
        const label =
          ref.org && ref.org !== defaultOrg
            ? `${ref.org}/${ref.slug}`
            : ref.slug;
        const toolCount = usage.enabledTools.length;
        const approvalCount = usage.toolApprovalOverrides.length;

        const summary = [
          toolCount > 0
            ? `${toolCount} ${toolCount === 1 ? "tool" : "tools"}`
            : "all tools",
          approvalCount > 0
            ? `${approvalCount} approval ${approvalCount === 1 ? "override" : "overrides"}`
            : "",
        ]
          .filter(Boolean)
          .join(" \u00B7 ");

        const row = (
          <div className="stg:flex stg:items-center stg:gap-3">
            <McpServerIcon className="stg:size-4 stg:shrink-0 stg:text-muted-foreground" />
            <span className="stg:text-sm stg:font-medium stg:text-foreground">
              {label}
            </span>
            <span className="stg:text-xs stg:text-muted-foreground">{summary}</span>
          </div>
        );

        return onMcpServerClick ? (
          <button
            key={ref.slug || index}
            type="button"
            onClick={() =>
              onMcpServerClick({ org: refOrg, slug: ref.slug })
            }
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

function SkillsContent({
  refs,
  defaultOrg,
  onSkillClick,
}: {
  readonly refs: readonly ApiResourceReference[];
  readonly defaultOrg: string;
  readonly onSkillClick?: (ref: { org: string; slug: string }) => void;
}) {
  return (
    <div className="stg:flex stg:flex-col">
      {refs.map((ref, index) => {
        const refOrg = ref.org || defaultOrg;
        const label =
          ref.org && ref.org !== defaultOrg
            ? `${ref.org}/${ref.slug}`
            : ref.slug;

        const row = (
          <div className="stg:flex stg:items-center stg:gap-3">
            <SkillIcon className="stg:size-4 stg:shrink-0 stg:text-muted-foreground" />
            <span className="stg:text-sm stg:font-medium stg:text-foreground">
              {label}
            </span>
          </div>
        );

        return onSkillClick ? (
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

interface SubAgentDraft {
  name: string;
  description: string;
  instructions: string;
}

function SubAgentsSection({
  subAgents,
  editable,
  isSaving,
  error,
  onSave,
}: {
  readonly subAgents: readonly SubAgent[];
  readonly editable?: boolean;
  readonly isSaving?: boolean;
  readonly error?: string | null;
  readonly onSave?: (subs: import("@stigmer/sdk").SubAgentInput[]) => Promise<boolean>;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [isEditing, setIsEditing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addDraft, setAddDraft] = useState<SubAgentDraft>({ name: "", description: "", instructions: "" });

  const toggle = (index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleRemove = useCallback(
    async (index: number) => {
      if (!onSave) return;
      const updated = subAgents
        .filter((_, i) => i !== index)
        .map((sa) => ({
          name: sa.name,
          description: sa.description || undefined,
          instructions: sa.instructions || undefined,
          mcpAccess: sa.mcpAccess.length > 0
            ? sa.mcpAccess.map((a) => ({ mcpServer: a.mcpServer, enabledTools: a.enabledTools.length > 0 ? [...a.enabledTools] : undefined }))
            : undefined,
          skillRefs: sa.skillRefs.length > 0
            ? sa.skillRefs.map((r) => ({ org: r.org || "", slug: r.slug }))
            : undefined,
          modelOverride: sa.modelOverride || undefined,
        }));
      await onSave(updated);
    },
    [subAgents, onSave],
  );

  const handleAdd = useCallback(async () => {
    if (!onSave || !addDraft.name.trim()) return;
    const existing = subAgents.map((sa) => ({
      name: sa.name,
      description: sa.description || undefined,
      instructions: sa.instructions || undefined,
      mcpAccess: sa.mcpAccess.length > 0
        ? sa.mcpAccess.map((a) => ({ mcpServer: a.mcpServer, enabledTools: a.enabledTools.length > 0 ? [...a.enabledTools] : undefined }))
        : undefined,
      skillRefs: sa.skillRefs.length > 0
        ? sa.skillRefs.map((r) => ({ org: r.org || "", slug: r.slug }))
        : undefined,
      modelOverride: sa.modelOverride || undefined,
    }));
    const newSub = {
      name: addDraft.name.trim(),
      description: addDraft.description.trim() || undefined,
      instructions: addDraft.instructions.trim() || undefined,
    };
    const ok = await onSave([...existing, newSub]);
    if (ok) {
      setAddDraft({ name: "", description: "", instructions: "" });
      setShowAddForm(false);
    }
  }, [subAgents, addDraft, onSave]);

  return (
    <Section title="Sub-Agents" count={subAgents.length} onEdit={editable ? () => setIsEditing((v) => !v) : undefined}>
      <div className="stg:flex stg:flex-col">
        {subAgents.length > 0 ? (
          <div className="stg:flex stg:flex-col stg:divide-y stg:divide-border">
            {subAgents.map((sa, index) => {
              const isOpen = expanded.has(index);

              return (
                <div key={sa.name || index}>
                  <div className="stg:flex stg:items-start stg:gap-3 stg:px-3 stg:py-2.5">
                    <button
                      type="button"
                      onClick={() => toggle(index)}
                      aria-expanded={isOpen}
                      className={cn(
                        "stg:flex stg:flex-1 stg:items-start stg:gap-3 stg:text-left",
                        "stg:focus-visible:outline-none",
                      )}
                    >
                      <ChevronRightIcon
                        className={cn(
                          "stg:mt-0.5 stg:size-4 stg:shrink-0 stg:text-muted-foreground stg:transition-transform",
                          isOpen && "stg:rotate-90",
                        )}
                      />
                      <div className="stg:min-w-0 stg:flex-1">
                        <span className="stg:text-sm stg:font-medium stg:text-foreground">
                          {sa.name}
                        </span>
                        {sa.description && (
                          <p className="stg:mt-0.5 stg:text-xs stg:text-muted-foreground">
                            {sa.description}
                          </p>
                        )}
                      </div>
                    </button>
                    {isEditing && (
                      <button
                        type="button"
                        onClick={() => handleRemove(index)}
                        disabled={isSaving}
                        aria-label={`Remove ${sa.name}`}
                        className={cn(
                          "stg:mt-0.5 stg:inline-flex stg:size-6 stg:items-center stg:justify-center stg:rounded-md stg:text-muted-foreground",
                          "stg:hover:bg-destructive-subtle stg:hover:text-destructive",
                          "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                        )}
                      >
                        <XRemoveIcon className="stg:size-3.5" />
                      </button>
                    )}
                  </div>

                  {isOpen && (
                    <SubAgentDetails subAgent={sa} />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="stg:px-3 stg:py-3 stg:text-xs stg:text-muted-foreground stg:italic">
            No sub-agents configured
          </p>
        )}

        {editable && isEditing && !showAddForm && (
          <div className="stg:border-t stg:border-border stg:px-3 stg:py-2">
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className={cn(
                "stg:inline-flex stg:items-center stg:gap-1 stg:rounded-md stg:px-2.5 stg:py-1.5 stg:text-xs stg:font-medium",
                "stg:border stg:border-dashed stg:border-border stg:text-muted-foreground",
                "stg:hover:border-muted-foreground stg:hover:text-foreground stg:hover:bg-muted-subtle",
                "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                "stg:transition-colors",
              )}
            >
              <PlusAddIcon className="stg:size-3" />
              Add sub-agent
            </button>
          </div>
        )}

        {error && (
          <p className="stg:border-t stg:border-border stg:px-3 stg:py-2 stg:text-xs stg:text-destructive" role="alert">
            {error}
          </p>
        )}

        {editable && showAddForm && (
          <div className="stg:border-t stg:border-border stg:p-3 stg:space-y-2">
            <input
              type="text"
              value={addDraft.name}
              onChange={(e) => setAddDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Sub-agent name (required)"
              className={cn(
                "stg:w-full stg:rounded-md stg:border stg:border-border stg:bg-input-bg stg:px-2 stg:py-1.5 stg:text-sm stg:text-foreground",
                "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
              )}
            />
            <input
              type="text"
              value={addDraft.description}
              onChange={(e) => setAddDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="Description (optional)"
              className={cn(
                "stg:w-full stg:rounded-md stg:border stg:border-border stg:bg-input-bg stg:px-2 stg:py-1.5 stg:text-xs stg:text-foreground",
                "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
              )}
            />
            <textarea
              value={addDraft.instructions}
              onChange={(e) => setAddDraft((d) => ({ ...d, instructions: e.target.value }))}
              placeholder="Instructions (optional)"
              rows={2}
              className={cn(
                "stg:w-full stg:resize-y stg:rounded-md stg:border stg:border-border stg:bg-input-bg stg:px-2 stg:py-1.5 stg:font-mono stg:text-xs stg:text-foreground",
                "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
              )}
            />
            <div className="stg:flex stg:items-center stg:justify-end stg:gap-1.5">
              <button
                type="button"
                onClick={() => { setShowAddForm(false); setAddDraft({ name: "", description: "", instructions: "" }); }}
                className={cn(
                  "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
                  "stg:border stg:border-border stg:bg-background stg:text-foreground stg:hover:bg-accent",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                )}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={!addDraft.name.trim() || isSaving}
                className={cn(
                  "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
                  "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
                  "stg:disabled:opacity-50",
                  "stg:focus-visible:outline-none stg:focus-visible:ring-2 stg:focus-visible:ring-ring",
                )}
              >
                Add
              </button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}

function SubAgentDetails({
  subAgent: sa,
}: {
  readonly subAgent: SubAgent;
}) {
  return (
    <div className="stg:mb-1 stg:ml-7 stg:space-y-3 stg:border-l stg:border-border stg:pl-4 stg:pt-1">
      {sa.instructions && (
        <div>
          <h4 className="stg:mb-1 stg:text-xs stg:font-medium stg:text-muted-foreground">
            Instructions
          </h4>
          <pre className="stg:whitespace-pre-wrap stg:break-words stg:rounded-md stg:bg-muted-subtle stg:p-2 stg:font-mono stg:text-xs stg:text-foreground">
            {sa.instructions}
          </pre>
        </div>
      )}

      {sa.mcpAccess.length > 0 && (
        <div>
          <h4 className="stg:mb-1 stg:text-xs stg:font-medium stg:text-muted-foreground">
            MCP Access
          </h4>
          <div className="stg:space-y-1">
            {sa.mcpAccess.map((access) => (
              <div
                key={access.mcpServer}
                className="stg:flex stg:items-center stg:gap-2 stg:text-xs stg:text-foreground"
              >
                <McpServerIcon className="stg:size-3 stg:shrink-0 stg:text-muted-foreground" />
                <span className="stg:font-medium">{access.mcpServer}</span>
                <span className="stg:text-muted-foreground">
                  {access.enabledTools.length > 0
                    ? `${access.enabledTools.length} ${access.enabledTools.length === 1 ? "tool" : "tools"}`
                    : "all tools"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {sa.skillRefs.length > 0 && (
        <div>
          <h4 className="stg:mb-1 stg:text-xs stg:font-medium stg:text-muted-foreground">
            Skills
          </h4>
          <div className="stg:space-y-1">
            {sa.skillRefs.map((ref) => (
              <div
                key={ref.slug}
                className="stg:flex stg:items-center stg:gap-2 stg:text-xs stg:text-foreground"
              >
                <SkillIcon className="stg:size-3 stg:shrink-0 stg:text-muted-foreground" />
                <span>
                  {ref.org ? `${ref.org}/${ref.slug}` : ref.slug}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {sa.modelOverride && (
        <div>
          <h4 className="stg:mb-1 stg:text-xs stg:font-medium stg:text-muted-foreground">
            Model Override
          </h4>
          <span className="stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:font-mono stg:text-xs stg:text-foreground">
            {sa.modelOverride}
          </span>
        </div>
      )}
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
          <span className="stg:shrink-0 stg:rounded stg:bg-muted stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-muted-foreground">
            {env.isSecret ? "secret" : "config"}
          </span>
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
    <div
      className={cn("stg:flex stg:flex-col stg:gap-6", className)}
      aria-busy="true"
      aria-label="Loading agent details"
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
    </div>
  );
}

function NotFoundState({ className }: { readonly className?: string }) {
  return (
    <div
      role="status"
      className={cn(
        "stg:flex stg:flex-col stg:items-center stg:gap-2 stg:py-12 stg:text-center",
        className,
      )}
    >
      <AgentIcon className="stg:size-10 stg:text-muted-foreground-faint" />
      <p className="stg:text-sm stg:font-medium stg:text-muted-foreground">
        Agent not found
      </p>
      <p className="stg:text-xs stg:text-muted-foreground-subtle">
        This agent doesn&apos;t exist or you don&apos;t have access to it.
      </p>
    </div>
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

function McpServerIcon({ className }: { readonly className?: string }) {
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
      <rect x="2" y="2" width="12" height="5" rx="1" />
      <rect x="2" y="9" width="12" height="5" rx="1" />
      <circle cx="5" cy="4.5" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="5" cy="11.5" r="0.75" fill="currentColor" stroke="none" />
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

function ChevronRightIcon({ className }: { readonly className?: string }) {
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
      <path d="m6 3 5 5-5 5" />
    </svg>
  );
}

function XRemoveIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

function PlusAddIcon({ className }: { readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}
