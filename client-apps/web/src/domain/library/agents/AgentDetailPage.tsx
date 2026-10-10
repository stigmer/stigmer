"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AgentChannelsPanel,
  AgentDetailView,
  EditResourceYamlDialog,
  useAgent,
  useCopyResource,
  useConfirmAction,
  useDeleteResource,
  useExportResource,
  ConfirmDialog,
  useBreadcrumbOverride,
  type AdditionalTab,
  type DetailAction,
} from "@stigmer/react";
import {
  useLibraryNavigation,
  useRouteDetailYieldsToOverlay,
} from "@/domain/library/library-navigation";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";
import { getAgentSessionUrl } from "@/domain/session/session-url";
import { shareUrlFor } from "@/domain/sharing/share-url";
import { AGENT_DELETE_DESCRIPTION } from "@/domain/library/agents/agent-delete-confirmation";

/**
 * Read the `?tab=` deep-link target once, at mount.
 *
 * Lets external surfaces (the desktop app's Connect action, docs links)
 * land directly on a specific tab — e.g. `?tab=channels`. Read from
 * `window.location` instead of `useSearchParams()` because tab state is
 * deliberately local after landing and the static-export prerender has no
 * URL to read (the `useStaticRouteParam` idiom).
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
  const { navigateToDetail } = useLibraryNavigation();
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [resourceName, setResourceName] = useState<string>("Agent");
  const { copyId, copyQualifiedSlug } = useCopyResource();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const { deleteResource, isDeleting } = useDeleteResource("agent", resourceId, resourceName);
  const { agent, refetch: refetchAgent } = useAgent(org, slug);
  const { copyYaml, copyJson, downloadYaml } = useExportResource({ resource: agent });

  const [editYamlOpen, setEditYamlOpen] = useState(false);

  // Controlled tab state, seeded from the ?tab= deep link so cross-surface
  // handoffs land on the right tab.
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
      description: AGENT_DELETE_DESCRIPTION,
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
        onSkillClick={({ org: o, slug: s }) =>
          navigateToDetail("skills", o, s)
        }
        onPluginClick={({ org: o, slug: s }) =>
          navigateToDetail("plugins", o, s)
        }
        editable
        primaryAction={primaryAction}
        actions={actions}
        buildShareUrl={shareUrlFor}
        additionalTabs={additionalTabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
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

