"use client";

/**
 * The Library's Plugins list: what the organization has installed, with
 * the three ways in beside it (the Marketplace, an upload from disk, and
 * "Add MCP server", which installs a plugin of one server built in the
 * browser). `?add=mcp-server` opens that form on arrival, which is how the
 * Library's Add menu reaches it.
 */

import { useCallback, useMemo, useReducer, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Blocks, Copy, ExternalLink, MoreHorizontal, Server, Store, Trash2, Upload } from "lucide-react";
import { useLibraryNavigation } from "@/domain/library/library-navigation";
import { ADD_MCP_SERVER, ADD_PARAM } from "@/domain/library/plugins/add-mcp-server";
import {
  AddMcpServerDialog,
  ResourceWorkbench,
  ActionMenu,
  useStigmer,
  useActiveOrgId,
  OrgSlugText,
  useOrgSlugForId,
  useConfirmAction,
  ConfirmDialog,
  toast,
  type WorkbenchColumnDef,
} from "@stigmer/react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

const VIEW_MODE_STORAGE_KEY = "stigmer:workbench:plugins:viewMode";

const PLUGIN_COLUMNS: WorkbenchColumnDef<SearchResult>[] = [
  {
    id: "name",
    header: "Name",
    cell: (item) => (
      <span className="font-medium text-foreground">
        {item.name || item.slug}
      </span>
    ),
    sortable: true,
    flex: 2,
  },
  {
    id: "org",
    header: "Organization",
    cell: (item) => (
      <OrgSlugText orgId={item.org} className="text-muted-foreground" />
    ),
    flex: 1,
  },
  {
    id: "description",
    header: "Description",
    cell: (item) => (
      <span className="line-clamp-1 text-muted-foreground">
        {item.description || "\u2014"}
      </span>
    ),
    flex: 3,
  },
];

const PRIMARY_LINK_CLASSES =
  "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const SECONDARY_LINK_CLASSES =
  "inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The ways in, side by side: the Marketplace (what you can get), an upload from disk (what you have), and one MCP server by its address. */
function WaysIn({ size, onAddMcpServer }: { readonly size: "sm" | "xs"; readonly onAddMcpServer: () => void }) {
  const text = size === "sm" ? "text-sm" : "text-xs";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Link href="/marketplace" className={`${PRIMARY_LINK_CLASSES} ${text}`}>
        <Store className="size-3.5" aria-hidden="true" />
        Browse Marketplace
      </Link>
      <Link href="/library/plugins/upload" className={`${SECONDARY_LINK_CLASSES} ${text}`}>
        <Upload className="size-3.5" aria-hidden="true" />
        Upload plugin
      </Link>
      <button type="button" onClick={onAddMcpServer} className={`${SECONDARY_LINK_CLASSES} ${text}`}>
        <Server className="size-3.5" aria-hidden="true" />
        Add MCP server
      </button>
    </div>
  );
}

export function PluginListPage() {
  const org = useActiveOrgId();
  const slugForOrg = useOrgSlugForId();
  const stigmer = useStigmer();
  const { navigateToDetail } = useLibraryNavigation();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const searchParams = useSearchParams();
  const [addingServer, setAddingServer] = useState(() => searchParams.get(ADD_PARAM) === ADD_MCP_SERVER);
  const openAddServer = useCallback(() => setAddingServer(true), []);

  // Bumped after a remove to refetch the list in place — no remount
  // flash, pagination and sort preserved.
  const [refetchToken, refreshList] = useReducer((n: number) => n + 1, 0);

  const handleRemoveItem = useCallback(
    async (item: SearchResult) => {
      const confirmed = await confirm({
        title: `Remove ${item.name || item.slug}?`,
        description:
          "Removes the plugin and its versions. The server refuses while an agent of the organization uses it; a conversation that uses it fails its next message.",
        confirmLabel: "Remove",
        variant: "destructive",
      });
      if (!confirmed) return;
      try {
        await stigmer.plugin.delete(item.id);
        toast.success(`${item.name || item.slug} removed`);
        refreshList();
      } catch (error) {
        // The server's refusal names the agent that still uses the plugin; show it as it is.
        toast.error(error instanceof Error ? error.message : "Failed to remove plugin");
      }
    },
    [confirm, stigmer],
  );

  const listFn = useMemo(
    () => (params: Parameters<typeof stigmer.plugin.list>[0]) =>
      stigmer.plugin.list(params),
    [stigmer],
  );

  return (
    <>
      <div className="mb-6">
        <h1 className="text-foreground text-xl font-semibold">Plugins</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          What you have installed. A plugin is what you install; the agent it installs is what runs.
        </p>
      </div>

      <ResourceWorkbench
        refetchToken={refetchToken}
        listFn={listFn}
        org={org}
        columns={PLUGIN_COLUMNS}
        defaultViewMode="cards"
        viewModes={["table", "cards"]}
        viewModeStorageKey={VIEW_MODE_STORAGE_KEY}
        searchPlaceholder="Search plugins…"
        emptyIcon={<Blocks className="size-10" aria-hidden="true" />}
        emptyTitle="No plugins installed"
        emptyDescription="Install a plugin from the Marketplace, upload one from your computer, or add an MCP server: a chat or an agent that uses a plugin gets its skills, agents, hooks and MCP servers, as one unit."
        headerAction={<WaysIn size="sm" onAddMcpServer={openAddServer} />}
        emptyAction={<WaysIn size="xs" onAddMcpServer={openAddServer} />}
        onItemClick={(item) => navigateToDetail("plugins", item.org, item.slug)}
        renderItemAction={(item) => (
          <div onClick={(e) => e.stopPropagation()}>
            <ActionMenu>
              <ActionMenu.Trigger aria-label={`Actions for ${item.name || item.slug}`}>
                <MoreHorizontal className="size-4" />
              </ActionMenu.Trigger>
              <ActionMenu.Content>
                <ActionMenu.Item
                  icon={<ExternalLink className="size-4" />}
                  onSelect={() => navigateToDetail("plugins", item.org, item.slug)}
                >
                  View details
                </ActionMenu.Item>
                <ActionMenu.Item
                  icon={<Copy className="size-4" />}
                  onSelect={() => {
                    navigator.clipboard.writeText(`${slugForOrg(item.org)}/${item.slug}`);
                    toast.success("Copied plugin ID");
                  }}
                >
                  Copy ID
                </ActionMenu.Item>
                <ActionMenu.Separator />
                <ActionMenu.Item
                  icon={<Trash2 className="size-4" />}
                  variant="destructive"
                  onSelect={() => handleRemoveItem(item)}
                >
                  Remove
                </ActionMenu.Item>
              </ActionMenu.Content>
            </ActionMenu>
          </div>
        )}
        aria-label="Plugin workbench"
      />

      {org && (
        <AddMcpServerDialog
          org={org}
          open={addingServer}
          onClose={() => setAddingServer(false)}
          onAdded={(plugin) => {
            setAddingServer(false);
            navigateToDetail("plugins", plugin.metadata?.org ?? org, plugin.metadata?.slug ?? "");
          }}
        />
      )}

      <ConfirmDialog
        state={confirmState}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}
