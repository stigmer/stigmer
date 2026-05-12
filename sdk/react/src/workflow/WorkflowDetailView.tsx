"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { ValidationState } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/serverless/validation_pb";
import { useWorkflow } from "./useWorkflow";
import { useWorkflowInstances } from "./useWorkflowInstances";
import { useWorkflowExecutionList } from "./useWorkflowExecutionList";
import { WorkflowTaskList } from "./WorkflowTaskList";
import { WorkflowExecutionPhaseBadge } from "./WorkflowExecutionPhaseBadge";
import { ErrorMessage } from "../error/ErrorMessage";
import { ResourceDetailShell } from "../resource-detail/ResourceDetailShell";
import { Section } from "../resource-detail/Section";
import { useDetailTabs } from "../resource-detail/useDetailTabs";
import type { AdditionalTab, DetailAction, ResourceHeaderMeta } from "../resource-detail/types";
import type { TabItem } from "../tabs/Tabs";

const OVERVIEW_TAB: TabItem = { id: "overview", label: "Overview" };
const TASKS_TAB: TabItem = { id: "tasks", label: "Tasks" };
const INSTANCES_TAB: TabItem = { id: "instances", label: "Instances" };
const EXECUTIONS_TAB: TabItem = { id: "executions", label: "Executions" };

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
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Operational detail hub for a Workflow blueprint.
 *
 * Fetches the workflow via {@link useWorkflow} internally and renders
 * its full specification inside a {@link ResourceDetailShell}:
 *
 * - **Overview**: Description, document metadata, budget summary, env vars
 * - **Tasks**: Task list with kind icons and sequential flow
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
  className,
}: WorkflowDetailViewProps) {
  const { workflow, isLoading, error, refetch } = useWorkflow(org, slug);

  const builtInTabs = useMemo<readonly TabItem[]>(
    () => [OVERVIEW_TAB, TASKS_TAB, INSTANCES_TAB, EXECUTIONS_TAB],
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
    description: spec?.description,
    createdAt: specAudit?.createdAt ? timestampDate(specAudit.createdAt) : null,
    updatedAt: specAudit?.updatedAt ? timestampDate(specAudit.updatedAt) : null,
  };

  const validationState = workflow.status?.serverlessWorkflowValidation?.state;
  const headerMetaExtra = validationState ? (
    <ValidationIndicator state={validationState} />
  ) : undefined;

  let tabContent: React.ReactNode;
  if (activeAdditionalTab) {
    tabContent = activeAdditionalTab.content;
  } else if (effectiveActiveTab === "tasks") {
    tabContent = <TasksTab tasks={spec?.tasks ?? []} />;
  } else if (effectiveActiveTab === "instances") {
    tabContent = <InstancesTab workflowId={meta?.id} />;
  } else if (effectiveActiveTab === "executions") {
    tabContent = <ExecutionsTab workflowId={meta?.id} />;
  } else {
    tabContent = <OverviewTab workflow={workflow} />;
  }

  return (
    <ResourceDetailShell
      header={headerMeta}
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

function OverviewTab({ workflow }: { readonly workflow: Workflow }) {
  const spec = workflow.spec;
  const doc = spec?.document;
  const budget = spec?.budget;
  const envEntries = spec?.env ? Object.entries(spec.env) : [];

  return (
    <div className="flex flex-col gap-6">
      {/* Document metadata */}
      {doc && (
        <Section title="Document">
          <div className="divide-y divide-border">
            <MetadataRow label="DSL Version" value={doc.dsl} />
            <MetadataRow label="Namespace" value={doc.namespace} />
            <MetadataRow label="Name" value={doc.name} />
            <MetadataRow label="Version" value={doc.version} />
            {doc.description && (
              <MetadataRow label="Description" value={doc.description} />
            )}
          </div>
        </Section>
      )}

      {/* Budget summary */}
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
                value={formatDuration(budget.maxDurationSeconds)}
              />
            )}
          </div>
        </Section>
      )}

      {/* Environment variable declarations */}
      {envEntries.length > 0 && (
        <Section title="Environment Variables" count={envEntries.length}>
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
        </Section>
      )}

      {/* Tasks summary */}
      <Section title="Tasks" count={spec?.tasks?.length}>
        <div className="p-4">
          <WorkflowTaskList tasks={spec?.tasks ?? []} />
        </div>
      </Section>
    </div>
  );
}

function TasksTab({
  tasks,
}: {
  readonly tasks: readonly import("@stigmer/protos/ai/stigmer/agentic/workflow/v1/spec_pb").WorkflowTask[];
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <WorkflowTaskList tasks={tasks} />
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
            <th className="px-4 py-2 text-left font-medium text-muted-foreground">ID</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {instances.map((inst) => (
            <tr key={inst.metadata?.id} className="hover:bg-muted/30 transition-colors">
              <td className="px-4 py-2.5 font-medium text-foreground">
                {inst.metadata?.name || inst.metadata?.slug || "—"}
              </td>
              <td className="px-4 py-2.5">
                <code className="text-xs text-muted-foreground">
                  {inst.metadata?.id || "—"}
                </code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExecutionsTab({ workflowId }: { readonly workflowId?: string }) {
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
            const startedAt = exec.status?.audit?.specAudit?.createdAt;
            return (
              <tr key={exec.metadata?.id} className="hover:bg-muted/30 transition-colors">
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

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
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
      <p className="text-sm text-muted-foreground">Workflow not found</p>
    </div>
  );
}
