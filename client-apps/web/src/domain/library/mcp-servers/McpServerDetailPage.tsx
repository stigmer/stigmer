"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EditResourceYamlDialog,
  McpServerDetailView,
  useMcpServer,
  useActiveOrgSlug,
  useCopyResource,
  useConfirmAction,
  useDeleteResource,
  useExportResource,
  ConfirmDialog,
  useBreadcrumbOverride,
  type DetailAction,
} from "@stigmer/react";
import { useRouteDetailYieldsToOverlay } from "@/domain/library/library-navigation";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";

interface McpServerDetailPageInnerProps {
  readonly org: string;
  readonly slug: string;
}

export function McpServerDetailPageInner({
  org,
  slug,
}: McpServerDetailPageInnerProps) {
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();
  const activeOrgSlug = useActiveOrgSlug();
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [resourceName, setResourceName] = useState<string>("MCP Server");
  const { copyId, copyQualifiedSlug } = useCopyResource();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const { deleteResource, isDeleting } = useDeleteResource("mcpServer", resourceId, resourceName);
  // Fetched once here and passed into the view as hoisted state — the page
  // needs the resource for its YAML actions anyway, and handing it down
  // spares the view its own duplicate getByReference on every page load.
  const mcpServerState = useMcpServer(org, slug);
  const { mcpServer, refetch: refetchMcpServer } = mcpServerState;
  const { copyYaml, copyJson, downloadYaml } = useExportResource({
    kind: "McpServer",
    resource: mcpServer,
  });
  const [editYamlOpen, setEditYamlOpen] = useState(false);

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
      description: "This action cannot be undone. The MCP server configuration and all connection data will be permanently removed.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (confirmed) {
      try {
        await deleteResource();
        router.push("/library/mcp-servers");
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
        id: "edit-yaml",
        label: "Edit YAML",
        group: "export",
        onAction: () => setEditYamlOpen(true),
        disabled: !mcpServer,
      },
      {
        id: "export-yaml",
        label: "Export YAML",
        group: "export",
        onAction: copyYaml,
        disabled: !mcpServer,
      },
      {
        id: "export-json",
        label: "Export JSON",
        group: "export",
        onAction: copyJson,
        disabled: !mcpServer,
      },
      {
        id: "download-yaml",
        label: "Download YAML",
        group: "export",
        onAction: downloadYaml,
        disabled: !mcpServer,
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
    [resourceId, copyId, copyQualifiedSlug, org, slug, copyYaml, copyJson, downloadYaml, mcpServer, handleDelete, isDeleting],
  );

  return (
    <>
      <McpServerDetailView
        org={org}
        slug={slug}
        mcpServerState={mcpServerState}
        activeOrg={activeOrgSlug}
        onResourceLoad={handleResourceLoad}
        editable
        actions={actions}
      />
      <EditResourceYamlDialog
        open={editYamlOpen}
        onOpenChange={setEditYamlOpen}
        resource={mcpServer}
        onApplied={refetchMcpServer}
      />
      <ConfirmDialog
        state={confirmState}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}

export function McpServerDetailPage() {
  // The zone overlay owns detail rendering while it is active (oss#621).
  const yieldsToOverlay = useRouteDetailYieldsToOverlay();
  const org = useStaticRouteParam("org", 2);
  const slug = useStaticRouteParam("slug");

  if (yieldsToOverlay || !org || !slug) return null;

  return <McpServerDetailPageInner org={org} slug={slug} />;
}
