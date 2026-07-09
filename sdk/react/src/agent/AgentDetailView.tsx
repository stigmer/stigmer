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
import { agentToInput } from "./internal/agentToInput.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { VisibilityBadge } from "../library/VisibilitySelector.js";
import { useManageAccess } from "../access/useManageAccess.js";
import { useShareAgent } from "../sharing/useShareAgent.js";
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
   * Builds the absolute public chat URL shown in the Share dialog.
   * The host application owns URL construction — its configured public
   * origin may differ from the rendering origin (e.g. the desktop app).
   * When omitted, the dialog falls back to the relative
   * `/chat/<org>/<slug>` path.
   */
  readonly buildShareUrl?: (org: string, slug: string) => string;
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
 * sections (instructions, MCP server usages, skills, sub-agents, and
 * environment variables). Sections with no data are omitted entirely
 * — reducing visual noise per Nielsen heuristic #8.
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
  onCreateInstanceClick,
  onInstanceClick,
  onInstanceStartSessionClick,
  onInstanceDeleteClick,
  instancesRefreshKey,
  className,
}: AgentDetailViewProps) {
  const { agent, isLoading, error, refetch } = useAgent(org, slug);
  const { update, isUpdating } = useUpdateAgent();

  const saveField = useCallback(
    async <K extends keyof import("@stigmer/sdk").AgentInput>(
      field: K,
      value: import("@stigmer/sdk").AgentInput[K],
    ): Promise<boolean> => {
      if (!agent) return false;
      const input = agentToInput(agent);
      (input as unknown as Record<string, unknown>)[field] = value;
      try {
        const updated = await update(input);
        onResourceUpdated?.(updated);
        refetch();
        return true;
      } catch {
        return false;
      }
    },
    [agent, update, onResourceUpdated, refetch],
  );

  const { tree, isEmpty: noDeps } = useDependencyGraph({
    agentName: agent?.metadata?.name || agent?.metadata?.slug || slug,
    agentOrg: agent?.metadata?.org || org,
    spec: agent?.spec,
  });

  const builtInTabs = useMemo<readonly TabItem[]>(
    () =>
      noDeps
        ? [OVERVIEW_TAB, INSTANCES_TAB]
        : [OVERVIEW_TAB, INSTANCES_TAB, DEPENDENCIES_TAB],
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

  // Share — the sibling consent to Manage access: visibility governs who
  // can read the blueprint; sharing governs who can chat with the running
  // agent (billed to the owning org). Same null-until-ready contract.
  const share = useShareAgent({
    agent,
    buildShareUrl,
    onSharingChanged: refetch,
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
          fallback={<AgentIcon className="size-6 text-muted-foreground" />}
          disabled={!editable}
        />
      )
      : spec?.iconUrl ? undefined : <AgentIcon className="size-6 text-muted-foreground" />,
    createdAt: specAudit?.createdAt ? timestampDate(specAudit.createdAt) : null,
    updatedAt: specAudit?.updatedAt ? timestampDate(specAudit.updatedAt) : null,
  };

  // Inline visibility is read-only (at-a-glance); editing lives in the
  // Manage access dialog, the single writer for both access axes.
  const visibilityControl = meta ? (
    <VisibilityBadge visibility={meta.visibility} />
  ) : undefined;

  // Share precedes Manage access within the "sharing" group.
  const injectedActions = [share.action, access.action].filter(
    (a): a is NonNullable<typeof a> => a != null,
  );
  const mergedActions =
    injectedActions.length > 0
      ? [...(actions ?? []), ...injectedActions]
      : actions;

  let tabContent: React.ReactNode;
  if (activeAdditionalTab) {
    tabContent = activeAdditionalTab.content;
  } else if (effectiveActiveTab === "instances") {
    tabContent = (
      <AgentInstanceList
        agentId={meta?.id ?? ""}
        defaultInstanceId={agent.status?.defaultInstanceId}
        org={org}
        onCreateClick={onCreateInstanceClick}
        onInstanceClick={onInstanceClick}
        onStartSessionClick={onInstanceStartSessionClick}
        onDeleteClick={onInstanceDeleteClick}
        refreshKey={instancesRefreshKey}
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
      {share.dialog}
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
}) {
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

  return (
    <div className="flex flex-col gap-6">
      {showDescription && (
        <Section title="Description">
          {editable ? (
            <div className="max-h-20 overflow-y-auto p-3">
              <InlineEditTextarea
                value={spec?.description || ""}
                onSave={(v) => saveField?.("description", v || undefined) ?? Promise.resolve(false)}
                isSaving={isSaving}
                placeholder="Add a description"
                minRows={2}
              />
            </div>
          ) : (
            <div className="p-3">
              <pre className="whitespace-pre-wrap break-words text-sm text-foreground font-sans">
                {description}
              </pre>
            </div>
          )}
        </Section>
      )}

      {showInstructions && (
        <Section title="Instructions">
          {editable ? (
            <div className="max-h-72 overflow-y-auto p-3">
              <InlineEditTextarea
                value={spec?.instructions ?? ""}
                onSave={handleInstructionsSave}
                isSaving={isSaving}
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
        <Section title="MCP Servers" count={spec?.mcpServerUsages.length} onEdit={editable ? () => setMcpEditing((v) => !v) : undefined}>
          {editable ? (
            <InlineEditResourceList
              value={mcpRefRows}
              onSave={handleMcpServersSave}
              isSaving={isSaving}
              editing={mcpEditing}
              onEditingChange={setMcpEditing}
              onItemClick={onMcpServerClick ? (ref) => onMcpServerClick({ org: ref.org, slug: ref.slug }) : undefined}
              itemIcon={<McpServerIcon className="size-4" />}
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
        <Section title="Skills" count={spec?.skillRefs.length} onEdit={editable ? () => setSkillsEditing((v) => !v) : undefined}>
          {editable ? (
            <InlineEditResourceList
              value={skillRefRows}
              onSave={handleSkillsSave}
              isSaving={isSaving}
              editing={skillsEditing}
              onEditingChange={setSkillsEditing}
              onItemClick={onSkillClick ? (ref) => onSkillClick({ org: ref.org, slug: ref.slug }) : undefined}
              itemIcon={<SkillIcon className="size-4" />}
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
          onSave={(subs) => saveField?.("subAgents", subs.length > 0 ? subs : undefined) ?? Promise.resolve(false)}
        />
      )}

      {showEnv && (
        <Section title="Environment Variables" count={Object.keys(spec?.env ?? {}).length} onEdit={editable ? () => setEnvEditing((v) => !v) : undefined}>
          {editable ? (
            <InlineEditKeyValue
              value={envRows}
              onSave={handleEnvSave}
              isSaving={isSaving}
              editing={envEditing}
              onEditingChange={setEnvEditing}
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
    <div className="relative p-3">
      <pre
        ref={contentRef}
        className={cn(
          "whitespace-pre-wrap break-words font-mono text-sm text-foreground overflow-y-auto transition-[max-height] duration-200",
          !expanded && "overflow-hidden",
        )}
        style={{ maxHeight: expanded ? "none" : INSTRUCTIONS_COLLAPSED_HEIGHT }}
      >
        {text}
      </pre>
      {!expanded && overflows && (
        <div className="pointer-events-none absolute inset-x-3 bottom-10 h-8 bg-gradient-to-t from-background to-transparent" />
      )}
      {overflows && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-xs font-medium text-primary transition-colors hover:text-primary-muted"
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
    <div className="flex flex-col">
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
          <div className="flex items-center gap-3">
            <McpServerIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
              {label}
            </span>
            <span className="text-xs text-muted-foreground">{summary}</span>
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
              "w-full rounded-md px-3 py-2 text-left transition-colors",
              "hover:bg-accent-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            )}
          >
            {row}
          </button>
        ) : (
          <div key={ref.slug || index} className="px-3 py-2">
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
    <div className="flex flex-col">
      {refs.map((ref, index) => {
        const refOrg = ref.org || defaultOrg;
        const label =
          ref.org && ref.org !== defaultOrg
            ? `${ref.org}/${ref.slug}`
            : ref.slug;

        const row = (
          <div className="flex items-center gap-3">
            <SkillIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">
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
              "w-full rounded-md px-3 py-2 text-left transition-colors",
              "hover:bg-accent-hover",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
            )}
          >
            {row}
          </button>
        ) : (
          <div key={ref.slug || index} className="px-3 py-2">
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
  onSave,
}: {
  readonly subAgents: readonly SubAgent[];
  readonly editable?: boolean;
  readonly isSaving?: boolean;
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
      <div className="flex flex-col">
        {subAgents.length > 0 ? (
          <div className="flex flex-col divide-y divide-border">
            {subAgents.map((sa, index) => {
              const isOpen = expanded.has(index);

              return (
                <div key={sa.name || index}>
                  <div className="flex items-start gap-3 px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggle(index)}
                      aria-expanded={isOpen}
                      className={cn(
                        "flex flex-1 items-start gap-3 text-left",
                        "focus-visible:outline-none",
                      )}
                    >
                      <ChevronRightIcon
                        className={cn(
                          "mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform",
                          isOpen && "rotate-90",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <span className="text-sm font-medium text-foreground">
                          {sa.name}
                        </span>
                        {sa.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
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
                          "mt-0.5 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground",
                          "hover:bg-destructive-subtle hover:text-destructive",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                      >
                        <XRemoveIcon className="size-3.5" />
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
          <p className="px-3 py-3 text-xs text-muted-foreground italic">
            No sub-agents configured
          </p>
        )}

        {editable && isEditing && !showAddForm && (
          <div className="border-t border-border px-3 py-2">
            <button
              type="button"
              onClick={() => setShowAddForm(true)}
              className={cn(
                "inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium",
                "border border-dashed border-border text-muted-foreground",
                "hover:border-muted-foreground hover:text-foreground hover:bg-muted-subtle",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "transition-colors",
              )}
            >
              <PlusAddIcon className="size-3" />
              Add sub-agent
            </button>
          </div>
        )}

        {editable && showAddForm && (
          <div className="border-t border-border p-3 space-y-2">
            <input
              type="text"
              value={addDraft.name}
              onChange={(e) => setAddDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Sub-agent name (required)"
              className={cn(
                "w-full rounded-md border border-border bg-input-bg px-2 py-1.5 text-sm text-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring",
              )}
            />
            <input
              type="text"
              value={addDraft.description}
              onChange={(e) => setAddDraft((d) => ({ ...d, description: e.target.value }))}
              placeholder="Description (optional)"
              className={cn(
                "w-full rounded-md border border-border bg-input-bg px-2 py-1.5 text-xs text-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring",
              )}
            />
            <textarea
              value={addDraft.instructions}
              onChange={(e) => setAddDraft((d) => ({ ...d, instructions: e.target.value }))}
              placeholder="Instructions (optional)"
              rows={2}
              className={cn(
                "w-full resize-y rounded-md border border-border bg-input-bg px-2 py-1.5 font-mono text-xs text-foreground",
                "focus:outline-none focus:ring-2 focus:ring-ring",
              )}
            />
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={() => { setShowAddForm(false); setAddDraft({ name: "", description: "", instructions: "" }); }}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium",
                  "border border-border bg-background text-foreground hover:bg-accent",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAdd}
                disabled={!addDraft.name.trim() || isSaving}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium",
                  "bg-primary text-primary-foreground hover:bg-primary-hover",
                  "disabled:opacity-50",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
    <div className="mb-1 ml-7 space-y-3 border-l border-border pl-4 pt-1">
      {sa.instructions && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            Instructions
          </h4>
          <pre className="whitespace-pre-wrap break-words rounded-md bg-muted-subtle p-2 font-mono text-xs text-foreground">
            {sa.instructions}
          </pre>
        </div>
      )}

      {sa.mcpAccess.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            MCP Access
          </h4>
          <div className="space-y-1">
            {sa.mcpAccess.map((access) => (
              <div
                key={access.mcpServer}
                className="flex items-center gap-2 text-xs text-foreground"
              >
                <McpServerIcon className="size-3 shrink-0 text-muted-foreground" />
                <span className="font-medium">{access.mcpServer}</span>
                <span className="text-muted-foreground">
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
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            Skills
          </h4>
          <div className="space-y-1">
            {sa.skillRefs.map((ref) => (
              <div
                key={ref.slug}
                className="flex items-center gap-2 text-xs text-foreground"
              >
                <SkillIcon className="size-3 shrink-0 text-muted-foreground" />
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
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">
            Model Override
          </h4>
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">
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
    <div className="flex flex-col divide-y divide-border">
      {entries.map(([name, env]) => (
        <div key={name} className="flex items-start gap-3 px-3 py-2">
          <code className="shrink-0 font-mono text-sm font-medium text-foreground">
            {name}
          </code>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {env.isSecret ? "secret" : "config"}
          </span>
          {env.description && (
            <span className="text-xs text-muted-foreground">
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
      className={cn("flex flex-col gap-6", className)}
      aria-busy="true"
      aria-label="Loading agent details"
    >
      <div className="flex items-start gap-3">
        <div className="mt-1 size-6 shrink-0 animate-pulse rounded bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-48 animate-pulse rounded bg-muted" />
          <div className="h-3 w-64 animate-pulse rounded bg-muted" />
          <div className="h-4 w-full max-w-md animate-pulse rounded bg-muted" />
        </div>
      </div>
      {[40, 24, 16].map((h) => (
        <div key={h} className="space-y-2">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div
            className="animate-pulse rounded-lg border border-border bg-muted-faint"
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
        "flex flex-col items-center gap-2 py-12 text-center",
        className,
      )}
    >
      <AgentIcon className="size-10 text-muted-foreground-faint" />
      <p className="text-sm font-medium text-muted-foreground">
        Agent not found
      </p>
      <p className="text-xs text-muted-foreground-subtle">
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
