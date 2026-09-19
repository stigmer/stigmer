import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  PluginDetailView,
  useCopyResource,
  useConfirmAction,
  useDeleteResource,
  ConfirmDialog,
  useBreadcrumbOverride,
  type DetailAction,
} from "@stigmer/react";

/**
 * The home-route URL that opens the new-session screen with the agent
 * pre-selected. Mirrors the web `getAgentSessionUrl` helper and the
 * agent detail page's own; the hash router resolves this to `#/?...`.
 */
function agentSessionUrl(org: string, slug: string): string {
  return `/?agent=${encodeURIComponent(`${org}/${slug}`)}`;
}

export default function PluginDetailPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  const navigate = useNavigate();
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
        navigate("/library/plugins");
      } catch {
        // error toast handled by useDeleteResource
      }
    }
  }, [confirm, deleteResource, navigate, resourceName]);

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
        onAction: () => copyQualifiedSlug(org ?? "", slug ?? ""),
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

  if (!org || !slug) return null;

  return (
    <>
      <PluginDetailView
        org={org}
        slug={slug}
        onResourceLoad={handleResourceLoad}
        onStartSession={({ org: o, slug: s }) => navigate(agentSessionUrl(o, s))}
        onSkillClick={({ org: o, slug: s }) => navigate(`/library/skills/${o}/${s}`)}
        onMcpServerClick={({ org: o, slug: s }) => navigate(`/library/mcp-servers/${o}/${s}`)}
        onAgentClick={({ org: o, slug: s }) => navigate(`/library/agents/${o}/${s}`)}
        onWorkflowClick={({ org: o, slug: s }) => navigate(`/library/workflows/${o}/${s}`)}
        onCreateAgent={(usages) =>
          navigate(`/library/agents/new?mcp=${usages.map((u) => encodeURIComponent(u.mcpServerRef.slug)).join(",")}`)
        }
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
