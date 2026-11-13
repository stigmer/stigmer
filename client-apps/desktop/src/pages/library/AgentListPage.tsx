import { useCallback, useMemo, useReducer, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bot,
  Plus,
  Upload,
  MoreHorizontal,
  Copy,
  ExternalLink,
  Trash2,
} from "lucide-react";
import {
  IconButton,
  LinkButton,
  ResourceWorkbench,
  ActionMenu,
  ApplyManifestDialog,
  useStigmer,
  useActiveOrgId,
  useCanCreateAgent,
  OrgSlugText,
  useOrgSlugForId,
  useConfirmAction,
  ConfirmDialog,
  toast,
  type WorkbenchColumnDef,
  createLibraryListFn,
  PageHeader,
} from "@stigmer/react-sdk";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { SearchResult } from "@stigmer/apis/ai/stigmer/search/v1/io_pb";
import { AGENT_DELETE_DESCRIPTION } from "./agent-delete-confirmation";
import { renderJourneyLink } from "../../journey/journey-links";

const VIEW_MODE_STORAGE_KEY = "stigmer:workbench:agents:viewMode";

const AGENT_COLUMNS: WorkbenchColumnDef<SearchResult>[] = [
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

export default function AgentListPage() {
  const org = useActiveOrgId();
  // "Create agent" shows only to someone the server lets create one: admins,
  // and members while the organization lets members create agents.
  const { allowed: canCreateAgent } = useCanCreateAgent(org || null);
  const slugForOrg = useOrgSlugForId();
  const stigmer = useStigmer();
  const navigate = useNavigate();
  const { confirmState, confirm, handleConfirm, handleCancel } =
    useConfirmAction();

  const [importOpen, setImportOpen] = useState(false);
  // Bumped after an out-of-band mutation (apply YAML, delete) to refetch
  // the list in place — no remount flash, pagination and sort preserved.
  const [refetchToken, refreshList] = useReducer((n: number) => n + 1, 0);

  // The organization's agents, newest first, while the search box is
  // empty; search matches once it holds text.
  const listFn = useMemo(
    () => createLibraryListFn(stigmer, ApiResourceKind.agent),
    [stigmer],
  );

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
    [confirm, stigmer],
  );

  const createUrl = "/library/agents/new";

  return (
    <>
      <PageHeader
        className="mb-6"
        headingLevel={1}
        title="Agents"
        description="Browse and manage agents in your organization."
        actions={
          <>
            <IconButton
              variant="outline"
              label="Apply YAML"
              icon={<Upload className="size-3.5" aria-hidden="true" />}
              onClick={() => setImportOpen(true)}
            />
            {canCreateAgent && (
              <LinkButton href={createUrl} icon={<Plus className="size-3.5" aria-hidden="true" />} renderLink={renderJourneyLink}>
                Create agent
              </LinkButton>
            )}
          </>
        }
      />

      <ResourceWorkbench
        refetchToken={refetchToken}
        listFn={listFn}
        org={org}
        columns={AGENT_COLUMNS}
        defaultViewMode="cards"
        viewModes={["table", "cards"]}
        viewModeStorageKey={VIEW_MODE_STORAGE_KEY}
        searchPlaceholder="Search agents…"
        emptyIcon={<Bot className="size-10" aria-hidden="true" />}
        emptyTitle="No agents yet"
        emptyDescription="Create an agent to define instructions, tools, skills, and execution behavior."
        emptyAction={
          canCreateAgent ? (
            <LinkButton href={createUrl} icon={<Plus className="size-3.5" aria-hidden="true" />} renderLink={renderJourneyLink}>
              Create agent
            </LinkButton>
          ) : undefined
        }
        onItemClick={(item) =>
          navigate(`/library/agents/${slugForOrg(item.org)}/${item.slug}`)
        }
        renderItemAction={(item) => (
          <div onClick={(e) => e.stopPropagation()}>
            <ActionMenu>
              <ActionMenu.Trigger
                aria-label={`Actions for ${item.name || item.slug}`}
              >
                <MoreHorizontal className="size-4" />
              </ActionMenu.Trigger>
              <ActionMenu.Content>
                <ActionMenu.Item
                  icon={<ExternalLink className="size-4" />}
                  onSelect={() =>
                    navigate(`/library/agents/${slugForOrg(item.org)}/${item.slug}`)
                  }
                >
                  View details
                </ActionMenu.Item>
                <ActionMenu.Item
                  icon={<Copy className="size-4" />}
                  onSelect={() => {
                    navigator.clipboard.writeText(`${slugForOrg(item.org)}/${item.slug}`);
                    toast.success("Copied agent ID");
                  }}
                >
                  Copy ID
                </ActionMenu.Item>
                <ActionMenu.Separator />
                <ActionMenu.Item
                  icon={<Trash2 className="size-4" />}
                  variant="destructive"
                  onSelect={() => handleDeleteItem(item)}
                >
                  Delete
                </ActionMenu.Item>
              </ActionMenu.Content>
            </ActionMenu>
          </div>
        )}
        aria-label="Agent workbench"
      />

      <ApplyManifestDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        org={org ?? ""}
        onApplied={refreshList}
      />

      <ConfirmDialog
        state={confirmState}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}
