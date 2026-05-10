import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  AgentDetailView,
  useAgent,
  useUpdateVisibility,
  useCopyResource,
  useConfirmAction,
  useDeleteResource,
  useExportResource,
  ConfirmDialog,
  useBreadcrumbOverride,
  type DetailAction,
} from "@stigmer/react";

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
  const { agent } = useAgent(org ?? "", slug ?? "");
  const { copyYaml, copyJson, downloadYaml } = useExportResource({
    kind: "Agent",
    resource: agent,
  });

  const { updateVisibility, isPending } = useUpdateVisibility(
    "agent",
    resourceId,
  );

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
        actions={actions}
      />
      <ConfirmDialog
        state={confirmState}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}
