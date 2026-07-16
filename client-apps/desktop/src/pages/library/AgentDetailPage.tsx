import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  AgentChannelsPanel,
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
  useActiveOrgSlug,
  type AdditionalTab,
  type DetailAction,
} from "@stigmer/react";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { CONSOLE_URL } from "../../config";

/**
 * Share links must be reachable by anyone, so they point at the public
 * web console — never the desktop app's own Tauri origin.
 */
function buildShareUrl(org: string, slug: string): string {
  return `${CONSOLE_URL}/chat/${org}/${slug}`;
}

/**
 * Build the home-route URL that opens the new-session screen with the agent
 * pre-selected, optionally bound to a specific instance. Mirrors the web
 * `getAgentSessionUrl` helper; the hash router resolves this to `#/?...`.
 */
function agentSessionUrl(org: string, slug: string, instanceId?: string): string {
  const base = `/?agent=${encodeURIComponent(`${org}/${slug}`)}`;
  return instanceId ? `${base}&instance=${encodeURIComponent(instanceId)}` : base;
}

export default function AgentDetailPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  const navigate = useNavigate();
  // The viewer's own org — shares created from the Shares tab land in it
  // (a cross-org share when it differs from the agent's org, decision 013).
  const viewerOrg = useActiveOrgSlug();
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
  const { deleteInstance } = useDeleteAgentInstance();
  const { agent } = useAgent(org ?? "", slug ?? "");
  const { copyYaml, copyJson, downloadYaml } = useExportResource({
    kind: "Agent",
    resource: agent,
  });

  const [showCreateInstanceDialog, setShowCreateInstanceDialog] = useState(false);
  const [instancesRefreshKey, setInstancesRefreshKey] = useState(0);

  // Controlled tab state — the WorkflowDetailPage Editor-tab precedent,
  // wired identically to the web app (DD-016 parity).
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
                  // without a reload (DD-016 parity with the web's
                  // /settings/channel-apps).
                  channelAppsHref="#/settings/channel-apps"
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
        "This action cannot be undone. The agent and its configuration will be permanently removed.",
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

  const handleInstanceStartSession = useCallback(
    (instance: AgentInstance) => {
      navigate(agentSessionUrl(org ?? "", slug ?? "", instance.metadata?.id));
    },
    [navigate, org, slug],
  );

  const handleInstanceDelete = useCallback(
    async (instance: AgentInstance) => {
      const name =
        instance.metadata?.name || instance.metadata?.slug || "this instance";
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
          navigate(`/library/mcp-servers/${ref.org}/${ref.slug}`)
        }
        onSkillClick={(ref) =>
          navigate(`/library/skills/${ref.org}/${ref.slug}`)
        }
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
