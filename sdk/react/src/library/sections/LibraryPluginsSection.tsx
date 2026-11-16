"use client";

// The Library's Plugins list: what the organization has installed, with the
// three ways in beside it (the Marketplace, an upload from disk, and "Add MCP
// server", which installs a plugin of one server built in the browser). A
// host opens that form on arrival (the console's `?add=mcp-server`, how the
// Library's Add menu reaches it). A row's Remove is offered only to a person
// the server lets delete that plugin.

import { useCallback, useMemo, useState } from "react";
import { Blocks, Copy, ExternalLink, Server, Store, Trash2, Upload } from "lucide-react";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";
import { createLibraryListFn, useStigmer } from "@stigmer/react-core";
import { Button } from "../../button/Button.js";
import { LinkButton, type RenderLink } from "../../button/LinkButton.js";
import { AddMcpServerDialog } from "../../plugin/AddMcpServerDialog.js";
import { useCanCreatePlugin } from "../../plugin/useCanCreatePlugin.js";
import { ResourceActionBar } from "../../resource-detail/ResourceActionBar.js";
import { ResourceWorkbench } from "../../resource-workbench/components/ResourceWorkbench.js";
import { useActiveOrgId } from "../../organization/OrgProvider.js";
import { useOrgSlugForId } from "../../organization/useOrgRefs.js";
import { useConfirmAction } from "../../resource-detail/useConfirmAction.js";
import { ConfirmDialog } from "../../resource-detail/ConfirmDialog.js";
import { toast } from "../../feedback/toast.js";
import { LIBRARY_HREFS, type LibrarySectionNavigation } from "./navigation.js";
import { LibrarySectionFrame, SEARCH_RESULT_COLUMNS, copyReference, useRefetchToken } from "./LibrarySectionFrame.js";

const VIEW_MODE_STORAGE_KEY = "stigmer:workbench:plugins:viewMode";

/**
 * The ways in, side by side: the Marketplace (what you can get), an upload from disk (what you have), and one MCP server
 * by its address. Installing is an organization admin's act (`can_create_plugin`, asked fail closed), so a member is
 * offered the Marketplace to browse and no upload or server form the server would refuse.
 */
function WaysIn({
  mayInstall,
  onAddMcpServer,
  renderLink,
  uploadHref,
}: {
  readonly mayInstall: boolean;
  readonly onAddMcpServer: () => void;
  readonly renderLink?: RenderLink;
  readonly uploadHref: string;
}) {
  return (
    <div className="stg:flex stg:flex-wrap stg:items-center stg:gap-2">
      <LinkButton href={LIBRARY_HREFS.marketplace} icon={<Store className="stg:size-3.5" aria-hidden="true" />} renderLink={renderLink}>
        Browse Marketplace
      </LinkButton>
      {mayInstall && (
        <>
          <LinkButton href={uploadHref} variant="outline" icon={<Upload className="stg:size-3.5" aria-hidden="true" />} renderLink={renderLink}>
            Upload plugin
          </LinkButton>
          <Button variant="outline" icon={<Server className="stg:size-3.5" aria-hidden="true" />} onClick={onAddMcpServer}>
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

/** Props for {@link LibraryPluginsSection}. */
export interface LibraryPluginsSectionProps extends LibrarySectionNavigation {
  /** Where Upload plugin goes. @default "/library/plugins/upload" */
  readonly uploadHref?: string;
  /** Open the "Add MCP server" form on arrival (the Library's Add menu links here so). @default false */
  readonly addMcpServerOnArrival?: boolean;
}

/**
 * The Library's Plugins page: what the active organization has installed,
 * with the Marketplace, an upload and Add MCP server beside it.
 *
 * @example
 * ```tsx
 * <LibraryPluginsSection onOpen={({ kind, org, slug }) => navigate(`/library/${kind}/${org}/${slug}`)} />
 * ```
 */
export function LibraryPluginsSection({
  onOpen,
  renderLink,
  uploadHref = LIBRARY_HREFS.uploadPlugin,
  addMcpServerOnArrival = false,
}: LibraryPluginsSectionProps) {
  const org = useActiveOrgId();
  const mayInstall = useCanCreatePlugin(org || null).allowed;
  const slugForOrg = useOrgSlugForId();
  const stigmer = useStigmer();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const [addingServer, setAddingServer] = useState(addMcpServerOnArrival);
  const openAddServer = useCallback(() => setAddingServer(true), []);
  const [refetchToken, refreshList] = useRefetchToken();

  const open = useCallback((item: SearchResult) => onOpen({ kind: "plugins", org: item.org, slug: item.slug }), [onOpen]);

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
    [confirm, stigmer, refreshList],
  );

  // The organization's plugins, newest first, while the search box is
  // empty; search matches once it holds text.
  const listFn = useMemo(() => createLibraryListFn(stigmer, ApiResourceKind.plugin), [stigmer]);

  const waysIn = <WaysIn mayInstall={mayInstall} onAddMcpServer={openAddServer} renderLink={renderLink} uploadHref={uploadHref} />;

  return (
    <LibrarySectionFrame
      title="Plugins"
      description="What you have installed. A plugin is what you install; the agent it installs is what runs."
      actions={waysIn}
    >
      <ResourceWorkbench
        refetchToken={refetchToken}
        listFn={listFn}
        org={org}
        columns={SEARCH_RESULT_COLUMNS}
        defaultViewMode="cards"
        viewModes={["table", "cards"]}
        viewModeStorageKey={VIEW_MODE_STORAGE_KEY}
        searchPlaceholder="Search plugins…"
        emptyIcon={<Blocks className="stg:size-10" aria-hidden="true" />}
        emptyTitle="No plugins installed"
        emptyDescription={mayInstall ? EMPTY_FOR_ADMIN : EMPTY_FOR_MEMBER}
        emptyAction={waysIn}
        onItemClick={open}
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
                  icon: <ExternalLink className="stg:size-4" />,
                  group: "row",
                  onAction: () => open(item),
                },
                {
                  id: "copy-id",
                  label: "Copy ID",
                  icon: <Copy className="stg:size-4" />,
                  group: "row",
                  onAction: () => copyReference(slugForOrg(item.org), item.slug, "plugin"),
                },
                {
                  id: "remove",
                  label: "Remove",
                  icon: <Trash2 className="stg:size-4" />,
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
            onOpen({ kind: "plugins", org: plugin.metadata?.org ?? org, slug: plugin.metadata?.slug ?? "" });
          }}
        />
      )}

      <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
    </LibrarySectionFrame>
  );
}
