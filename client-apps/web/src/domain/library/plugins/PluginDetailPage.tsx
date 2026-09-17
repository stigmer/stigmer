"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  PluginDetailView,
  useCopyResource,
  useConfirmAction,
  useDeleteResource,
  ConfirmDialog,
  useBreadcrumbOverride,
  type DetailAction,
} from "@stigmer/react";
import {
  useLibraryNavigation,
  useRouteDetailYieldsToOverlay,
} from "@/domain/library/library-navigation";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";
import { getAgentSessionUrl } from "@/domain/session/session-url";

interface PluginDetailPageInnerProps {
  readonly org: string;
  readonly slug: string;
}

export function PluginDetailPageInner({ org, slug }: PluginDetailPageInnerProps) {
  const router = useRouter();
  const { navigateToDetail } = useLibraryNavigation();
  const { setLabel } = useBreadcrumbOverride();
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [resourceName, setResourceName] = useState<string>("Plugin");
  const { copyId, copyQualifiedSlug } = useCopyResource();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const { deleteResource, isDeleting } = useDeleteResource("plugin", resourceId, resourceName);

  useEffect(() => () => setLabel(null), [setLabel]);

  const handleResourceLoad = useCallback(
    ({ name, id }: { name: string; id: string }) => {
      setLabel(name);
      setResourceId(id);
      setResourceName(name);
    },
    [setLabel],
  );

  const handleRemove = useCallback(async () => {
    const confirmed = await confirm({
      title: `Remove ${resourceName}?`,
      description:
        "Removes the plugin and every skill, MCP server and agent it installed. The server refuses if something outside the plugin still uses one of them.",
      confirmLabel: "Remove",
      variant: "destructive",
    });
    if (confirmed) {
      try {
        await deleteResource();
        router.push("/library/plugins");
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
        id: "remove",
        label: "Remove",
        variant: "destructive" as const,
        group: "danger",
        onAction: handleRemove,
        disabled: isDeleting,
      },
    ],
    [resourceId, copyId, copyQualifiedSlug, org, slug, handleRemove, isDeleting],
  );

  return (
    <>
      <PluginDetailView
        org={org}
        slug={slug}
        onResourceLoad={handleResourceLoad}
        onStartSession={({ org: o, slug: s }) => router.push(getAgentSessionUrl(o, s))}
        onSkillClick={({ org: o, slug: s }) => navigateToDetail("skills", o, s)}
        onMcpServerClick={({ org: o, slug: s }) => navigateToDetail("mcp-servers", o, s)}
        onAgentClick={({ org: o, slug: s }) => navigateToDetail("agents", o, s)}
        onWorkflowClick={({ org: o, slug: s }) => navigateToDetail("workflows", o, s)}
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

export function PluginDetailPage() {
  // The zone overlay owns detail rendering while it is active (oss#621).
  const yieldsToOverlay = useRouteDetailYieldsToOverlay();
  const org = useStaticRouteParam("org", 2);
  const slug = useStaticRouteParam("slug");

  if (yieldsToOverlay || !org || !slug) return null;

  return <PluginDetailPageInner org={org} slug={slug} />;
}
