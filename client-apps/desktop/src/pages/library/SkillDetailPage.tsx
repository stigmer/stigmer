import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  SkillDetailView,
  useCopyResource,
  useConfirmAction,
  useDeleteResource,
  ConfirmDialog,
  useBreadcrumbOverride,
  type DetailAction,
} from "@stigmer/react";

export default function SkillDetailPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  const navigate = useNavigate();
  const { setLabel } = useBreadcrumbOverride();
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [resourceName, setResourceName] = useState<string>("Skill");
  const { copyId, copyQualifiedSlug } = useCopyResource();
  const { confirmState, confirm, handleConfirm, handleCancel } =
    useConfirmAction();
  const { deleteResource, isDeleting } = useDeleteResource(
    "skill",
    resourceId,
    resourceName,
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
        "This action cannot be undone. The skill and its content will be permanently removed.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (confirmed) {
      try {
        await deleteResource();
        navigate("/library/skills");
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
      handleDelete,
      isDeleting,
    ],
  );

  if (!org || !slug) return null;

  return (
    <>
      <SkillDetailView
        org={org}
        slug={slug}
        editable
        onResourceLoad={handleResourceLoad}
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
