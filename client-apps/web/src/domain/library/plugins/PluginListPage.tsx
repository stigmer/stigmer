"use client";

import { useCallback, useMemo, useReducer } from "react";
import Link from "next/link";
import { Blocks, Copy, ExternalLink, MoreHorizontal, Store, Trash2, Upload } from "lucide-react";
import { useLibraryNavigation } from "@/domain/library/library-navigation";
import {
  ResourceWorkbench,
  ActionMenu,
  useStigmer,
  useActiveOrgSlug,
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
      <span className="text-muted-foreground">{item.org}</span>
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

/** The two ways in, side by side: the Marketplace (what you can get) and an upload from disk (what you have). */
function WaysIn({ size }: { readonly size: "sm" | "xs" }) {
  const text = size === "sm" ? "text-sm" : "text-xs";
  return (
    <div className="flex items-center gap-2">
      <Link href="/marketplace" className={`${PRIMARY_LINK_CLASSES} ${text}`}>
        <Store className="size-3.5" aria-hidden="true" />
        Browse Marketplace
      </Link>
      <Link href="/library/plugins/upload" className={`${SECONDARY_LINK_CLASSES} ${text}`}>
        <Upload className="size-3.5" aria-hidden="true" />
        Upload plugin
      </Link>
    </div>
  );
}

export function PluginListPage() {
  const org = useActiveOrgSlug();
  const stigmer = useStigmer();
  const { navigateToDetail } = useLibraryNavigation();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();

  // Bumped after a remove to refetch the list in place — no remount
  // flash, pagination and sort preserved.
  const [refetchToken, refreshList] = useReducer((n: number) => n + 1, 0);

  const handleRemoveItem = useCallback(
    async (item: SearchResult) => {
      const confirmed = await confirm({
        title: `Remove ${item.name || item.slug}?`,
        description:
          "Removes the plugin and every skill, MCP server and agent it installed. The server refuses if something outside the plugin still uses one of them.",
        confirmLabel: "Remove",
        variant: "destructive",
      });
      if (!confirmed) return;
      try {
        await stigmer.plugin.delete(item.id);
        toast.success(`${item.name || item.slug} removed`);
        refreshList();
      } catch (error) {
        // The server's refusal names what still references a member; show it as it is.
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
        emptyDescription="Install a plugin from the Marketplace, or upload one from your computer, to add skills, MCP servers and an agent that uses them, as one unit."
        headerAction={<WaysIn size="sm" />}
        emptyAction={<WaysIn size="xs" />}
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
                    navigator.clipboard.writeText(`${item.org}/${item.slug}`);
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

      <ConfirmDialog
        state={confirmState}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}
