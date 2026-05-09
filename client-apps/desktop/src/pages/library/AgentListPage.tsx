import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  ResourceWorkbench,
  ActionMenu,
  ImportResourceDialog,
  useStigmer,
  useActiveOrgSlug,
  useConfirmAction,
  ConfirmDialog,
  toast,
  type WorkbenchColumnDef,
} from "@stigmer/react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

const SCOPE_STORAGE_KEY = "stigmer:library:agents:scope";
const VIEW_MODE_STORAGE_KEY = "stigmer:workbench:agents:viewMode";

function readPersistedScope(): "org" | "all" {
  const stored = localStorage.getItem(SCOPE_STORAGE_KEY);
  return stored === "all" ? "all" : "org";
}

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

export default function AgentListPage() {
  const org = useActiveOrgSlug();
  const stigmer = useStigmer();
  const navigate = useNavigate();
  const { confirmState, confirm, handleConfirm, handleCancel } =
    useConfirmAction();

  const [scope, setScope] = useState<"org" | "all">(readPersistedScope);
  const [importOpen, setImportOpen] = useState(false);
  const [listVersion, setListVersion] = useState(0);

  const handleScopeChange = useCallback((newScope: "org" | "all") => {
    setScope(newScope);
    localStorage.setItem(SCOPE_STORAGE_KEY, newScope);
  }, []);

  const listFn = useMemo(
    () => (params: Parameters<typeof stigmer.agent.list>[0]) =>
      stigmer.agent.list(params),
    [stigmer],
  );

  const handleDeleteItem = useCallback(
    async (item: SearchResult) => {
      const confirmed = await confirm({
        title: `Delete ${item.name || item.slug}?`,
        description:
          "This action cannot be undone. The agent and its configuration will be permanently removed.",
        confirmLabel: "Delete",
        variant: "destructive",
      });
      if (!confirmed) return;
      try {
        await stigmer.agent.delete(item.id);
        toast.success(`${item.name || item.slug} deleted`);
        setListVersion((v) => v + 1);
      } catch {
        toast.error("Failed to delete agent");
      }
    },
    [confirm, stigmer],
  );

  const createUrl = "/library/agents/new";

  return (
    <>
      <div className="mb-6">
        <h1 className="text-foreground text-xl font-semibold">Agents</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Browse and manage agents in your organization.
        </p>
      </div>

      <ResourceWorkbench
        key={listVersion}
        listFn={listFn}
        org={org}
        columns={AGENT_COLUMNS}
        scope={scope}
        onScopeChange={handleScopeChange}
        defaultViewMode="cards"
        viewModes={["table", "cards"]}
        viewModeStorageKey={VIEW_MODE_STORAGE_KEY}
        searchPlaceholder="Search agents…"
        emptyIcon={<Bot className="size-10" aria-hidden="true" />}
        emptyTitle="No agents yet"
        emptyDescription="Create an agent to define instructions, tools, skills, and execution behavior."
        headerAction={
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              aria-label="Import from file"
              className="inline-flex items-center justify-center rounded-md border border-input bg-background p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Upload className="size-3.5" aria-hidden="true" />
            </button>
            <Link
              to={createUrl}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-3.5" aria-hidden="true" />
              Create agent
            </Link>
          </div>
        }
        emptyAction={
          <Link
            to={createUrl}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Create agent
          </Link>
        }
        onItemClick={(item) =>
          navigate(`/library/agents/${item.org}/${item.slug}`)
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
                    navigate(`/library/agents/${item.org}/${item.slug}`)
                  }
                >
                  View details
                </ActionMenu.Item>
                <ActionMenu.Item
                  icon={<Copy className="size-4" />}
                  onSelect={() => {
                    navigator.clipboard.writeText(`${item.org}/${item.slug}`);
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

      <ImportResourceDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        org={org ?? ""}
      />

      <ConfirmDialog
        state={confirmState}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}
