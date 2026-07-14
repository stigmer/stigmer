"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { MoreHorizontal, Play, Trash2 } from "lucide-react";
import { cn } from "@stigmer/theme";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { useWorkflowInstances } from "../useWorkflowInstances.js";
import { ActionMenu } from "../../action-menu/index.js";
import { Button } from "../../button/Button.js";
import { useEnvironmentList } from "../../environment/useEnvironmentList.js";
import { ResourceVisibilityControl } from "../../library/ResourceVisibilityControl.js";
import { useCheckPermission } from "../../iam-policy/useCheckPermission.js";
import { WorkflowInstanceEmptyState } from "./WorkflowInstanceEmptyState.js";

/** Props for {@link WorkflowInstanceList}. */
export interface WorkflowInstanceListProps {
  /** Workflow resource ID to list instances for. */
  readonly workflowId: string;
  /** The default instance ID (from workflow.status.defaultInstanceId) — filtered out of the list. */
  readonly defaultInstanceId?: string;
  /**
   * The WORKFLOW's organization slug (needed for environment resolution
   * and the create flow). Not the list scope — that is `viewerOrg`,
   * which differs from `org` when viewing another org's workflow.
   */
  readonly org: string;
  /**
   * The viewer's active organization slug. Scopes the list to this
   * org's instances of the workflow, so a member of several orgs sees
   * exactly the current org context's instances. Omit to default to
   * the workflow's own org.
   */
  readonly viewerOrg?: string;
  /** Called when the user wants to create a new instance. */
  readonly onCreateClick?: () => void;
  /** Called when the user clicks an instance row. */
  readonly onInstanceClick?: (instance: WorkflowInstance) => void;
  /** Called when the user clicks "Run" on an instance. */
  readonly onRunClick?: (instance: WorkflowInstance) => void;
  /** Called when the user clicks "Delete" on an instance. */
  readonly onDeleteClick?: (instance: WorkflowInstance) => void;
  /**
   * Increment this value to trigger a refetch of the instance list.
   * Useful after creating or deleting an instance externally.
   */
  readonly refreshKey?: number;
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
  viewerOrg,
  onCreateClick,
  onInstanceClick,
  onRunClick,
  onDeleteClick,
  refreshKey,
  className,
}: WorkflowInstanceListProps) {
  // Scope the list to the org whose context the viewer is in; when the
  // host passes no viewerOrg the scope falls back to the workflow's own
  // org (the same-org owner flow).
  const { instances, isLoading, error, refetch } = useWorkflowInstances(
    workflowId,
    viewerOrg || org,
  );
  const { environments } = useEnvironmentList(org);

  // Refetch when refreshKey changes (signals external mutation like create/delete)
  const prevRefreshKey = useRef(refreshKey);
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey !== prevRefreshKey.current) {
      prevRefreshKey.current = refreshKey;
      refetch();
    }
  }, [refreshKey, refetch]);

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
          <Button
            variant="outline"
            size="xs"
            icon={<PlusIcon />}
            onClick={onCreateClick}
          >
            Create instance
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        {/* table-fixed keeps the layout deterministic: Name/Environments flex
            and truncate, Visibility/Actions take fixed widths, so long
            content can never push the Actions kebab off the panel's edge. */}
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-border bg-muted-subtle">
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground">Environments</th>
              <th className="w-36 px-4 py-2 text-left font-medium text-muted-foreground">Visibility</th>
              <th className="w-16 px-4 py-2 text-right font-medium text-muted-foreground">Actions</th>
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

  const envRefs = instance.spec?.environmentRefs ?? [];

  // Delete is the only permission-gated row action (Run is offered whenever
  // the host wires it). Resolved here so the kebab is hidden when it would
  // hold no items — never an empty overflow menu.
  const { allowed: canDelete } = useCheckPermission(
    { kind: "workflow_instance", id },
    "can_delete",
  );
  const showRun = !!onRunClick;
  const showDelete = !!onDeleteClick && canDelete;

  return (
    <tr
      className={cn(
        "transition-colors",
        onRowClick && "cursor-pointer hover:bg-accent-hover",
      )}
      onClick={() => onRowClick?.(instance)}
    >
      <td className="px-4 py-2.5">
        <div className="min-w-0">
          <span
            className="block truncate font-medium text-foreground"
            title={meta?.name || meta?.slug || undefined}
          >
            {meta?.name || meta?.slug || "—"}
          </span>
          {instance.spec?.description && (
            <p className="text-[0.65rem] text-muted-foreground truncate">
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
          <ResourceVisibilityControl
            kind="workflowInstance"
            resourceId={id}
            visibility={meta?.visibility ?? ApiResourceVisibility.visibility_private}
            onChanged={refetch}
          />
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </td>

      {/* stopPropagation so opening the kebab never triggers the row's
          click. The menu content itself is portaled, so its items never
          bubble to the row regardless. */}
      <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
        {(showRun || showDelete) && (
          <ActionMenu>
            <ActionMenu.Trigger
              className="ml-auto"
              aria-label={`Actions for ${meta?.name || meta?.slug}`}
            >
              <MoreHorizontal className="size-4" />
            </ActionMenu.Trigger>
            <ActionMenu.Content>
              {showRun && (
                <ActionMenu.Item
                  icon={<Play />}
                  onSelect={() => onRunClick?.(instance)}
                >
                  Run
                </ActionMenu.Item>
              )}
              {showRun && showDelete && <ActionMenu.Separator />}
              {showDelete && (
                <ActionMenu.Item
                  icon={<Trash2 />}
                  variant="destructive"
                  onSelect={() => onDeleteClick?.(instance)}
                >
                  Delete
                </ActionMenu.Item>
              )}
            </ActionMenu.Content>
          </ActionMenu>
        )}
      </td>
    </tr>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2 py-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-12 animate-pulse rounded-md bg-muted-faint" />
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
