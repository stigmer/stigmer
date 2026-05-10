"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  SkillDetailView,
  useUpdateVisibility,
  useCopyResource,
  useConfirmAction,
  useDeleteResource,
  ConfirmDialog,
  useBreadcrumbOverride,
  type DetailAction,
} from "@stigmer/react";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";

interface SkillDetailPageInnerProps {
  readonly org: string;
  readonly slug: string;
}

export function SkillDetailPageInner({ org, slug }: SkillDetailPageInnerProps) {
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [resourceName, setResourceName] = useState<string>("Skill");
  const { copyId, copyQualifiedSlug } = useCopyResource();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const { deleteResource, isDeleting } = useDeleteResource("skill", resourceId, resourceName);

  const { updateVisibility, isPending } = useUpdateVisibility(
    "skill",
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
      description: "This action cannot be undone. The skill and its content will be permanently removed.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (confirmed) {
      try {
        await deleteResource();
        router.push("/library/skills");
      } catch {
        // error toast handled by useDeleteResource
      }
    }
  }, [confirm, deleteResource, router, resourceName]);

  const actions: DetailAction[] = useMemo(
    () => [
      {
        id: "copy-id",
        label: "Copy ID",
        group: "clipboard",
        onAction: () => { if (resourceId) copyId(resourceId); },
        disabled: !resourceId,
      },
      {
        id: "copy-slug",
        label: "Copy slug",
        group: "clipboard",
        onAction: () => copyQualifiedSlug(org, slug),
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
    [resourceId, copyId, copyQualifiedSlug, org, slug, handleDelete, isDeleting],
  );

  return (
    <>
      <SkillDetailView
        org={org}
        slug={slug}
        editable
        onResourceLoad={handleResourceLoad}
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

export function SkillDetailPage() {
  const org = useStaticRouteParam("org", 2);
  const slug = useStaticRouteParam("slug");

  if (!org || !slug) return null;

  return <SkillDetailPageInner org={org} slug={slug} />;
}
