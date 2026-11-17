"use client";

// The Library's Agents list: the organization's agents as rows, newest first
// until a search, with Apply YAML and Create agent in the header. Create
// agent shows only to someone the server lets create one (admins, and
// members while the organization lets members create agents). A row opens
// the agent; its acts copy its reference and, only on the server's yes for
// that agent, delete it after a confirmation in the agent page's words.

import { useCallback, useMemo, useState } from "react";
import { Bot, Plus, Upload } from "lucide-react";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";
import { createLibraryListFn, useStigmer } from "@stigmer/react-core";
import { IconButton } from "../button/IconButton.js";
import { LinkButton } from "../button/LinkButton.js";
import { ApplyManifestDialog } from "../manifest/ApplyManifestDialog.js";
import { ResourceWorkbench } from "../resource-workbench/components/ResourceWorkbench.js";
import { useActiveOrgId } from "../organization/OrgProvider.js";
import { useOrgSlugForId } from "../organization/useOrgRefs.js";
import { useCanCreateAgent } from "../agent/useCanCreateAgent.js";
import { useConfirmAction } from "../resource-detail/useConfirmAction.js";
import { ConfirmDialog } from "../resource-detail/ConfirmDialog.js";
import { AGENT_DELETE_DESCRIPTION } from "./agentDeleteDescription.js";
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

/** Props for {@link LibraryAgentsSection}. */
export interface LibraryAgentsSectionProps extends LibrarySectionNavigation {
  /** Where Create agent goes. @default "/library/agents/new" */
  readonly createHref?: string;
}

/**
 * The Library's Agents page: the active organization's agents as rows, with
 * Apply YAML and, for someone the server lets create one, Create agent.
 *
 * @example
 * ```tsx
 * <LibraryAgentsSection onOpen={({ kind, org, slug }) => window.location.assign(`/library/${kind}/${org}/${slug}`)} />
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
      const name = item.name || item.slug;
      // The dialog deletes: it waits while the server answers and says a refusal in place.
      const deleted = await confirm({
        title: `Delete ${name}?`,
        description: AGENT_DELETE_DESCRIPTION,
        confirmLabel: "Delete",
        variant: "destructive",
        action: async () => {
          await stigmer.agent.delete(item.id);
        },
        failureTitle: `Couldn't delete ${name}.`,
      });
      if (!deleted) return;
      toast.success(`${name} deleted`);
      refreshList();
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
      description="Each agent is a job you hand off: what it should do, the model it uses, and the skills and tools it can reach."
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
        defaultViewMode="list"
        viewModes={["list"]}
        itemsLabel="agents"
        searchPlaceholder="Search agents"
        emptyIcon={<Bot className="stg:size-10" aria-hidden="true" />}
        emptyTitle="No agents yet"
        emptyDescription={
          canCreateAgent
            ? "Create an agent to hand off a job: write what it should do, and it runs in its own sandbox."
            : `Admins of ${slugForOrg(org ?? "")} create agents here. Once one does, you can start a session with it.`
        }
        emptyAction={canCreateAgent ? createAgent : undefined}
        onItemClick={open}
        renderRow={(item) => (
          <LibraryRow
            icon={<Bot />}
            name={item.name || item.slug}
            tags={visibilityTag(item.visibility)}
            description={item.description}
            changedAt={item.updatedAt}
          />
        )}
        renderItemAction={(item) => (
          <LibraryRowActions
            resource={{ kind: "agent", id: item.id }}
            name={item.name || item.slug}
            onCopyId={() => copyReference(slugForOrg(item.org), item.slug, "agent")}
            onDelete={() => void handleDeleteItem(item)}
          />
        )}
        aria-label="Agent workbench"
      />

      <ApplyManifestDialog open={importOpen} onOpenChange={setImportOpen} org={org ?? ""} onApplied={refreshList} />

      <ConfirmDialog state={confirmState} onConfirm={handleConfirm} onCancel={handleCancel} />
    </LibrarySectionFrame>
  );
}
