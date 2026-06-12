"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { WorkflowInstance } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { WorkflowExecutionVisibility } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/spec_pb";
import type { ResourceRef } from "@stigmer/sdk";
import { getUserMessage } from "@stigmer/sdk";
import { useUpdateWorkflowInstance } from "./useUpdateWorkflowInstance";
import { useDeleteWorkflowInstance } from "./useDeleteWorkflowInstance";
import { RunVisibilityControl } from "./RunVisibilityControl";
import { VisibilityBadge } from "../../library/VisibilitySelector";
import { PermissionGate } from "../../iam-policy/PermissionGate";
import { useCheckPermission } from "../../iam-policy/useCheckPermission";
import { ManageAccessButton } from "../../access/ManageAccessButton";
import { EnvironmentPicker } from "../../environment/EnvironmentPicker";
import { useEnvironmentList } from "../../environment/useEnvironmentList";

/** Props for {@link WorkflowInstanceDetailPanel}. */
export interface WorkflowInstanceDetailPanelProps {
  /** The instance to display. */
  readonly instance: WorkflowInstance;
  /** Organization slug. */
  readonly org: string;
  /** Called when the panel should close. */
  readonly onClose: () => void;
  /** Called after successful deletion. */
  readonly onDeleted?: () => void;
  /** Called when the user clicks "Run" for this instance. */
  readonly onRunClick?: (instance: WorkflowInstance) => void;
  /** Called when instance data changes (for parent refetch). */
  readonly onUpdated?: () => void;
  /** Called when the user clicks an execution in the recent list. */
  readonly onExecutionClick?: (executionId: string) => void;
}

/**
 * Expandable detail panel for a single WorkflowInstance.
 *
 * Shows metadata, description (inline-editable), environment bindings (editable),
 * visibility control, share panel (FGA-gated), and a delete action with cascade warning.
 */
export function WorkflowInstanceDetailPanel({
  instance,
  org,
  onClose,
  onDeleted,
  onRunClick,
  onUpdated,
}: WorkflowInstanceDetailPanelProps) {
  const meta = instance.metadata;
  const id = meta?.id ?? "";
  const spec = instance.spec;

  const { update, isUpdating } = useUpdateWorkflowInstance();
  const { deleteInstance, isDeleting } = useDeleteWorkflowInstance();
  const { environments } = useEnvironmentList(org);

  const [isEditingEnvs, setIsEditingEnvs] = useState(false);
  const [editEnvRefs, setEditEnvRefs] = useState<ResourceRef[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<Error | null>(null);

  const visibility = meta?.visibility ?? ApiResourceVisibility.visibility_private;
  // Run observability is a separate axis from instance visibility, and only
  // meaningful while the instance is private (ORG/PUBLIC already expose runs
  // by inheritance). It is offered only to those who can grant access, so it
  // rides into the dialog as the resource-specific section — present only when
  // both conditions hold.
  const { allowed: canGrantAccess } = useCheckPermission(
    id ? { kind: "workflow_instance", id } : null,
    "can_grant_access",
  );
  const runVisibilitySection =
    visibility === ApiResourceVisibility.visibility_private && canGrantAccess
      ? {
          title: "Run visibility",
          description:
            "Keep the instance private while choosing who can observe its runs.",
          content: (
            <RunVisibilityControl
              instanceId={id}
              executionVisibility={
                spec?.executionVisibility ?? WorkflowExecutionVisibility.unspecified
              }
              onChanged={onUpdated}
            />
          ),
        }
      : undefined;

  const handleStartEditEnvs = useCallback(() => {
    const currentRefs: ResourceRef[] = (spec?.environmentRefs ?? []).map((ref) => ({
      org: ref.org || org,
      slug: ref.slug,
    }));
    setEditEnvRefs(currentRefs);
    setIsEditingEnvs(true);
  }, [spec?.environmentRefs, org]);

  const handleSaveEnvs = useCallback(async () => {
    try {
      await update({
        name: meta?.name ?? "",
        org: meta?.org ?? org,
        workflowId: spec?.workflowId ?? "",
        description: spec?.description,
        environmentRefs: editEnvRefs,
        visibility: meta?.visibility,
      });
      setIsEditingEnvs(false);
      onUpdated?.();
    } catch {
      // error displayed by hook
    }
  }, [update, meta, spec, org, editEnvRefs, onUpdated]);

  const handleDelete = useCallback(async () => {
    setDeleteError(null);
    try {
      await deleteInstance(id);
      onDeleted?.();
    } catch (err) {
      setDeleteError(err instanceof Error ? err : new Error("Failed to delete instance"));
    }
  }, [deleteInstance, id, onDeleted]);

  const resolveEnvName = useCallback(
    (slug: string): string => {
      const env = environments.find((e) => e.metadata?.slug === slug);
      return env?.metadata?.name ?? slug;
    },
    [environments],
  );

  const audit = instance.status?.audit?.specAudit;
  const createdAt = audit?.createdAt ? timestampDate(audit.createdAt) : null;
  const updatedAt = audit?.updatedAt ? timestampDate(audit.updatedAt) : null;

  return (
    <div className="border border-border rounded-lg bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {meta?.name || meta?.slug || "Instance"}
            </h3>
            <VisibilityBadge visibility={visibility} />
          </div>
          <p className="text-[0.65rem] text-muted-foreground">
            {createdAt && `Created ${createdAt.toLocaleDateString()}`}
            {updatedAt && ` · Updated ${updatedAt.toLocaleDateString()}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onRunClick && (
            <button
              type="button"
              onClick={() => onRunClick(instance)}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium",
                "bg-primary text-primary-foreground hover:bg-primary/90",
                "focus:outline-none focus:ring-2 focus:ring-ring",
              )}
            >
              Run
            </button>
          )}
          <ManageAccessButton
            resource={{
              kind: ApiResourceKind.workflow_instance,
              kindString: "workflow_instance",
              id,
              org: meta?.org ?? "",
              name: meta?.name,
            }}
            visibility={{
              kind: "workflowInstance",
              current: visibility,
              onChanged: onUpdated,
            }}
            extraSection={runVisibilitySection}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className={cn(
              "rounded-md p-1 text-muted-foreground",
              "hover:text-foreground hover:bg-accent-hover",
            )}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className="divide-y divide-border">
        {/* Description */}
        {spec?.description && (
          <div className="px-4 py-3">
            <h4 className="text-xs font-medium text-muted-foreground mb-1">Description</h4>
            <p className="text-sm text-foreground">{spec.description}</p>
          </div>
        )}

        {/* Environments */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-medium text-muted-foreground">
              Environments ({spec?.environmentRefs?.length ?? 0})
            </h4>
            {!isEditingEnvs && (
              <PermissionGate resource={{ kind: "workflow_instance", id }} relation="can_edit">
                <button
                  type="button"
                  onClick={handleStartEditEnvs}
                  className="text-[0.65rem] text-primary hover:underline"
                >
                  Edit
                </button>
              </PermissionGate>
            )}
          </div>

          {isEditingEnvs ? (
            <div className="space-y-2">
              <EnvironmentPicker
                org={org}
                value={editEnvRefs}
                onChange={setEditEnvRefs}
                disabled={isUpdating}
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveEnvs}
                  disabled={isUpdating}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs font-medium",
                    "bg-primary text-primary-foreground hover:bg-primary/90",
                    "disabled:opacity-50",
                  )}
                >
                  {isUpdating ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingEnvs(false)}
                  disabled={isUpdating}
                  className="rounded-md px-2.5 py-1 text-xs font-medium text-foreground hover:bg-accent-hover"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              {(spec?.environmentRefs?.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground">No environments bound.</p>
              ) : (
                <ol className="space-y-1">
                  {spec!.environmentRefs.map((ref, idx) => (
                    <li key={`${ref.slug}-${idx}`} className="flex items-center gap-2 text-sm">
                      <span className="text-xs text-muted-foreground w-4 text-right">{idx + 1}.</span>
                      <span className="text-foreground">{resolveEnvName(ref.slug)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>

        {/* Delete */}
        <PermissionGate resource={{ kind: "workflow_instance", id }} relation="can_delete">
          <div className="px-4 py-3">
            <h4 className="text-xs font-medium text-destructive mb-2">Danger Zone</h4>
            {!showDeleteConfirm ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-medium",
                  "border border-destructive/30 text-destructive",
                  "hover:bg-destructive/10",
                  "focus:outline-none focus:ring-2 focus:ring-destructive",
                )}
              >
                Delete Instance
              </button>
            ) : (
              <div className="space-y-2 rounded-md border border-destructive/30 p-3 bg-destructive/5">
                <p className="text-xs text-destructive font-medium">
                  This will permanently delete this instance and all its execution history.
                  This action cannot be undone.
                </p>
                {deleteError && (
                  <p className="text-xs text-destructive" role="alert">
                    {getUserMessage(deleteError)}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium",
                      "bg-destructive text-destructive-foreground",
                      "hover:bg-destructive/90",
                      "disabled:opacity-50",
                    )}
                  >
                    {isDeleting ? "Deleting..." : "Confirm Delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isDeleting}
                    className="rounded-md px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent-hover"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </PermissionGate>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

