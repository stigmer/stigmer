"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AgentChannelsPanel,
  AgentDetailView,
  CreateAgentInstanceDialog,
  EditResourceYamlDialog,
  useAgent,
  useDeleteAgentInstance,
  useCopyResource,
  useConfirmAction,
  useDeleteResource,
  useExportResource,
  ConfirmDialog,
  useBreadcrumbOverride,
  useActiveOrgSlug,
  type AdditionalTab,
  type DetailAction,
} from "@stigmer/react";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import {
  useLibraryNavigation,
  useRouteDetailYieldsToOverlay,
} from "@/domain/library/library-navigation";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";
import { getAgentSessionUrl } from "@/domain/session/draft-session";
import { getAppBaseUrl } from "@/config/env";

/**
 * Read the `?tab=` deep-link target once, at mount.
 *
 * Lets external surfaces (the desktop app's Connect action, docs links)
 * land directly on a specific tab — e.g. `?tab=channels`. Read from
 * `window.location` instead of `useSearchParams()` because tab state is
 * deliberately local after landing (the workflow Editor-tab precedent) and
 * the static-export prerender has no URL to read (the
 * `useStaticRouteParam` idiom).
 */
function initialTabFromUrl(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get("tab") ?? undefined;
}

interface AgentDetailPageInnerProps {
  readonly org: string;
  readonly slug: string;
}

export function AgentDetailPageInner({ org, slug }: AgentDetailPageInnerProps) {
  const router = useRouter();
  const { setLabel } = useBreadcrumbOverride();
  // The viewer's own org — shares created from the Shares tab land in it
  // (a cross-org share when it differs from the agent's org, decision 013).
  const viewerOrg = useActiveOrgSlug();
  const { navigateToDetail } = useLibraryNavigation();
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [resourceName, setResourceName] = useState<string>("Agent");
  const { copyId, copyQualifiedSlug } = useCopyResource();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const { deleteResource, isDeleting } = useDeleteResource("agent", resourceId, resourceName);
  const { deleteInstance } = useDeleteAgentInstance();
  const { agent, refetch: refetchAgent } = useAgent(org, slug);
  const { copyYaml, copyJson, downloadYaml } = useExportResource({
    kind: "Agent",
    resource: agent,
  });

  const [editYamlOpen, setEditYamlOpen] = useState(false);
  const [showCreateInstanceDialog, setShowCreateInstanceDialog] = useState(false);
  const [instancesRefreshKey, setInstancesRefreshKey] = useState(0);

  // Controlled tab state (the WorkflowDetailPage Editor-tab precedent),
  // seeded from the ?tab= deep link so cross-surface handoffs land on the
  // right tab.
  const [activeTab, setActiveTab] = useState<string>(
    () => initialTabFromUrl() ?? "overview",
  );

  // The Channels tab needs the loaded Agent; until then the tab is absent
  // and a ?tab=channels deep link shows Overview, upgrading on load.
  const additionalTabs: AdditionalTab[] = useMemo(
    () =>
      agent
        ? [
            {
              id: "channels",
              label: "Channels",
              content: (
                <AgentChannelsPanel
                  agent={agent}
                  channelAppsHref="/settings/channel-apps"
                  // Channel conversations open in the standard session route;
                  // SessionViewer renders them read-only (observer audience).
                  sessionHref={(id) => `/sessions/${id}`}
                />
              ),
            },
          ]
        : [],
    [agent],
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

  const buildShareUrl = useCallback(
    (shareOrg: string, shareSlug: string) =>
      `${getAppBaseUrl()}/chat/${shareOrg}/${shareSlug}`,
    [],
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
        id: "edit-yaml",
        label: "Edit YAML",
        group: "export",
        onAction: () => setEditYamlOpen(true),
        disabled: !agent,
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
        buildShareUrl={buildShareUrl}
        viewerOrg={viewerOrg}
        additionalTabs={additionalTabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onCreateInstanceClick={() => setShowCreateInstanceDialog(true)}
        onInstanceStartSessionClick={handleInstanceStartSession}
        onInstanceDeleteClick={handleInstanceDelete}
        instancesRefreshKey={instancesRefreshKey}
      />
      <EditResourceYamlDialog
        open={editYamlOpen}
        onOpenChange={setEditYamlOpen}
        resource={agent}
        onApplied={refetchAgent}
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
  // The zone overlay owns detail rendering while it is active (oss#621).
  const yieldsToOverlay = useRouteDetailYieldsToOverlay();
  const org = useStaticRouteParam("org", 2);
  const slug = useStaticRouteParam("slug");

  if (yieldsToOverlay || !org || !slug) return null;

  return <AgentDetailPageInner org={org} slug={slug} />;
}

