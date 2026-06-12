"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { ValidationState } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import type { WorkflowInput } from "@stigmer/sdk";
import { useWorkflow } from "./useWorkflow";
import { useUpdateWorkflow } from "./useUpdateWorkflow";
import { workflowToInput } from "./internal/workflowToInput";
import { useWorkflowExecutionList } from "./useWorkflowExecutionList";
import { useWorkflowDashboardSummary } from "./useWorkflowDashboardSummary";
import { WorkflowOverviewGraph } from "./WorkflowOverviewGraph";
import { WorkflowGraphFullscreenDialog } from "./WorkflowGraphFullscreenDialog";
import { WorkflowOverviewSummary } from "./WorkflowOverviewSummary";
import { WorkflowExplainDialog } from "./WorkflowExplainDialog";
import { serializeWorkflowYaml } from "./serialize-workflow-yaml";
import { WorkflowExecutionHistory } from "./execution-history/WorkflowExecutionHistory";
import { WorkflowInstanceList } from "./instance/WorkflowInstanceList";
import { WorkflowVersionsTab } from "./WorkflowVersionsTab";
import { useWorkflowVersions } from "./useWorkflowVersions";
import { ErrorMessage } from "../error/ErrorMessage";
import { VisibilityBadge } from "../library/VisibilitySelector";
import { useManageAccess } from "../access/useManageAccess";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { formatDurationSec } from "./format-utils";
import { ResourceDetailShell } from "../resource-detail/ResourceDetailShell";
import { Section } from "../resource-detail/Section";
import { useDetailTabs } from "../resource-detail/useDetailTabs";
import { InlineEditTextarea } from "../inline-edit/InlineEditTextarea";
import { InlineEditKeyValue } from "../inline-edit/InlineEditKeyValue";
import type { KeyValueRow } from "../inline-edit/types";
import type { AdditionalTab, DetailAction, ResourceHeaderMeta } from "../resource-detail/types";
import type { TabItem } from "../tabs/Tabs";

const OVERVIEW_TAB: TabItem = { id: "overview", label: "Overview" };
const INSTANCES_TAB: TabItem = { id: "instances", label: "Instances" };
const EXECUTIONS_TAB: TabItem = { id: "executions", label: "Executions" };
const VERSIONS_TAB: TabItem = { id: "versions", label: "Versions" };

const DESCRIPTION_COLLAPSED_HEIGHT = "8rem";

/** Props for {@link WorkflowDetailView}. */
export interface WorkflowDetailViewProps {
  /** Organization slug that owns the workflow. */
  readonly org: string;
  /** Workflow slug (URL-friendly identifier unique within the org). */
  readonly slug: string;
  /**
   * Called once when the workflow resource has been fetched successfully.
   * Provides the resource display name for breadcrumbs, document titles, etc.
   */
  readonly onResourceLoad?: (meta: { name: string; id: string }) => void;
  /**
   * Primary action rendered as a visible button in the header area.
   */
  readonly primaryAction?: DetailAction;
  /**
   * Secondary actions rendered in the kebab overflow menu.
   */
  readonly actions?: readonly DetailAction[];
  /**
   * Additional tabs to render alongside the built-in tabs.
   */
  readonly additionalTabs?: readonly AdditionalTab[];
  /** Controlled active tab ID. */
  readonly activeTab?: string;
  /** Controlled tab change handler. */
  readonly onTabChange?: (tabId: string) => void;
  /** Default active tab ID when in uncontrolled mode. @default "overview" */
  readonly defaultTab?: string;
  /**
   * Called when a user clicks an execution row in the Executions tab.
   * Receives the execution ID — use for navigation to the execution viewer.
   */
  readonly onExecutionClick?: (executionId: string) => void;
  /**
   * Called when the user clicks "Create Instance" in the Instances tab.
   * Opens the create instance dialog.
   */
  readonly onCreateInstanceClick?: () => void;
  /**
   * Called when the user clicks an instance row in the Instances tab.
   */
  readonly onInstanceClick?: (instance: WorkflowInstance) => void;
  /**
   * Called when the user clicks "Run" on a specific instance.
   */
  readonly onInstanceRunClick?: (instance: WorkflowInstance) => void;
  /**
   * Called when the user clicks "Delete" on a specific instance.
   */
  readonly onInstanceDeleteClick?: (instance: WorkflowInstance) => void;
  /**
   * Increment this value to trigger a refetch of the instance list.
   * Useful after externally creating or deleting an instance.
   */
  readonly instancesRefreshKey?: number;
  /**
   * When `true`, description and environment variables become click-to-edit.
   * Each field saves independently via `stigmer.workflow.update()`.
   * @default false
   */
  readonly editable?: boolean;
  /**
   * Called after a successful inline field save with the updated workflow.
   */
  readonly onResourceUpdated?: (workflow: Workflow) => void;
  /**
   * Called when the user clicks "Open in editor" from the overview graph
   * node popover. Receives the task name. Wire this to switch to the
   * editor tab and optionally select the node.
   *
   * @since T12 (Overview Page Redesign)
   */
  readonly onOpenInEditor?: (taskName: string) => void;
  /**
   * Called when the user clicks "View latest run" in the overview quick
   * actions. Receives the execution ID of the most recent execution.
   *
   * @since T12 (Overview Page Redesign)
   */
  readonly onViewLatestRun?: (executionId: string) => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Operational detail hub for a Workflow blueprint.
 *
 * Fetches the workflow via {@link useWorkflow} internally and renders
 * its full specification inside a {@link ResourceDetailShell}:
 *
 * - **Overview**: Description, budget, env vars, task flow DAG, document metadata
 * - **Instances**: Environment-bound deployments (embedded, not standalone)
 * - **Executions**: Recent executions with phase badges and timing
 *
 * Handles loading, error, and not-found states automatically.
 * Zero Console dependencies — safe for platform builder embedding.
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <WorkflowDetailView org="acme" slug="onboard-user" />
 * ```
 */
export function WorkflowDetailView({
  org,
  slug,
  onResourceLoad,
  primaryAction,
  actions,
  additionalTabs,
  activeTab,
  onTabChange,
  defaultTab,
  onExecutionClick,
  onCreateInstanceClick,
  onInstanceClick,
  onInstanceRunClick,
  onInstanceDeleteClick,
  instancesRefreshKey,
  editable = false,
  onResourceUpdated,
  onOpenInEditor,
  onViewLatestRun,
  className,
}: WorkflowDetailViewProps) {
  const { workflow, isLoading, error, refetch } = useWorkflow(org, slug);
  const { update, isUpdating } = useUpdateWorkflow();
  const { versions } = useWorkflowVersions(
    isLoading ? null : org,
    isLoading ? null : slug,
  );

  const saveField = useCallback(
    async <K extends keyof WorkflowInput>(
      field: K,
      value: WorkflowInput[K],
    ): Promise<boolean> => {
      if (!workflow) return false;
      const input = workflowToInput(workflow);
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
    [workflow, update, onResourceUpdated, refetch],
  );

  const versionCount = versions.length;
  const builtInTabs = useMemo<readonly TabItem[]>(
    () => [
      OVERVIEW_TAB,
      INSTANCES_TAB,
      EXECUTIONS_TAB,
      {
        ...VERSIONS_TAB,
        ...(versionCount > 0 && { badge: versionCount }),
      },
    ],
    [versionCount],
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

  const onResourceLoadRef = useRef(onResourceLoad);
  onResourceLoadRef.current = onResourceLoad;

  useEffect(() => {
    if (workflow?.metadata?.name) {
      onResourceLoadRef.current?.({
        name: workflow.metadata.name,
        id: workflow.metadata.id,
      });
    }
  }, [workflow]);

  // Unified Manage access — visibility (General access) over explicit grants
  // (People), opened from the kebab. Replaces the host's bespoke share popover.
  const access = useManageAccess({
    resource: workflow?.metadata
      ? {
          kind: ApiResourceKind.workflow,
          kindString: "workflow",
          id: workflow.metadata.id,
          org: workflow.metadata.org || org,
          name: workflow.metadata.name,
        }
      : null,
    visibility: workflow?.metadata
      ? {
          kind: "workflow",
          current: workflow.metadata.visibility,
          org: workflow.metadata.org || org,
          onChanged: refetch,
        }
      : undefined,
  });

  if (isLoading) return <LoadingSkeleton className={className} />;
  if (error)
    return <ErrorMessage error={error} retry={refetch} className={className} />;
  if (!workflow) return <NotFoundState className={className} />;

  const meta = workflow.metadata;
  const spec = workflow.spec;
  const specAudit = workflow.status?.audit?.specAudit;

  const headerMeta: ResourceHeaderMeta = {
    name: meta?.name || meta?.slug || "Untitled",
    id: meta?.id || "",
    org: meta?.org,
    slug: meta?.slug,
    description: undefined,
    icon: <WorkflowIcon className="size-6 text-muted-foreground" />,
    createdAt: specAudit?.createdAt ? timestampDate(specAudit.createdAt) : null,
    updatedAt: specAudit?.updatedAt ? timestampDate(specAudit.updatedAt) : null,
  };

  const validationState = workflow.status?.serverlessWorkflowValidation?.state;
  const headerMetaExtra = validationState ? (
    <ValidationIndicator state={validationState} />
  ) : undefined;

  // Inline visibility is read-only (at-a-glance); editing lives in the
  // Manage access dialog, the single writer for both access axes.
  const visibilityControl = meta ? (
    <VisibilityBadge visibility={meta.visibility} />
  ) : undefined;

  const mergedActions = access.action
    ? [...(actions ?? []), access.action]
    : actions;

  let tabContent: React.ReactNode;
  if (activeAdditionalTab) {
    tabContent = activeAdditionalTab.content;
  } else if (effectiveActiveTab === "instances") {
    tabContent = (
      <WorkflowInstanceList
        workflowId={meta?.id ?? ""}
        defaultInstanceId={workflow?.status?.defaultInstanceId}
        org={org}
        onCreateClick={onCreateInstanceClick}
        onInstanceClick={onInstanceClick}
        onRunClick={onInstanceRunClick}
        onDeleteClick={onInstanceDeleteClick}
        refreshKey={instancesRefreshKey}
      />
    );
  } else if (effectiveActiveTab === "executions") {
    tabContent = (
      <WorkflowExecutionHistory
        org={org}
        workflowId={meta?.id}
        onExecutionClick={onExecutionClick}
      />
    );
  } else if (effectiveActiveTab === "versions") {
    tabContent = <WorkflowVersionsTab workflow={workflow} />;
  } else {
    tabContent = (
      <OverviewTab
        workflow={workflow}
        org={org}
        editable={editable}
        isSaving={isUpdating}
        saveField={saveField}
        onOpenInEditor={onOpenInEditor}
        onViewLatestRun={onViewLatestRun}
        onExecutionClick={onExecutionClick}
      />
    );
  }

  return (
    <>
      <ResourceDetailShell
        header={headerMeta}
        visibilityControl={visibilityControl}
        headerMetaExtra={headerMetaExtra}
        primaryAction={primaryAction}
        actions={mergedActions}
        tabs={effectiveTabs}
        activeTab={effectiveActiveTab}
        onTabChange={effectiveOnTabChange}
        tabsAriaLabel="Workflow detail tabs"
        className={className}
      >
        {tabContent}
      </ResourceDetailShell>
      {access.dialog}
    </>
  );
}

// ---------------------------------------------------------------------------
// Tab content components
// ---------------------------------------------------------------------------

function OverviewTab({
  workflow,
  org,
  editable,
  isSaving,
  saveField,
  onOpenInEditor,
  onViewLatestRun,
  onExecutionClick,
}: {
  readonly workflow: Workflow;
  readonly org: string;
  readonly editable?: boolean;
  readonly isSaving?: boolean;
  readonly saveField?: <K extends keyof WorkflowInput>(
    field: K,
    value: WorkflowInput[K],
  ) => Promise<boolean>;
  readonly onOpenInEditor?: (taskName: string) => void;
  readonly onViewLatestRun?: (executionId: string) => void;
  readonly onExecutionClick?: (executionId: string) => void;
}) {
  const spec = workflow.spec;
  const doc = spec?.document;
  const budget = spec?.budget;
  const envEntries = spec?.env ? Object.entries(spec.env) : [];

  const showDescription = editable || !!spec?.description;
  const showEnv = editable || envEntries.length > 0;

  const [envEditing, setEnvEditing] = useState(false);
  const [showExplain, setShowExplain] = useState(false);
  const [graphExpanded, setGraphExpanded] = useState(false);

  const workflowYaml = useMemo(() => {
    try {
      return serializeWorkflowYaml(workflow);
    } catch {
      return "";
    }
  }, [workflow]);

  const workflowId = workflow.metadata?.id;
  const { summary, isLoading: summaryLoading } = useWorkflowDashboardSummary({
    org,
    workflowId: workflowId || undefined,
  });

  const { executions } = useWorkflowExecutionList({
    workflowId,
    pageSize: 1,
  });
  const latestExecId = executions[0]?.metadata?.id;

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

  return (
    <div className="flex flex-col gap-6">
      {/* Summary stat cards */}
      <WorkflowOverviewSummary
        summary={summary}
        isLoading={summaryLoading}
      />

      {/* Interactive workflow graph */}
      {(spec?.tasks?.length ?? 0) > 0 && (
        <>
          <Section
            title="Task Flow"
            count={spec?.tasks?.length}
            headerActions={
              <ExpandButton onClick={() => setGraphExpanded(true)} />
            }
          >
            <div className="h-[28rem]">
              <WorkflowOverviewGraph
                workflow={workflow}
                onOpenInEditor={onOpenInEditor}
                className="h-full w-full rounded-sm bg-[var(--stgm-muted-subtle,#fafafa)]"
              />
            </div>
          </Section>
          <WorkflowGraphFullscreenDialog
            workflow={workflow}
            open={graphExpanded}
            onClose={() => setGraphExpanded(false)}
            onOpenInEditor={onOpenInEditor}
          />
        </>
      )}

      {/* Quick action links */}
      <div className="flex flex-wrap items-center gap-3">
        {onOpenInEditor && (
          <QuickActionButton
            label="Edit workflow"
            onClick={() => onOpenInEditor("")}
            icon={<EditIcon />}
          />
        )}
        {latestExecId && onViewLatestRun && (
          <QuickActionButton
            label="View latest run"
            onClick={() => onViewLatestRun(latestExecId)}
            icon={<PlayIcon />}
          />
        )}
        {latestExecId && !onViewLatestRun && onExecutionClick && (
          <QuickActionButton
            label="View latest run"
            onClick={() => onExecutionClick(latestExecId)}
            icon={<PlayIcon />}
          />
        )}
        {workflowYaml && (
          <QuickActionButton
            label="What does this workflow do?"
            onClick={() => setShowExplain(true)}
            icon={<ExplainQuestionIcon />}
          />
        )}
      </div>

      {/* Explain dialog */}
      {workflowYaml && (
        <WorkflowExplainDialog
          open={showExplain}
          onOpenChange={setShowExplain}
          org={org}
          currentYaml={workflowYaml}
        />
      )}

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
            <DescriptionContent text={spec?.description ?? ""} />
          )}
        </Section>
      )}

      {budget && hasBudget(budget) && (
        <Section title="Budget">
          <div className="divide-y divide-border">
            {budget.maxCostMicros > 0 && (
              <MetadataRow
                label="Max Cost"
                value={`$${(Number(budget.maxCostMicros) / 1_000_000).toFixed(2)}`}
              />
            )}
            {budget.maxTotalTokens > 0 && (
              <MetadataRow
                label="Max Tokens"
                value={Number(budget.maxTotalTokens).toLocaleString()}
              />
            )}
            {budget.maxDurationSeconds > 0 && (
              <MetadataRow
                label="Max Duration"
                value={formatDurationSec(budget.maxDurationSeconds)}
              />
            )}
          </div>
        </Section>
      )}

      {showEnv && (
        <Section
          title="Environment Variables"
          count={envEntries.length}
          onEdit={editable ? () => setEnvEditing((v) => !v) : undefined}
        >
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
            <div className="divide-y divide-border">
              {envEntries.map(([key, decl]) => (
                <div key={key} className="flex items-center gap-3 px-4 py-2.5">
                  <code className="shrink-0 text-xs font-medium text-foreground">
                    {key}
                  </code>
                  {!decl.optional && (
                    <span className="shrink-0 rounded bg-destructive/10 px-1 py-0.5 text-[10px] font-medium text-destructive">
                      required
                    </span>
                  )}
                  {decl.description && (
                    <span className="truncate text-xs text-muted-foreground">
                      {decl.description}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {doc && (
        <Section title="Document">
          <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 py-2.5 text-xs text-muted-foreground">
            <span>DSL {doc.dsl}</span>
            <span>{doc.namespace}</span>
            <span>v{doc.version}</span>
          </div>
        </Section>
      )}
    </div>
  );
}

function QuickActionButton({
  label,
  onClick,
  icon,
}: {
  readonly label: string;
  readonly onClick: () => void;
  readonly icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
        "border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)]",
        "text-[var(--stgm-foreground,#1a1a2e)]",
        "hover:bg-[var(--stgm-accent,#f5f5f5)]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--stgm-ring,#6366f1)]",
        "transition-colors",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function EditIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11.5 1.5l3 3L5 14H2v-3L11.5 1.5z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="5,3 13,8 5,13" />
    </svg>
  );
}

function ExplainQuestionIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M6.5 6a1.5 1.5 0 1 1 1.5 1.5V9" />
      <circle cx="8" cy="11.5" r="0.5" fill="currentColor" />
    </svg>
  );
}

function ExpandButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Expand task flow"
      className={cn(
        "inline-flex size-6 items-center justify-center rounded-md text-muted-foreground",
        "hover:bg-accent-hover hover:text-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "transition-colors",
      )}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="10,2 14,2 14,6" />
        <polyline points="6,14 2,14 2,10" />
        <line x1="14" y1="2" x2="9.5" y2="6.5" />
        <line x1="2" y1="14" x2="6.5" y2="9.5" />
      </svg>
    </button>
  );
}

function DescriptionContent({ text }: { readonly text: string }) {
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
          "whitespace-pre-wrap break-words text-sm text-foreground font-sans overflow-y-auto transition-[max-height] duration-200",
          !expanded && "overflow-hidden",
        )}
        style={{ maxHeight: expanded ? "none" : DESCRIPTION_COLLAPSED_HEIGHT }}
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

// ---------------------------------------------------------------------------
// Validation indicator
// ---------------------------------------------------------------------------

function ValidationIndicator({ state }: { readonly state: ValidationState }) {
  const config = VALIDATION_STATE_CONFIG[state];
  if (!config) return null;

  return (
    <>
      <Dot />
      <span className={cn("text-xs", config.colorClass)}>
        {config.label}
      </span>
    </>
  );
}

const VALIDATION_STATE_CONFIG: Partial<Record<ValidationState, { label: string; colorClass: string }>> = {
  [ValidationState.VALID]: { label: "Valid", colorClass: "text-success" },
  [ValidationState.INVALID]: { label: "Invalid", colorClass: "text-destructive" },
  [ValidationState.PENDING]: { label: "Validating…", colorClass: "text-muted-foreground" },
  [ValidationState.FAILED]: { label: "Validation Error", colorClass: "text-destructive" },
};

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

function MetadataRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground">{value}</span>
    </div>
  );
}

function Dot() {
  return (
    <span className="shrink-0" aria-hidden="true">
      {"\u00B7"}
    </span>
  );
}

function hasBudget(budget: {
  maxCostMicros?: bigint | number;
  maxTotalTokens?: bigint | number;
  maxDurationSeconds?: number;
}): boolean {
  return (
    Number(budget.maxCostMicros ?? 0) > 0 ||
    Number(budget.maxTotalTokens ?? 0) > 0 ||
    (budget.maxDurationSeconds ?? 0) > 0
  );
}


// ---------------------------------------------------------------------------
// Loading & empty states
// ---------------------------------------------------------------------------

function LoadingSkeleton({ className }: { readonly className?: string }) {
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      <div className="flex items-start gap-3">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      </div>
      <div className="h-40 animate-pulse rounded-lg bg-muted" />
      <div className="h-28 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}

function TabLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="h-8 w-full animate-pulse rounded bg-muted" />
      <div className="h-8 w-full animate-pulse rounded bg-muted" />
      <div className="h-8 w-3/4 animate-pulse rounded bg-muted" />
    </div>
  );
}

function NotFoundState({ className }: { readonly className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center py-16", className)}>
      <WorkflowIcon className="size-10 text-muted-foreground-faint" />
      <p className="mt-2 text-sm text-muted-foreground">Workflow not found</p>
      <p className="text-xs text-muted-foreground-subtle">
        This workflow doesn&apos;t exist or you don&apos;t have access to it.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons — inline SVGs following the SDK pattern (no icon library dependency)
// ---------------------------------------------------------------------------

function WorkflowIcon({ className }: { readonly className?: string }) {
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
      <path d="M3 3h4v4H3zM9 9h4v4H9z" />
      <path d="M7 5h2M5 7v2M11 7V5h-2" />
    </svg>
  );
}
