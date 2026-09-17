"use client";

import { useCallback, useMemo, useReducer, useState } from "react";
import Link from "next/link";
import { Blocks, Copy, ExternalLink, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useLibraryNavigation } from "@/domain/library/library-navigation";
import {
  readPersistedScope,
  writePersistedScope,
} from "@/domain/library/scope-persistence";
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

const INSTALL_LINK_CLASSES =
  "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function PluginListPage() {
  const org = useActiveOrgSlug();
  const stigmer = useStigmer();
  const { navigateToDetail } = useLibraryNavigation();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();

  const [scope, setScope] = useState<"org" | "all">(() => readPersistedScope("plugins"));
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

  const handleScopeChange = useCallback((newScope: "org" | "all") => {
    setScope(newScope);
    writePersistedScope("plugins", newScope);
  }, []);

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
        scope={scope}
        onScopeChange={handleScopeChange}
        defaultViewMode="cards"
        viewModes={["table", "cards"]}
        viewModeStorageKey={VIEW_MODE_STORAGE_KEY}
        searchPlaceholder="Search plugins…"
        emptyIcon={<Blocks className="size-10" aria-hidden="true" />}
        emptyTitle="No plugins installed"
        emptyDescription="Install a plugin from a marketplace to add skills, MCP servers and an agent that uses them, as one unit."
        headerAction={
          <Link href="/library/plugins/install" className={`${INSTALL_LINK_CLASSES} text-sm`}>
            <Plus className="size-3.5" aria-hidden="true" />
            Install plugin
          </Link>
        }
        emptyAction={
          <Link href="/library/plugins/install" className={`${INSTALL_LINK_CLASSES} text-xs`}>
            <Plus className="size-3.5" aria-hidden="true" />
            Install plugin
          </Link>
        }
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
