import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  AgentDetailView,
  useCopyResource,
  useConfirmAction,
  useDeleteResource,
  ConfirmDialog,
  useBreadcrumbOverride,
  type DetailAction,
  useOrgSlugForId,
  useResolveRunSession,
} from "@stigmer/react-sdk";
import { buildChatUrl } from "@stigmer/client";
import { CONSOLE_URL } from "../../config";
import { AGENT_DELETE_DESCRIPTION } from "./agent-delete-confirmation";
import { useCanonicalDetailSlug } from "./canonical-slug";
import { useJourneyLinks } from "../../journey/journey-links";

/**
 * Chat links must be reachable by anyone, so they point at the public
 * web console — never the desktop app's own Tauri origin.
 */
function buildChatLinkUrl(channelId: string): string {
  return buildChatUrl(CONSOLE_URL, channelId);
}

/**
 * Build the home-route URL that opens the new-session screen with the agent
 * pre-selected; the conversation starts on the agent itself. Mirrors the
 * web `getAgentSessionUrl` helper; the hash router resolves this to
 * `#/?...`.
 */
function agentSessionUrl(org: string, slug: string): string {
  return `/?agent=${encodeURIComponent(`${org}/${slug}`)}`;
}

export default function AgentDetailPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  const navigate = useNavigate();
  const slugForOrg = useOrgSlugForId();
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
  // An eval's try is a run (run_…); on desktop it is viewed through its
  // parent session, the resolve-then-navigate pattern of the plugin page.
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const { sessionId } = useResolveRunSession(pendingRunId);

  useEffect(() => {
    if (sessionId) {
      navigate(`/sessions/${sessionId}`);
    }
  }, [sessionId, navigate]);

  // Controlled tab state, wired identically to the web app: seeded from
  // the `?tab=` a link names (the journey's "Make it yours", say), and moved
  // when a later link names another.
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<string>(() => tabParam ?? "overview");
  const [seenTabParam, setSeenTabParam] = useState(tabParam);
  if (tabParam !== seenTabParam) {
    setSeenTabParam(tabParam);
    if (tabParam !== null) setActiveTab(tabParam);
  }
  const journeyLinks = useJourneyLinks();

  // Tauri's Wry webview blocks window.open(), so the OAuth popup flow
  // cannot run in-app (the same posture as MCP OAuth, which is web-only).
  // Redirect-style connects (Slack) hand off to the web console in the
  // system browser, landing on this agent's Channels tab via the ?tab=
  // deep link. Direct-install providers (WhatsApp) never invoke this —
  // the panel runs their flow in-app, popup-free.
  const handleConnectExternal = useCallback(() => {
    void invoke("open_auth_in_browser", {
      authUrl: `${CONSOLE_URL}/library/agents/${org}/${slug}?tab=channels`,
    });
  }, [org, slug]);

  useEffect(() => () => setLabel(null), [setLabel]);

  // The view holds the one copy of the agent (its Edit YAML and exports
  // read it too) and reports each load; the slug it loaded at moves the
  // route, after a YAML apply that renamed it too, as on the routine page.
  const [loadedSlug, setLoadedSlug] = useState<string | undefined>(undefined);
  const moveToSlug = useCanonicalDetailSlug("agents", org, slug, loadedSlug);

  const handleResourceLoad = useCallback(
    ({ name, id, slug: loaded }: { name: string; id: string; slug: string }) => {
      setLabel(name);
      setResourceId(id);
      setResourceName(name);
      setLoadedSlug(loaded);
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
        requires: "can_delete",
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
      <AgentDetailView
        org={org}
        slug={slug}
        editable
        onResourceLoad={handleResourceLoad}
        onSkillClick={(ref) =>
          navigate(`/library/skills/${slugForOrg(ref.org)}/${ref.slug}`)
        }
        onPluginClick={(ref) =>
          navigate(`/library/plugins/${slugForOrg(ref.org)}/${ref.slug}`)
        }
        onAgentClick={(ref) =>
          navigate(`/library/agents/${slugForOrg(ref.org)}/${ref.slug}`)
        }
        onNavigateToRun={setPendingRunId}
        onRenamed={(renamed) => moveToSlug(renamed.metadata?.slug ?? "")}
        primaryAction={primaryAction}
        actions={actions}
        yamlActions
        buildChatLinkUrl={buildChatLinkUrl}
        onConnectExternal={handleConnectExternal}
        // A plain-anchor hash URL: the in-app WhatsApp connect dialog links
        // here, and the hash router picks it up without a reload (parity
        // with the web's /settings/channel-apps).
        channelAppsHref="#/settings/channel-apps"
        // Channel conversations open in the standard session route;
        // SessionViewer renders them read-only (observer audience).
        sessionHref={(id) => `#/sessions/${id}`}
        // The journey's tab, for an agent the journey made.
        makeItYours={journeyLinks}
        inApp={journeyLinks}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />
      <ConfirmDialog
        state={confirmState}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}
