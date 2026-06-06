import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  AgentDetailView,
  CreateAgentInstanceDialog,
  useAgent,
  useUpdateVisibility,
  useDeleteAgentInstance,
  useCopyResource,
  useConfirmAction,
  useDeleteResource,
  useExportResource,
  ConfirmDialog,
  useBreadcrumbOverride,
  type DetailAction,
} from "@stigmer/react";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";

/**
 * Build the home-route URL that opens the new-session screen with the agent
 * pre-selected, optionally bound to a specific instance. Mirrors the web
 * `getAgentSessionUrl` helper; the hash router resolves this to `#/?...`.
 */
function agentSessionUrl(org: string, slug: string, instanceId?: string): string {
  const base = `/?agent=${encodeURIComponent(`${org}/${slug}`)}`;
  return instanceId ? `${base}&instance=${encodeURIComponent(instanceId)}` : base;
}

export default function AgentDetailPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  const navigate = useNavigate();
  const { setLabel } = useBreadcrumbOverride();
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [resourceName, setResourceName] = useState<string>("Agent");
  const { copyId, copyQualifiedSlug } = useCopyResource();
  const { confirmState, confirm, handleConfirm, handleCancel } =
    useConfirmAction();
  const { deleteResource, isDeleting } = useDeleteResource(
    "agent",
    resourceId,
    resourceName,
  );
  const { deleteInstance } = useDeleteAgentInstance();
  const { agent } = useAgent(org ?? "", slug ?? "");
  const { copyYaml, copyJson, downloadYaml } = useExportResource({
    kind: "Agent",
    resource: agent,
  });

  const { updateVisibility, isPending } = useUpdateVisibility(
    "agent",
    resourceId,
  );

  const [showCreateInstanceDialog, setShowCreateInstanceDialog] = useState(false);
  const [instancesRefreshKey, setInstancesRefreshKey] = useState(0);

  useEffect(() => () => setLabel(null), [setLabel]);

  const handleResourceLoad = useCallback(
    ({ name, id }: { name: string; id: string }) => {
      setLabel(name);
      setResourceId(id);
      setResourceName(name);
    },
    [setLabel],
  );

  const handleDelete = useCallback(async () => {
    const confirmed = await confirm({
      title: `Delete ${resourceName}?`,
      description:
        "This action cannot be undone. The agent and its configuration will be permanently removed.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (confirmed) {
      try {
        await deleteResource();
        navigate("/library/agents");
      } catch {
        // error toast handled by useDeleteResource
      }
    }
  }, [confirm, deleteResource, navigate, resourceName]);

  const primaryAction: DetailAction = useMemo(
    () => ({
      id: "start-session",
      label: "Start session",
      onAction: () => navigate(agentSessionUrl(org ?? "", slug ?? "")),
    }),
    [navigate, org, slug],
  );

  const handleInstanceStartSession = useCallback(
    (instance: AgentInstance) => {
      navigate(agentSessionUrl(org ?? "", slug ?? "", instance.metadata?.id));
    },
    [navigate, org, slug],
  );

  const handleInstanceDelete = useCallback(
    async (instance: AgentInstance) => {
      const name =
        instance.metadata?.name || instance.metadata?.slug || "this instance";
      const confirmed = await confirm({
        title: `Delete ${name}?`,
        description:
          "This permanently removes the instance and its environment bindings. " +
          "Sessions already started against it are preserved. This action cannot be undone.",
        confirmLabel: "Delete",
        variant: "destructive",
      });
      if (!confirmed) return;
      const id = instance.metadata?.id;
      if (!id) return;
      try {
        await deleteInstance(id);
        toast.success("Instance deleted");
        setInstancesRefreshKey((k) => k + 1);
      } catch {
        toast.error("Failed to delete instance");
      }
    },
    [confirm, deleteInstance],
  );

  const actions: DetailAction[] = useMemo(
    () => [
      {
        id: "copy-id",
        label: "Copy ID",
        group: "clipboard",
        onAction: () => {
          if (resourceId) copyId(resourceId);
        },
        disabled: !resourceId,
      },
      {
        id: "copy-slug",
        label: "Copy slug",
        group: "clipboard",
        onAction: () => copyQualifiedSlug(org ?? "", slug ?? ""),
      },
      {
        id: "export-yaml",
        label: "Export YAML",
        group: "export",
        onAction: copyYaml,
        disabled: !agent,
      },
      {
        id: "export-json",
        label: "Export JSON",
        group: "export",
        onAction: copyJson,
        disabled: !agent,
      },
      {
        id: "download-yaml",
        label: "Download YAML",
        group: "export",
        onAction: downloadYaml,
        disabled: !agent,
      },
      {
        id: "delete",
        label: "Delete",
        variant: "destructive" as const,
        group: "danger",
        onAction: handleDelete,
        disabled: isDeleting,
      },
    ],
    [
      resourceId,
      copyId,
      copyQualifiedSlug,
      org,
      slug,
      copyYaml,
      copyJson,
      downloadYaml,
      agent,
      handleDelete,
      isDeleting,
    ],
  );

  if (!org || !slug) return null;

  return (
    <>
      <AgentDetailView
        org={org}
        slug={slug}
        editable
        onResourceLoad={handleResourceLoad}
        onMcpServerClick={(ref) =>
          navigate(`/library/mcp-servers/${ref.org}/${ref.slug}`)
        }
        onSkillClick={(ref) =>
          navigate(`/library/skills/${ref.org}/${ref.slug}`)
        }
        onVisibilityChange={updateVisibility}
        isVisibilityPending={isPending}
        primaryAction={primaryAction}
        actions={actions}
        onCreateInstanceClick={() => setShowCreateInstanceDialog(true)}
        onInstanceStartSessionClick={handleInstanceStartSession}
        onInstanceDeleteClick={handleInstanceDelete}
        instancesRefreshKey={instancesRefreshKey}
      />
      <ConfirmDialog
        state={confirmState}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
      {resourceId && (
        <CreateAgentInstanceDialog
          open={showCreateInstanceDialog}
          onOpenChange={setShowCreateInstanceDialog}
          org={org}
          agentId={resourceId}
          onCreated={() => {
            toast.success("Instance created");
            setInstancesRefreshKey((k) => k + 1);
          }}
        />
      )}
    </>
  );
}
