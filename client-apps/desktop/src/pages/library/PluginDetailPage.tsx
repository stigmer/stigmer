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
  useOrgSlugForId,
} from "@stigmer/react";

/**
 * The home-route URL that opens the new-session screen for a chat with the
 * assistant that uses the plugin. Mirrors the web `getPluginChatUrl`
 * helper; the hash router resolves this to `#/?...`.
 */
function pluginChatUrl(org: string, slug: string): string {
  return `/?plugin=${encodeURIComponent(`${org}/${slug}`)}`;
}

export default function PluginDetailPage() {
  const { org, slug } = useParams<{ org: string; slug: string }>();
  const navigate = useNavigate();
  const slugForOrg = useOrgSlugForId();
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
        "Removes the plugin and its versions. The server refuses while an agent of the organization uses it; a conversation that uses it fails its next message.",
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
        onStartChat={({ org: o, slug: s }) => navigate(pluginChatUrl(o, s))}
        onAgentClick={({ org: o, slug: s }) => navigate(`/library/agents/${slugForOrg(o)}/${s}`)}
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
