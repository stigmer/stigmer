"use client";

import { useCallback, useMemo } from "react";
import { cn } from "@stigmer/theme";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { useWorkflowInstances } from "../useWorkflowInstances";
import { useEnvironmentList } from "../../environment/useEnvironmentList";
import { useUpdateVisibility } from "../../library/useUpdateVisibility";
import { InstanceVisibilitySelector } from "../../library/InstanceVisibilitySelector";
import { PermissionGate } from "../../iam-policy/PermissionGate";
import { WorkflowInstanceEmptyState } from "./WorkflowInstanceEmptyState";

/** Props for {@link WorkflowInstanceList}. */
export interface WorkflowInstanceListProps {
  /** Workflow resource ID to list instances for. */
  readonly workflowId: string;
  /** The default instance ID (from workflow.status.defaultInstanceId) — filtered out of the list. */
  readonly defaultInstanceId?: string;
  /** Organization slug (needed for environment resolution and create flow). */
  readonly org: string;
  /** Called when the user wants to create a new instance. */
  readonly onCreateClick?: () => void;
  /** Called when the user clicks an instance row. */
  readonly onInstanceClick?: (instance: WorkflowInstance) => void;
  /** Called when the user clicks "Run" on an instance. */
  readonly onRunClick?: (instance: WorkflowInstance) => void;
  /** Called when the user clicks "Delete" on an instance. */
  readonly onDeleteClick?: (instance: WorkflowInstance) => void;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Enhanced workflow instance list with environment badges, visibility controls,
 * and action buttons. Filters out the platform-managed default instance.
 *
 * This is an SDK component (DD-001) — embeddable by platform builders.
 */
export function WorkflowInstanceList({
  workflowId,
  defaultInstanceId,
  org,
  onCreateClick,
  onInstanceClick,
  onRunClick,
  onDeleteClick,
  className,
}: WorkflowInstanceListProps) {
  const { instances, isLoading, error, refetch } = useWorkflowInstances(workflowId);
  const { environments } = useEnvironmentList(org);

  const userInstances = useMemo(
    () => instances.filter((i) => i.metadata?.id !== defaultInstanceId),
    [instances, defaultInstanceId],
  );

  const resolveEnvName = useCallback(
    (slug: string): string => {
      const env = environments.find((e) => e.metadata?.slug === slug);
      return env?.metadata?.name ?? slug;
    },
    [environments],
  );

  if (isLoading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <div className="py-8 text-center text-sm text-destructive">
        Failed to load instances
      </div>
    );
  }

  if (userInstances.length === 0) {
    return <WorkflowInstanceEmptyState onCreateClick={onCreateClick} className={className} />;
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-foreground">
          {userInstances.length} {userInstances.length === 1 ? "instance" : "instances"}
        </h3>
        {onCreateClick && (
          <button
            type="button"
            onClick={onCreateClick}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-2.5 py-1",
              "text-xs font-medium",
              "border border-border text-foreground",
              "hover:bg-accent-hover",
              "focus:outline-none focus:ring-2 focus:ring-ring",
            )}
          >
            <PlusIcon />
            Create
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Environments</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Visibility</th>
              <th className="px-4 py-2 text-right font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {userInstances.map((inst) => (
              <InstanceRow
                key={inst.metadata?.id}
                instance={inst}
                resolveEnvName={resolveEnvName}
                onRowClick={onInstanceClick}
                onRunClick={onRunClick}
                onDeleteClick={onDeleteClick}
                refetch={refetch}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface InstanceRowProps {
  readonly instance: WorkflowInstance;
  readonly resolveEnvName: (slug: string) => string;
  readonly onRowClick?: (instance: WorkflowInstance) => void;
  readonly onRunClick?: (instance: WorkflowInstance) => void;
  readonly onDeleteClick?: (instance: WorkflowInstance) => void;
  readonly refetch: () => void;
}

function InstanceRow({
  instance,
  resolveEnvName,
  onRowClick,
  onRunClick,
  onDeleteClick,
  refetch,
}: InstanceRowProps) {
  const meta = instance.metadata;
  const id = meta?.id ?? "";
  const { updateVisibility, isPending } = useUpdateVisibility("workflowInstance", id || null);

  const envRefs = instance.spec?.environmentRefs ?? [];

  const handleVisibilityChange = useCallback(
    async (v: ApiResourceVisibility) => {
      await updateVisibility(v);
      refetch();
    },
    [updateVisibility, refetch],
  );

  return (
    <tr
      className={cn(
        "transition-colors",
        onRowClick && "cursor-pointer hover:bg-muted/30",
      )}
      onClick={() => onRowClick?.(instance)}
    >
      <td className="px-4 py-2.5">
        <div>
          <span className="font-medium text-foreground">
            {meta?.name || meta?.slug || "—"}
          </span>
          {instance.spec?.description && (
            <p className="text-[0.65rem] text-muted-foreground truncate max-w-48">
              {instance.spec.description}
            </p>
          )}
        </div>
      </td>

      <td className="px-4 py-2.5">
        {envRefs.length === 0 ? (
          <span className="text-xs text-muted-foreground">None</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {envRefs.map((ref, idx) => (
              <span
                key={`${ref.slug}-${idx}`}
                className={cn(
                  "inline-flex items-center rounded-md px-1.5 py-0.5",
                  "text-[0.65rem] font-medium",
                  "bg-muted text-muted-foreground",
                  "border border-border",
                )}
              >
                {resolveEnvName(ref.slug)}
              </span>
            ))}
          </div>
        )}
      </td>

      <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
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
              onVisibilityChange={handleVisibilityChange}
              isPending={isPending}
            />
          </PermissionGate>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-end gap-1">
          {onRunClick && (
            <button
              type="button"
              onClick={() => onRunClick(instance)}
              className={cn(
                "rounded px-2 py-1 text-xs font-medium",
                "text-foreground hover:bg-accent-hover",
                "focus:outline-none focus:ring-1 focus:ring-ring",
              )}
            >
              Run
            </button>
          )}
          {onDeleteClick && (
            <PermissionGate
              resource={{ kind: "workflow_instance", id }}
              relation="can_delete"
            >
              <button
                type="button"
                onClick={() => onDeleteClick(instance)}
                className={cn(
                  "rounded px-2 py-1 text-xs font-medium",
                  "text-destructive hover:bg-destructive/10",
                  "focus:outline-none focus:ring-1 focus:ring-ring",
                )}
              >
                Delete
              </button>
            </PermissionGate>
          )}
        </div>
      </td>
    </tr>
  );
}

const VISIBILITY_LABELS: Record<number, string> = {
  [ApiResourceVisibility.visibility_private]: "Private",
  [ApiResourceVisibility.visibility_org]: "Organization",
  [ApiResourceVisibility.visibility_public]: "Public",
};

function LoadingSkeleton() {
  return (
    <div className="space-y-2 py-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-12 rounded-md bg-muted/50 animate-pulse" />
      ))}
    </div>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
