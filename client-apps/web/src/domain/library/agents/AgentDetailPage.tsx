"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AgentDetailView,
  CreateAgentInstanceDialog,
  useAgent,
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
import { useLibraryNavigation } from "@/domain/library/library-navigation";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";
import { getAgentSessionUrl } from "@/domain/session/draft-session";

interface AgentDetailPageInnerProps {
  readonly org: string;
  readonly slug: string;
}

export function AgentDetailPageInner({ org, slug }: AgentDetailPageInnerProps) {
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();
  const { navigateToDetail } = useLibraryNavigation();
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [resourceName, setResourceName] = useState<string>("Agent");
  const { copyId, copyQualifiedSlug } = useCopyResource();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const { deleteResource, isDeleting } = useDeleteResource("agent", resourceId, resourceName);
  const { deleteInstance } = useDeleteAgentInstance();
  const { agent } = useAgent(org, slug);
  const { copyYaml, copyJson, downloadYaml } = useExportResource({
    kind: "Agent",
    resource: agent,
  });

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
      description: "This action cannot be undone. The agent and its configuration will be permanently removed.",
      confirmLabel: "Delete",
      variant: "destructive",
    });
    if (confirmed) {
      try {
        await deleteResource();
        router.push("/library/agents");
      } catch {
        // error toast handled by useDeleteResource
      }
    }
  }, [confirm, deleteResource, router, resourceName]);

  const primaryAction: DetailAction = useMemo(
    () => ({
      id: "start-session",
      label: "Start session",
      onAction: () => router.push(getAgentSessionUrl(org, slug)),
    }),
    [router, org, slug],
  );

  const handleInstanceStartSession = useCallback(
    (instance: AgentInstance) => {
      const instanceId = instance.metadata?.id;
      router.push(getAgentSessionUrl(org, slug, instanceId));
    },
    [router, org, slug],
  );

  const handleInstanceDelete = useCallback(
    async (instance: AgentInstance) => {
      const name = instance.metadata?.name || instance.metadata?.slug || "this instance";
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
    [resourceId, copyId, copyQualifiedSlug, org, slug, copyYaml, copyJson, downloadYaml, agent, handleDelete, isDeleting],
  );

  return (
    <>
      <AgentDetailView
        org={org}
        slug={slug}
        onResourceLoad={handleResourceLoad}
        onMcpServerClick={({ org: o, slug: s }) =>
          navigateToDetail("mcp-servers", o, s)
        }
        onSkillClick={({ org: o, slug: s }) =>
          navigateToDetail("skills", o, s)
        }
        editable
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

export function AgentDetailPage() {
  const org = useStaticRouteParam("org", 2);
  const slug = useStaticRouteParam("slug");

  if (!org || !slug) return null;

  return <AgentDetailPageInner org={org} slug={slug} />;
}

