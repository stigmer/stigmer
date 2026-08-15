"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { UNSTYLED_LIST } from "../internal/element-resets.js";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ResourceRef } from "@stigmer/sdk";
import { getUserMessage, toAgentInstanceUpdateInput } from "@stigmer/sdk";
import { useUpdateAgentInstance } from "./useUpdateAgentInstance.js";
import { useDeleteAgentInstance } from "./useDeleteAgentInstance.js";
import { VisibilityBadge } from "../library/VisibilitySelector.js";
import { PermissionGate } from "../iam-policy/PermissionGate.js";
import { ManageAccessButton } from "../access/ManageAccessButton.js";
import { EnvironmentPicker } from "../environment/EnvironmentPicker.js";
import { useEnvironmentList } from "../environment/useEnvironmentList.js";

/** Props for {@link AgentInstanceDetailPanel}. */
export interface AgentInstanceDetailPanelProps {
  /** The instance to display. */
  readonly instance: AgentInstance;
  /** Organization slug. */
  readonly org: string;
  /** Called when the panel should close. */
  readonly onClose: () => void;
  /** Called after successful deletion. */
  readonly onDeleted?: () => void;
  /** Called when the user clicks "Start session" for this instance. */
  readonly onStartSessionClick?: (instance: AgentInstance) => void;
  /** Called when instance data changes (for parent refetch). */
  readonly onUpdated?: () => void;
}

/**
 * Expandable detail panel for a single AgentInstance.
 *
 * Shows metadata, description, environment bindings (editable), visibility
 * control, share panel (FGA-gated), and a delete action. The agent analog
 * of `WorkflowInstanceDetailPanel`; deletion does not cascade to sessions,
 * so the delete copy reflects that.
 */
export function AgentInstanceDetailPanel({
  instance,
  org,
  onClose,
  onDeleted,
  onStartSessionClick,
  onUpdated,
}: AgentInstanceDetailPanelProps) {
  const meta = instance.metadata;
  const id = meta?.id ?? "";
  const spec = instance.spec;

  const { update, isUpdating } = useUpdateAgentInstance();
  const { deleteInstance, isDeleting } = useDeleteAgentInstance();
  const { environments } = useEnvironmentList(org);

  const [isEditingEnvs, setIsEditingEnvs] = useState(false);
  const [editEnvRefs, setEditEnvRefs] = useState<ResourceRef[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteError, setDeleteError] = useState<Error | null>(null);

  const visibility = meta?.visibility ?? ApiResourceVisibility.visibility_private;

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
      // Full-spec-replace safety: spread the complete mapped input so
      // any spec field this form does not edit survives the save.
      await update({
        ...toAgentInstanceUpdateInput(instance),
        environmentRefs: editEnvRefs,
      });
      setIsEditingEnvs(false);
      onUpdated?.();
    } catch {
      // error displayed by hook
    }
  }, [update, instance, editEnvRefs, onUpdated]);

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
    <div className="stg:border stg:border-border stg:rounded-lg stg:bg-background stg:overflow-hidden">
      {/* Header */}
      <div className="stg:flex stg:items-center stg:justify-between stg:border-b stg:border-border stg:px-4 stg:py-3">
        <div>
          <div className="stg:flex stg:items-center stg:gap-2">
            <h3 className="stg:text-sm stg:font-semibold stg:text-foreground">
              {meta?.name || meta?.slug || "Instance"}
            </h3>
            <VisibilityBadge visibility={visibility} />
          </div>
          <p className="stg:text-[0.65rem] stg:text-muted-foreground">
            {createdAt && `Created ${createdAt.toLocaleDateString()}`}
            {updatedAt && ` \u00B7 Updated ${updatedAt.toLocaleDateString()}`}
          </p>
        </div>
        <div className="stg:flex stg:items-center stg:gap-2">
          {onStartSessionClick && (
            <button
              type="button"
              onClick={() => onStartSessionClick(instance)}
              className={cn(
                "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
                "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary/90",
                "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-ring",
              )}
            >
              Start session
            </button>
          )}
          <ManageAccessButton
            resource={{
              kind: ApiResourceKind.agent_instance,
              kindString: "agent_instance",
              id,
              org: meta?.org ?? "",
              name: meta?.name,
            }}
            visibility={{
              kind: "agentInstance",
              current: visibility,
              onChanged: onUpdated,
            }}
          />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className={cn(
              "stg:rounded-md stg:p-1 stg:text-muted-foreground",
              "stg:hover:text-foreground stg:hover:bg-accent-hover",
            )}
          >
            <CloseIcon />
          </button>
        </div>
      </div>

      <div className="stg:divide-y stg:divide-border">
        {/* Description */}
        {spec?.description && (
          <div className="stg:px-4 stg:py-3">
            <h4 className="stg:text-xs stg:font-medium stg:text-muted-foreground stg:mb-1">Description</h4>
            <p className="stg:text-sm stg:text-foreground">{spec.description}</p>
          </div>
        )}

        {/* Environments */}
        <div className="stg:px-4 stg:py-3">
          <div className="stg:flex stg:items-center stg:justify-between stg:mb-2">
            <h4 className="stg:text-xs stg:font-medium stg:text-muted-foreground">
              Environments ({spec?.environmentRefs?.length ?? 0})
            </h4>
            {!isEditingEnvs && (
              <PermissionGate resource={{ kind: "agent_instance", id }} relation="can_edit">
                <button
                  type="button"
                  onClick={handleStartEditEnvs}
                  className="stg:text-[0.65rem] stg:text-primary stg:hover:underline"
                >
                  Edit
                </button>
              </PermissionGate>
            )}
          </div>

          {isEditingEnvs ? (
            <div className="stg:space-y-2">
              <EnvironmentPicker
                org={org}
                value={editEnvRefs}
                onChange={setEditEnvRefs}
                disabled={isUpdating}
              />
              <div className="stg:flex stg:items-center stg:gap-2">
                <button
                  type="button"
                  onClick={handleSaveEnvs}
                  disabled={isUpdating}
                  className={cn(
                    "stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium",
                    "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary/90",
                    "stg:disabled:opacity-50",
                  )}
                >
                  {isUpdating ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingEnvs(false)}
                  disabled={isUpdating}
                  className="stg:rounded-md stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium stg:text-foreground stg:hover:bg-accent-hover"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              {(spec?.environmentRefs?.length ?? 0) === 0 ? (
                <p className="stg:text-xs stg:text-muted-foreground">No environments bound.</p>
              ) : (
                <ol className={cn(UNSTYLED_LIST, "stg:space-y-1")}>
                  {spec!.environmentRefs.map((ref, idx) => (
                    <li key={`${ref.slug}-${idx}`} className="stg:flex stg:items-center stg:gap-2 stg:text-sm">
                      <span className="stg:text-xs stg:text-muted-foreground stg:w-4 stg:text-right">{idx + 1}.</span>
                      <span className="stg:text-foreground">{resolveEnvName(ref.slug)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </div>

        {/* Delete */}
        <PermissionGate resource={{ kind: "agent_instance", id }} relation="can_delete">
          <div className="stg:px-4 stg:py-3">
            <h4 className="stg:text-xs stg:font-medium stg:text-destructive stg:mb-2">Danger Zone</h4>
            {!showDeleteConfirm ? (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className={cn(
                  "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
                  "stg:border stg:border-destructive/30 stg:text-destructive",
                  "stg:hover:bg-destructive/10",
                  "stg:focus:outline-none stg:focus:ring-2 stg:focus:ring-destructive",
                )}
              >
                Delete Instance
              </button>
            ) : (
              <div className="stg:space-y-2 stg:rounded-md stg:border stg:border-destructive/30 stg:p-3 stg:bg-destructive/5">
                <p className="stg:text-xs stg:text-destructive stg:font-medium">
                  This permanently removes this instance and its environment
                  bindings. Sessions already started against it and their
                  history are preserved. This action cannot be undone.
                </p>
                {deleteError && (
                  <p className="stg:text-xs stg:text-destructive" role="alert">
                    {getUserMessage(deleteError)}
                  </p>
                )}
                <div className="stg:flex stg:items-center stg:gap-2">
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className={cn(
                      "stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
                      "stg:bg-destructive stg:text-destructive-foreground",
                      "stg:hover:bg-destructive/90",
                      "stg:disabled:opacity-50",
                    )}
                  >
                    {isDeleting ? "Deleting..." : "Confirm Delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isDeleting}
                    className="stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium stg:text-foreground stg:hover:bg-accent-hover"
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
