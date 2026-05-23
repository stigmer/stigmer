"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ValidationState } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import type { WorkflowInput } from "@stigmer/sdk";
import { useWorkflow } from "./useWorkflow";
import { useUpdateWorkflow } from "./useUpdateWorkflow";
import { workflowToInput } from "./internal/workflowToInput";
import { useWorkflowInstances } from "./useWorkflowInstances";
import { useWorkflowExecutionList } from "./useWorkflowExecutionList";
import { WorkflowTopologyPreview } from "./WorkflowTopologyPreview";
import { WorkflowExecutionPhaseBadge } from "./WorkflowExecutionPhaseBadge";
import { ErrorMessage } from "../error/ErrorMessage";
import { VisibilityToggle } from "../library/VisibilityToggle";
import { InstanceVisibilitySelector } from "../library/InstanceVisibilitySelector";
import { formatDurationSec } from "./format-utils";
import { useUpdateVisibility } from "../library/useUpdateVisibility";
import { PermissionGate } from "../iam-policy/PermissionGate";
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
   * Called when the user toggles visibility via the inline control.
   * When provided, the header renders an interactive
   * {@link VisibilityToggle} instead of a read-only badge.
   */
  readonly onVisibilityChange?: (v: ApiResourceVisibility) => void;
  /** `true` while a visibility update RPC is in flight. */
  readonly isVisibilityPending?: boolean;
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
   * When `true`, description and environment variables become click-to-edit.
   * Each field saves independently via `stigmer.workflow.update()`.
   * @default false
   */
  readonly editable?: boolean;
  /**
   * Called after a successful inline field save with the updated workflow.
   */
  readonly onResourceUpdated?: (workflow: Workflow) => void;
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
  onVisibilityChange,
  isVisibilityPending,
  primaryAction,
  actions,
  additionalTabs,
  activeTab,
  onTabChange,
  defaultTab,
  onExecutionClick,
  editable = false,
  onResourceUpdated,
  className,
}: WorkflowDetailViewProps) {
  const { workflow, isLoading, error, refetch } = useWorkflow(org, slug);
  const { update, isUpdating } = useUpdateWorkflow();

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

  const builtInTabs = useMemo<readonly TabItem[]>(
    () => [OVERVIEW_TAB, INSTANCES_TAB, EXECUTIONS_TAB],
    [],
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

  const visibilityBadge =
    meta?.visibility === ApiResourceVisibility.visibility_public ? (
      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
        Public
      </span>
    ) : undefined;

  const visibilityControl =
    onVisibilityChange && meta ? (
      <PermissionGate
        resource={{ kind: "workflow", id: meta.id }}
        relation="can_edit"
        fallback={visibilityBadge}
      >
        <VisibilityToggle
          visibility={meta.visibility}
          onVisibilityChange={onVisibilityChange}
          isPending={isVisibilityPending}
        />
      </PermissionGate>
    ) : visibilityBadge;

  let tabContent: React.ReactNode;
  if (activeAdditionalTab) {
    tabContent = activeAdditionalTab.content;
  } else if (effectiveActiveTab === "instances") {
    tabContent = <InstancesTab workflowId={meta?.id} />;
  } else if (effectiveActiveTab === "executions") {
    tabContent = <ExecutionsTab workflowId={meta?.id} onExecutionClick={onExecutionClick} />;
  } else {
    tabContent = (
      <OverviewTab
        workflow={workflow}
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
      headerMetaExtra={headerMetaExtra}
      primaryAction={primaryAction}
      actions={actions}
      tabs={effectiveTabs}
      activeTab={effectiveActiveTab}
      onTabChange={effectiveOnTabChange}
      tabsAriaLabel="Workflow detail tabs"
      className={className}
    >
      {tabContent}
    </ResourceDetailShell>
  );
}

// ---------------------------------------------------------------------------
// Tab content components
// ---------------------------------------------------------------------------

function OverviewTab({
  workflow,
  editable,
  isSaving,
  saveField,
}: {
  readonly workflow: Workflow;
  readonly editable?: boolean;
  readonly isSaving?: boolean;
  readonly saveField?: <K extends keyof WorkflowInput>(
    field: K,
    value: WorkflowInput[K],
  ) => Promise<boolean>;
}) {
  const spec = workflow.spec;
  const doc = spec?.document;
  const budget = spec?.budget;
  const envEntries = spec?.env ? Object.entries(spec.env) : [];

  const showDescription = editable || !!spec?.description;
  const showEnv = editable || envEntries.length > 0;

  const [envEditing, setEnvEditing] = useState(false);

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

      <Section title="Task Flow" count={spec?.tasks?.length}>
        <WorkflowTopologyPreview tasks={spec?.tasks ?? []} />
      </Section>

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

function InstancesTab({ workflowId }: { readonly workflowId?: string }) {
  const { instances, isLoading, error } = useWorkflowInstances(workflowId);

  if (isLoading) {
    return <TabLoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="py-8 text-center text-sm text-destructive">
        Failed to load instances
      </div>
    );
  }

  if (instances.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No instances found. A default instance is created automatically with each workflow.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Name</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Visibility</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">ID</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {instances.map((inst) => (
            <InstanceRow key={inst.metadata?.id} instance={inst} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const VISIBILITY_LABELS: Record<number, string> = {
  [ApiResourceVisibility.visibility_private]: "Private",
  [ApiResourceVisibility.visibility_org]: "Organization",
  [ApiResourceVisibility.visibility_public]: "Public",
};

function InstanceRow({ instance }: { readonly instance: WorkflowInstance }) {
  const meta = instance.metadata;
  const id = meta?.id ?? "";
  const { updateVisibility, isPending } = useUpdateVisibility("workflowInstance", id || null);

  return (
    <tr className="hover:bg-muted/30 transition-colors">
      <td className="px-4 py-2.5 font-medium text-foreground">
        {meta?.name || meta?.slug || "—"}
      </td>
      <td className="px-4 py-2.5">
        {id ? (
          <PermissionGate
            resource={{ kind: "workflow_instance", id }}
            relation="can_edit"
            fallback={
              <span className="text-xs text-muted-foreground">
                {VISIBILITY_LABELS[meta?.visibility ?? 0] ?? "Private"}
              </span>
            }
          >
            <InstanceVisibilitySelector
              visibility={meta?.visibility ?? ApiResourceVisibility.visibility_private}
              onVisibilityChange={updateVisibility}
              isPending={isPending}
            />
          </PermissionGate>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <code className="text-xs text-muted-foreground">
          {id || "—"}
        </code>
      </td>
    </tr>
  );
}

function ExecutionsTab({
  workflowId,
  onExecutionClick,
}: {
  readonly workflowId?: string;
  readonly onExecutionClick?: (executionId: string) => void;
}) {
  const { executions, isLoading, error } = useWorkflowExecutionList({
    workflowId,
    pageSize: 10,
  });

  if (isLoading) {
    return <TabLoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="py-8 text-center text-sm text-destructive">
        Failed to load executions
      </div>
    );
  }

  if (executions.length === 0) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        No executions yet
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Name</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Phase</th>
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">Started</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {executions.map((exec) => {
            const execId = exec.metadata?.id;
            const startedAt = exec.status?.audit?.specAudit?.createdAt;
            const clickable = !!onExecutionClick && !!execId;
            return (
              <tr
                key={execId}
                onClick={clickable ? () => onExecutionClick(execId!) : undefined}
                role={clickable ? "link" : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={
                  clickable
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onExecutionClick(execId!);
                        }
                      }
                    : undefined
                }
                className={cn(
                  "transition-colors hover:bg-muted/30",
                  clickable && "cursor-pointer",
                )}
              >
                <td className="px-4 py-2.5 font-medium text-foreground">
                  {exec.metadata?.name || exec.metadata?.slug || "—"}
                </td>
                <td className="px-4 py-2.5">
                  {exec.status?.phase != null ? (
                    <WorkflowExecutionPhaseBadge phase={exec.status.phase} />
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground">
                  {startedAt ? timestampDate(startedAt).toLocaleString() : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
