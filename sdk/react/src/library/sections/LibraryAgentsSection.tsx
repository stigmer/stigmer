"use client";

// The Library's Agents list: the organization's agents, newest first until a
// search, with Apply YAML and Create agent in the header. Create agent shows
// only to someone the server lets create one (admins, and members while the
// organization lets members create agents). A row's menu opens the agent,
// copies its reference, or deletes it after a confirmation in the agent
// page's words.

import { useCallback, useMemo, useState } from "react";
import { Bot, Copy, ExternalLink, MoreHorizontal, Plus, Trash2, Upload } from "lucide-react";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";
import { createLibraryListFn, useStigmer } from "@stigmer/react-core";
import { IconButton } from "../../button/IconButton.js";
import { LinkButton } from "../../button/LinkButton.js";
import { ActionMenu } from "../../action-menu/ActionMenu.js";
import { ApplyManifestDialog } from "../../manifest/ApplyManifestDialog.js";
import { ResourceWorkbench } from "../../resource-workbench/components/ResourceWorkbench.js";
import { useActiveOrgId } from "../../organization/OrgProvider.js";
import { useOrgSlugForId } from "../../organization/useOrgRefs.js";
import { useCanCreateAgent } from "../../agent/useCanCreateAgent.js";
import { useConfirmAction } from "../../resource-detail/useConfirmAction.js";
import { ConfirmDialog } from "../../resource-detail/ConfirmDialog.js";
import { AGENT_DELETE_DESCRIPTION } from "./agentDeleteDescription.js";
import { toast } from "../../feedback/toast.js";
import { LIBRARY_HREFS, type LibrarySectionNavigation } from "./navigation.js";
import { LibrarySectionFrame, SEARCH_RESULT_COLUMNS, copyReference, useRefetchToken } from "./LibrarySectionFrame.js";

const VIEW_MODE_STORAGE_KEY = "stigmer:workbench:agents:viewMode";

/** Props for {@link LibraryAgentsSection}. */
export interface LibraryAgentsSectionProps extends LibrarySectionNavigation {
  /** Where Create agent goes. @default "/library/agents/new" */
  readonly createHref?: string;
}

/**
 * The Library's Agents page: the active organization's agents, with Apply
 * YAML and, for someone the server lets create one, Create agent.
 *
 * @example
 * ```tsx
 * <LibraryAgentsSection onOpen={({ kind, org, slug }) => navigate(`/library/${kind}/${org}/${slug}`)} />
 * ```
 */
export function LibraryAgentsSection({ onOpen, renderLink, createHref = LIBRARY_HREFS.newAgent }: LibraryAgentsSectionProps) {
  const org = useActiveOrgId();
  const { allowed: canCreateAgent } = useCanCreateAgent(org || null);
  const slugForOrg = useOrgSlugForId();
  const stigmer = useStigmer();
  const { confirmState, confirm, handleConfirm, handleCancel } = useConfirmAction();
  const [importOpen, setImportOpen] = useState(false);
  const [refetchToken, refreshList] = useRefetchToken();

  const open = useCallback((item: SearchResult) => onOpen({ kind: "agents", org: item.org, slug: item.slug }), [onOpen]);

  const handleDeleteItem = useCallback(
    async (item: SearchResult) => {
      const confirmed = await confirm({
        title: `Delete ${item.name || item.slug}?`,
        description: AGENT_DELETE_DESCRIPTION,
        confirmLabel: "Delete",
        variant: "destructive",
      });
      if (!confirmed) return;
      try {
        await stigmer.agent.delete(item.id);
        toast.success(`${item.name || item.slug} deleted`);
        refreshList();
      } catch {
        toast.error("Failed to delete agent");
      }
    },
    [confirm, stigmer, refreshList],
  );

  // The organization's agents, newest first, while the search box is
  // empty; search matches once it holds text.
  const listFn = useMemo(() => createLibraryListFn(stigmer, ApiResourceKind.agent), [stigmer]);

  const createAgent = (
    <LinkButton href={createHref} icon={<Plus className="stg:size-3.5" aria-hidden="true" />} renderLink={renderLink}>
      Create agent
    </LinkButton>
  );

  return (
    <LibrarySectionFrame
      title="Agents"
      description="Browse and manage agents in your organization."
      actions={
        <>
          <IconButton
            variant="outline"
            label="Apply YAML"
            icon={<Upload className="stg:size-3.5" aria-hidden="true" />}
            onClick={() => setImportOpen(true)}
          />
          {canCreateAgent && createAgent}
        </>
      }
    >
      <ResourceWorkbench
        refetchToken={refetchToken}
        listFn={listFn}
        org={org}
        columns={SEARCH_RESULT_COLUMNS}
        defaultViewMode="cards"
        viewModes={["table", "cards"]}
        viewModeStorageKey={VIEW_MODE_STORAGE_KEY}
        searchPlaceholder="Search agents…"
        emptyIcon={<Bot className="stg:size-10" aria-hidden="true" />}
        emptyTitle="No agents yet"
        emptyDescription="Create an agent to define instructions, tools, skills, and execution behavior."
        emptyAction={canCreateAgent ? createAgent : undefined}
        onItemClick={open}
        renderItemAction={(item) => (
          <div onClick={(e) => e.stopPropagation()}>
            <ActionMenu>
              <ActionMenu.Trigger aria-label={`Actions for ${item.name || item.slug}`}>
                <MoreHorizontal className="stg:size-4" />
              </ActionMenu.Trigger>
              <ActionMenu.Content>
                <ActionMenu.Item icon={<ExternalLink className="stg:size-4" />} onSelect={() => open(item)}>
                  View details
                </ActionMenu.Item>
                <ActionMenu.Item icon={<Copy className="stg:size-4" />} onSelect={() => copyReference(slugForOrg(item.org), item.slug, "agent")}>
                  Copy ID
                </ActionMenu.Item>
                <ActionMenu.Separator />
                <ActionMenu.Item icon={<Trash2 className="stg:size-4" />} variant="destructive" onSelect={() => void handleDeleteItem(item)}>
                  Delete
                </ActionMenu.Item>
              </ActionMenu.Content>
            </ActionMenu>
          </div>
        )}
        aria-label="Agent workbench"
      />

      <ApplyManifestDialog open={importOpen} onOpenChange={setImportOpen} org={org ?? ""} onApplied={refreshList} />

      <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
    </LibrarySectionFrame>
  );
}
