"use client";

/**
 * The Library's Plugins list: what the organization has installed, with
 * the three ways in beside it (the Marketplace, an upload from disk, and
 * "Add MCP server", which installs a plugin of one server built in the
 * browser). `?add=mcp-server` opens that form on arrival, which is how the
 * Library's Add menu reaches it. A row's Remove is offered only to a
 * person the server lets delete that plugin.
 */

import { useCallback, useMemo, useReducer, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Blocks, Copy, ExternalLink, Server, Store, Trash2, Upload } from "lucide-react";
import { useLibraryNavigation } from "@/domain/library/library-navigation";
import { renderJourneyLink } from "@/domain/journey/journey-links";
import { ADD_MCP_SERVER, ADD_PARAM } from "@/domain/library/plugins/add-mcp-server";
import {
  Button,
  LinkButton,
  AddMcpServerDialog,
  ResourceWorkbench,
  useCanCreatePlugin,
  ResourceActionBar,
  useStigmer,
  useActiveOrgId,
  OrgSlugText,
  useOrgSlugForId,
  useConfirmAction,
  ConfirmDialog,
  toast,
  type WorkbenchColumnDef,
  createLibraryListFn,
} from "@stigmer/react-sdk";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";

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

/**
 * The ways in, side by side: the Marketplace (what you can get), an upload from disk (what you have), and one MCP server
 * by its address. Installing is an organization admin's act (`can_create_plugin`, asked fail closed), so a member is
 * offered the Marketplace to browse and no upload or server form the server would refuse.
 */
function WaysIn({
  mayInstall,
  onAddMcpServer,
}: {
  readonly mayInstall: boolean;
  readonly onAddMcpServer: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <LinkButton href="/marketplace" icon={<Store className="size-3.5" aria-hidden="true" />} renderLink={renderJourneyLink}>
        Browse Marketplace
      </LinkButton>
      {mayInstall && (
        <>
          <LinkButton
            href="/library/plugins/upload"
            variant="outline"
            icon={<Upload className="size-3.5" aria-hidden="true" />}
            renderLink={renderJourneyLink}
          >
            Upload plugin
          </LinkButton>
          <Button variant="outline" icon={<Server className="size-3.5" aria-hidden="true" />} onClick={onAddMcpServer}>
            Add MCP server
          </Button>
        </>
      )}
    </div>
  );
}

const EMPTY_FOR_ADMIN =
  "Install a plugin from the Marketplace, upload one from your computer, or add an MCP server: a chat or an agent that uses a plugin gets its skills, agents, hooks and MCP servers, as one unit.";
const EMPTY_FOR_MEMBER =
  "An admin of this organization installs plugins. Browse the Marketplace to see what is offered: a chat or an agent that uses a plugin gets its skills, agents, hooks and MCP servers, as one unit.";

export function PluginListPage() {
  const org = useActiveOrgId();
  const mayInstall = useCanCreatePlugin(org || null).allowed;
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

  // The organization's plugins, newest first, while the search box is
  // empty; search matches once it holds text.
  const listFn = useMemo(
    () => createLibraryListFn(stigmer, ApiResourceKind.plugin),
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
        emptyDescription={mayInstall ? EMPTY_FOR_ADMIN : EMPTY_FOR_MEMBER}
        headerAction={<WaysIn mayInstall={mayInstall} onAddMcpServer={openAddServer} />}
        emptyAction={<WaysIn mayInstall={mayInstall} onAddMcpServer={openAddServer} />}
        onItemClick={(item) => navigateToDetail("plugins", item.org, item.slug)}
        renderItemAction={(item) => (
          <div onClick={(e) => e.stopPropagation()}>
            {/* Remove is offered only on the server's yes for this row's plugin (one cached check per row). */}
            <ResourceActionBar
              resource={{ kind: "plugin", id: item.id }}
              menuLabel={`Actions for ${item.name || item.slug}`}
              actions={[
                {
                  id: "view",
                  label: "View details",
                  icon: <ExternalLink className="size-4" />,
                  group: "row",
                  onAction: () => navigateToDetail("plugins", item.org, item.slug),
                },
                {
                  id: "copy-id",
                  label: "Copy ID",
                  icon: <Copy className="size-4" />,
                  group: "row",
                  onAction: () => {
                    navigator.clipboard.writeText(`${slugForOrg(item.org)}/${item.slug}`);
                    toast.success("Copied plugin ID");
                  },
                },
                {
                  id: "remove",
                  label: "Remove",
                  icon: <Trash2 className="size-4" />,
                  variant: "destructive",
                  group: "danger",
                  requires: "can_delete",
                  onAction: () => void handleRemoveItem(item),
                },
              ]}
            />
          </div>
        )}
        aria-label="Plugin workbench"
      />

      {org && mayInstall && (
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
