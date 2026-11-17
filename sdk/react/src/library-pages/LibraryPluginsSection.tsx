"use client";

// The Library's Plugins list: what the organization has installed, with the
// three ways in beside it (the Marketplace, an upload from disk, and "Add MCP
// server", which installs a plugin of one server built in the browser). A
// host opens that form on arrival (the console's `?add=mcp-server`, how the
// Library's Add menu reaches it). A row's Remove is offered only to a person
// the server lets delete that plugin.

import { useCallback, useMemo, useState } from "react";
import { Blocks, Server, Store, Upload } from "lucide-react";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";
import { createLibraryListFn, useStigmer } from "@stigmer/react-core";
import { Button } from "../button/Button.js";
import { LinkButton, type RenderLink } from "../button/LinkButton.js";
import { AddMcpServerDialog } from "../plugin/AddMcpServerDialog.js";
import { useCanCreatePlugin } from "../plugin/useCanCreatePlugin.js";
import { ResourceWorkbench } from "../resource-workbench/components/ResourceWorkbench.js";
import { useActiveOrgId } from "../organization/OrgProvider.js";
import { useOrgSlugForId } from "../organization/useOrgRefs.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { toast } from "../feedback/toast.js";
import { LIBRARY_HREFS, type LibrarySectionNavigation } from "./navigation.js";
import {
  LibraryRow,
  LibraryRowActions,
  LibrarySectionFrame,
  SEARCH_RESULT_COLUMNS,
  copyReference,
  useRefetchToken,
  visibilityTag,
} from "./LibrarySectionFrame.js";

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
      {mayInstall && (
        <>
          <Button variant="outline" icon={<Server className="stg:size-3.5" aria-hidden="true" />} onClick={onAddMcpServer}>
            Add MCP server
          </Button>
          <LinkButton href={uploadHref} variant="outline" icon={<Upload className="stg:size-3.5" aria-hidden="true" />} renderLink={renderLink}>
            Upload plugin
          </LinkButton>
        </>
      )}
      <LinkButton
        href={LIBRARY_HREFS.marketplace}
        icon={<Store className="stg:size-3.5" aria-hidden="true" />}
        renderLink={renderLink}
      >
        Browse Marketplace
      </LinkButton>
    </div>
  );
}

const EMPTY_FOR_ADMIN =
  "Install a plugin from the Marketplace, upload one from your computer, or add an MCP server. An agent that uses a plugin gets everything in it.";

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
 * <LibraryPluginsSection onOpen={({ kind, org, slug }) => window.location.assign(`/library/${kind}/${org}/${slug}`)} />
 * ```
 */
export function LibraryPluginsSection({
  onOpen,
  renderLink,
  uploadHref = LIBRARY_HREFS.uploadPlugin,
  addMcpServerOnArrival = false,
}: LibraryPluginsSectionProps) {
  const org = useActiveOrgId();
  const { allowed: mayInstall, isLoading: checkingInstall } = useCanCreatePlugin(org || null);
  const slugForOrg = useOrgSlugForId();
  const stigmer = useStigmer();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const [addingServer, setAddingServer] = useState(addMcpServerOnArrival);
  const openAddServer = useCallback(() => setAddingServer(true), []);
  const [refetchToken, refreshList] = useRefetchToken();

  const open = useCallback((item: SearchResult) => onOpen({ kind: "plugins", org: item.org, slug: item.slug }), [onOpen]);

  const handleRemoveItem = useCallback(
    async (item: SearchResult) => {
      const name = item.name || item.slug;
      // The dialog removes: it waits while the server answers, and its
      // refusal (naming the agent that still uses the plugin) is said in place.
      const removed = await confirm({
        title: `Remove ${name}?`,
        description:
          "Removes the plugin and its versions. The server refuses while an agent of the organization uses it; a conversation that uses it fails its next message.",
        confirmLabel: "Remove",
        variant: "destructive",
        action: async () => {
          await stigmer.plugin.delete(item.id);
        },
        failureTitle: `Couldn't remove ${name}.`,
      });
      if (!removed) return;
      toast.success(`${name} removed`);
      refreshList();
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
      description="What you have installed. A plugin brings skills, agents, hooks and MCP servers as one unit; the agent it installs is what runs."
      actions={waysIn}
    >
      <ResourceWorkbench
        refetchToken={refetchToken}
        listFn={listFn}
        org={org}
        columns={SEARCH_RESULT_COLUMNS}
        defaultViewMode="list"
        viewModes={["list"]}
        itemsLabel="plugins"
        searchPlaceholder="Search plugins"
        emptyIcon={<Blocks className="stg:size-10" aria-hidden="true" />}
        emptyTitle="No plugins installed"
        emptyDescription={
          // The member's words only once the server has said no.
          mayInstall || checkingInstall
            ? EMPTY_FOR_ADMIN
            : `Admins of ${slugForOrg(org ?? "")} install plugins. Browse the Marketplace to see what's offered.`
        }
        emptyAction={
          <>
            <LinkButton
              href={LIBRARY_HREFS.marketplace}
              variant={mayInstall ? "primary" : "outline"}
              icon={<Store className="stg:size-3.5" aria-hidden="true" />}
              renderLink={renderLink}
            >
              Browse Marketplace
            </LinkButton>
            {mayInstall && (
              <LinkButton href={uploadHref} variant="outline" icon={<Upload className="stg:size-3.5" aria-hidden="true" />} renderLink={renderLink}>
                Upload plugin
              </LinkButton>
            )}
          </>
        }
        onItemClick={open}
        renderRow={(item) => (
          <LibraryRow
            icon={<Blocks />}
            name={item.name || item.slug}
            tags={visibilityTag(item.visibility)}
            description={item.description}
            changedAt={item.updatedAt}
          />
        )}
        renderItemAction={(item) => (
          // Remove is offered only on the server's yes for this row's plugin (one cached check per row).
          <LibraryRowActions
            resource={{ kind: "plugin", id: item.id }}
            name={item.name || item.slug}
            onCopyId={() => copyReference(slugForOrg(item.org), item.slug, "plugin")}
            onDelete={() => void handleRemoveItem(item)}
            deleteLabel="Remove"
          />
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
