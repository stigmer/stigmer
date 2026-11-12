"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AgentDetailView,
  useCopyResource,
  useConfirmAction,
  useDeleteResource,
  ConfirmDialog,
  useBreadcrumbOverride,
  type DetailAction,
} from "@stigmer/react-sdk";
import {
  useLibraryNavigation,
  useRouteDetailYieldsToOverlay,
} from "@/domain/library/library-navigation";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";
import { useRunNavigation } from "@/domain/runs/run-navigation";
import { getAgentSessionUrl } from "@/domain/session/session-url";
import { chatLinkUrlFor } from "@/domain/chat-link/chat-link-url";
import { AGENT_DELETE_DESCRIPTION } from "@/domain/library/agents/agent-delete-confirmation";
import { useJourneyLinks } from "@/domain/journey/journey-links";

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
  const { navigateToDetail, canonicalSlug } = useLibraryNavigation();
  const { navigateToRun } = useRunNavigation();
  const [resourceId, setResourceId] = useState<string | null>(null);
  const [resourceName, setResourceName] = useState<string>("Agent");
  const { copyId, copyQualifiedSlug } = useCopyResource();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const { deleteResource, isDeleting } = useDeleteResource("agent", resourceId, resourceName);

  // Controlled tab state, seeded from the ?tab= deep link so cross-surface
  // handoffs land on the right tab.
  const [activeTab, setActiveTab] = useState<string>(
    () => initialTabFromUrl() ?? "overview",
  );
  // A client-side arrival (the journey's "Make it yours" links) can first
  // render before the address holds its `?tab=`; the next render reads it,
  // and a `?tab=` not seen before moves the tab (set during render, as React
  // allows for a component's own state). A tab the person picks later stays.
  const linkedTab = initialTabFromUrl();
  const [seenLinkedTab, setSeenLinkedTab] = useState(linkedTab);
  if (linkedTab !== seenLinkedTab) {
    setSeenLinkedTab(linkedTab);
    if (linkedTab !== undefined) setActiveTab(linkedTab);
  }
  const journeyLinks = useJourneyLinks();

  useEffect(() => () => setLabel(null), [setLabel]);

  // The view holds the one copy of the agent (its Edit YAML and exports
  // read it too) and reports each load. The read answers the agent's
  // current slug, so a URL naming one it was renamed away from (which still
  // leads to it), or a YAML apply that renamed it, moves the address in place.
  const handleResourceLoad = useCallback(
    ({ name, id, slug: loadedSlug }: { name: string; id: string; slug: string }) => {
      setLabel(name);
      setResourceId(id);
      setResourceName(name);
      if (loadedSlug !== "" && loadedSlug !== slug) canonicalSlug(loadedSlug);
    },
    [setLabel, slug, canonicalSlug],
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
        id: "delete",
        requires: "can_delete",
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
        onAgentClick={({ org: o, slug: s }) =>
          navigateToDetail("agents", o, s)
        }
        onNavigateToRun={navigateToRun}
        onRenamed={(renamed) => {
          if (renamed.metadata?.slug) canonicalSlug(renamed.metadata.slug);
        }}
        editable
        primaryAction={primaryAction}
        actions={actions}
        yamlActions
        buildChatLinkUrl={chatLinkUrlFor}
        channelAppsHref="/settings/channel-apps"
        // Channel conversations open in the standard session route;
        // SessionViewer renders them read-only (observer audience).
        sessionHref={(id) => `/sessions/${id}`}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        // The journey's tab, for an agent the journey made.
        makeItYours={journeyLinks}
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

