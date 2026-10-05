import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
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
  useOrgSlugForId,
} from "@stigmer/react";
import { buildChatUrl } from "@stigmer/sdk";
import { CONSOLE_URL } from "../../config";

/**
 * Share links must be reachable by anyone, so they point at the public
 * web console — never the desktop app's own Tauri origin.
 */
function buildShareUrl(shareId: string): string {
  return buildChatUrl(CONSOLE_URL, shareId);
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
  const { agent, refetch: refetchAgent } = useAgent(org ?? "", slug ?? "");
  const { copyYaml, copyJson, downloadYaml } = useExportResource({
    kind: "Agent",
    resource: agent,
  });

  const [editYamlOpen, setEditYamlOpen] = useState(false);

  // Controlled tab state — the WorkflowDetailPage Editor-tab precedent,
  // wired identically to the web app.
  const [activeTab, setActiveTab] = useState<string>("overview");

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

  // The Channels tab needs the loaded Agent; until then the tab is absent.
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
                  onConnectExternal={handleConnectExternal}
                  // A plain-anchor hash URL: the in-app WhatsApp connect
                  // dialog links here, and the hash router picks it up
                  // without a reload (parity with the web's
                  // /settings/channel-apps).
                  channelAppsHref="#/settings/channel-apps"
                  // Channel conversations open in the standard session route;
                  // SessionViewer renders them read-only (observer audience).
                  sessionHref={(id) => `#/sessions/${id}`}
                />
              ),
            },
          ]
        : [],
    [agent, handleConnectExternal],
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
        "This permanently removes the agent. " +
        "Past sessions and executions are preserved, but conversations on it cannot continue. " +
        "This action cannot be undone.",
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
          navigate(`/library/mcp-servers/${slugForOrg(ref.org)}/${ref.slug}`)
        }
        onSkillClick={(ref) =>
          navigate(`/library/skills/${slugForOrg(ref.org)}/${ref.slug}`)
        }
        onPluginClick={(ref) =>
          navigate(`/library/plugins/${slugForOrg(ref.org)}/${ref.slug}`)
        }
        primaryAction={primaryAction}
        actions={actions}
        buildShareUrl={buildShareUrl}
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
