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
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { useAgent } from "./useAgent";
import { useUpdateAgent } from "./useUpdateAgent";
import { agentToInput } from "./internal/agentToInput";
import { ErrorMessage } from "../error/ErrorMessage";
import { VisibilityToggle } from "../library/VisibilityToggle";
import { ResourceDetailShell } from "../resource-detail/ResourceDetailShell";
import { useDetailTabs } from "../resource-detail/useDetailTabs";
import type { AdditionalTab, DetailAction, ResourceHeaderMeta } from "../resource-detail/types";
import type { TabItem } from "../tabs/Tabs";
import { DependencyGraph } from "../dependency-graph/DependencyGraph";
import { useDependencyGraph } from "../dependency-graph/useDependencyGraph";
import type { DependencyNode } from "../dependency-graph/types";
import { InlineEditText } from "../inline-edit/InlineEditText";
import { InlineEditTextarea } from "../inline-edit/InlineEditTextarea";
import { InlineEditImage } from "../inline-edit/InlineEditImage";
import { InlineEditKeyValue } from "../inline-edit/InlineEditKeyValue";
import { InlineEditResourceList } from "../inline-edit/InlineEditResourceList";
import type { KeyValueRow, ResourceRefRow } from "../inline-edit/types";

const INSTRUCTIONS_COLLAPSED_LINES = 8;

const OVERVIEW_TAB: TabItem = { id: "overview", label: "Overview" };
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
   * Called when the user toggles visibility via the inline control.
   * When provided, the header renders an interactive
   * {@link VisibilityToggle} instead of a read-only badge.
   * When omitted, visibility is displayed as a static "Public" pill.
   */
  readonly onVisibilityChange?: (v: ApiResourceVisibility) => void;
  /** `true` while a visibility update RPC is in flight. */
  readonly isVisibilityPending?: boolean;
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
  onVisibilityChange,
  isVisibilityPending,
  primaryAction,
  actions,
  additionalTabs,
  activeTab,
  onTabChange,
  defaultTab,
  editable = false,
  onResourceUpdated,
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
    () => (noDeps ? [OVERVIEW_TAB] : [OVERVIEW_TAB, DEPENDENCIES_TAB]),
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
    description: editable ? undefined : spec?.description,
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

  const isPublic = meta?.visibility === ApiResourceVisibility.visibility_public;
  const visibilityControl =
    onVisibilityChange && meta ? (
      <VisibilityToggle
        visibility={meta.visibility}
        onVisibilityChange={onVisibilityChange}
        isPending={isVisibilityPending}
      />
    ) : isPublic ? (
      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        Public
      </span>
    ) : undefined;

  let tabContent: React.ReactNode;
  if (activeAdditionalTab) {
    tabContent = activeAdditionalTab.content;
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
        onMcpServerClick={onMcpServerClick}
        onSkillClick={onSkillClick}
        editable={editable}
        isSaving={isUpdating}
        saveField={saveField}
      />
    );
  }

  return (
    <ResourceDetailShell
      header={headerMeta}
      visibilityControl={visibilityControl}
      primaryAction={primaryAction}
      actions={actions}
      tabs={effectiveTabs}
      activeTab={effectiveTabs ? effectiveActiveTab : undefined}
      onTabChange={effectiveTabs ? effectiveOnTabChange : undefined}
      tabsAriaLabel="Agent detail sections"
      className={className}
    >
      {editable && (
        <div className="flex flex-col gap-1 -mt-2 mb-2">
          <InlineEditText
            value={meta?.name || ""}
            onSave={(v) => saveField("name", v)}
            isSaving={isUpdating}
            variant="heading"
            placeholder="Agent name"
            validate={(v) => (v.trim() ? null : "Name is required")}
          />
          <InlineEditText
            value={spec?.description || ""}
            onSave={(v) => saveField("description", v || undefined)}
            isSaving={isUpdating}
            placeholder="Add a description"
          />
        </div>
      )}
      {tabContent}
    </ResourceDetailShell>
  );
}

// ---------------------------------------------------------------------------
// Overview content — the agent's configuration sections
// ---------------------------------------------------------------------------

function AgentOverview({
  spec,
  agentOrg,
  onMcpServerClick,
  onSkillClick,
  editable,
  isSaving,
  saveField,
}: {
  readonly spec: NonNullable<ReturnType<typeof useAgent>["agent"]>["spec"];
  readonly agentOrg: string;
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

  const showInstructions = editable || !!spec?.instructions;
  const showMcpServers = editable || (spec && spec.mcpServerUsages.length > 0);
  const showSkills = editable || (spec && spec.skillRefs.length > 0);
  const showSubAgents = spec && spec.subAgents.length > 0;
  const showEnv = editable || (spec?.env && Object.keys(spec.env).length > 0);

  return (
    <div className="flex flex-col gap-6 pt-2">
      {showInstructions && (
        <Section title="Instructions">
          {editable ? (
            <div className="p-3">
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
        <Section title={`MCP Servers${!editable && spec ? ` (${spec.mcpServerUsages.length})` : ""}`}>
          {editable ? (
            <InlineEditResourceList
              value={mcpRefRows}
              onSave={handleMcpServersSave}
              isSaving={isSaving}
              onItemClick={onMcpServerClick ? (ref) => onMcpServerClick({ org: ref.org, slug: ref.slug }) : undefined}
              itemIcon={<McpServerIcon className="size-4" />}
              resourceLabel="MCP server"
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
        <Section title={`Skills${!editable && spec ? ` (${spec.skillRefs.length})` : ""}`}>
          {editable ? (
            <InlineEditResourceList
              value={skillRefRows}
              onSave={handleSkillsSave}
              isSaving={isSaving}
              onItemClick={onSkillClick ? (ref) => onSkillClick({ org: ref.org, slug: ref.slug }) : undefined}
              itemIcon={<SkillIcon className="size-4" />}
              resourceLabel="skill"
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
        <SubAgentsSection subAgents={spec!.subAgents} />
      )}

      {showEnv && (
        <Section title={`Environment Variables${!editable ? ` (${Object.keys(spec?.env ?? {}).length})` : ""}`}>
          {editable ? (
            <InlineEditKeyValue
              value={envRows}
              onSave={handleEnvSave}
              isSaving={isSaving}
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
  const lines = text.split("\n");
  const needsCollapse = lines.length > INSTRUCTIONS_COLLAPSED_LINES;
  const [expanded, setExpanded] = useState(false);

  const displayText =
    needsCollapse && !expanded
      ? lines.slice(0, INSTRUCTIONS_COLLAPSED_LINES).join("\n")
      : text;

  return (
    <div className="p-3">
      <pre className="whitespace-pre-wrap break-words font-mono text-sm text-foreground">
        {displayText}
        {needsCollapse && !expanded && "\u2026"}
      </pre>
      {needsCollapse && (
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

function SubAgentsSection({
  subAgents,
}: {
  readonly subAgents: readonly SubAgent[];
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <Section title={`Sub-Agents (${subAgents.length})`}>
      <div className="flex flex-col">
        {subAgents.map((sa, index) => {
          const isOpen = expanded.has(index);

          return (
            <div key={sa.name || index}>
              <button
                type="button"
                onClick={() => toggle(index)}
                aria-expanded={isOpen}
                className={cn(
                  "flex w-full items-start gap-3 rounded-md px-3 py-2 text-left transition-colors",
                  "hover:bg-accent-hover",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
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

              {isOpen && (
                <SubAgentDetails subAgent={sa} />
              )}
            </div>
          );
        })}
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

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="overflow-hidden rounded-lg border border-border">
        {children}
      </div>
    </section>
  );
}

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
