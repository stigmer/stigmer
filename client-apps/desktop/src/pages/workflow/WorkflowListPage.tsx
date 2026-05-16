import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { GitBranch, MoreHorizontal, Copy, ExternalLink, Trash2, Sparkles, Plus } from "lucide-react";
import {
  readPersistedScope,
  writePersistedScope,
} from "./scope-persistence";
import {
  ResourceWorkbench,
  ActionMenu,
  useStigmer,
  useActiveOrgSlug,
  useConfirmAction,
  ConfirmDialog,
  WorkflowArchitectDialog,
  toast,
  type WorkbenchColumnDef,
} from "@stigmer/react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

const VIEW_MODE_STORAGE_KEY = "stigmer:workbench:workflows:viewMode";

const WORKFLOW_COLUMNS: WorkbenchColumnDef<SearchResult>[] = [
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

export default function WorkflowListPage() {
  const org = useActiveOrgSlug();
  const stigmer = useStigmer();
  const navigate = useNavigate();
  const { confirmState, confirm, handleConfirm, handleCancel } =
    useConfirmAction();

  const [showGenerateDialog, setShowGenerateDialog] = useState(false);
  const [scope, setScope] = useState<"org" | "all">(() =>
    readPersistedScope(),
  );
  const [listVersion, setListVersion] = useState(0);

  const handleDeleteItem = useCallback(
    async (item: SearchResult) => {
      const confirmed = await confirm({
        title: `Delete ${item.name || item.slug}?`,
        description:
          "This action cannot be undone. The workflow and its configuration will be permanently removed.",
        confirmLabel: "Delete",
        variant: "destructive",
      });
      if (!confirmed) return;
      try {
        await stigmer.workflow.delete(item.id);
        toast.success(`${item.name || item.slug} deleted`);
        setListVersion((v) => v + 1);
      } catch {
        toast.error("Failed to delete workflow");
      }
    },
    [confirm, stigmer],
  );

  const handleScopeChange = useCallback((newScope: "org" | "all") => {
    setScope(newScope);
    writePersistedScope(newScope);
  }, []);

  const listFn = useMemo(
    () => (params: Parameters<typeof stigmer.workflow.list>[0]) =>
      stigmer.workflow.list(params),
    [stigmer],
  );

  return (
    <>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Workflows</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Browse and manage multi-step orchestration workflows.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/library/workflows/new"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-4" aria-hidden="true" />
            New
          </Link>
          <button
            type="button"
            onClick={() => setShowGenerateDialog(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Sparkles className="size-4" aria-hidden="true" />
            Generate
          </button>
        </div>
      </div>

      <ResourceWorkbench
        key={listVersion}
        listFn={listFn}
        org={org}
        columns={WORKFLOW_COLUMNS}
        scope={scope}
        onScopeChange={handleScopeChange}
        defaultViewMode="table"
        viewModes={["table", "cards"]}
        viewModeStorageKey={VIEW_MODE_STORAGE_KEY}
        searchPlaceholder="Search workflows…"
        emptyIcon={<GitBranch className="size-10" aria-hidden="true" />}
        emptyTitle="No workflows yet"
        emptyDescription="Workflows define multi-step orchestration for agents. Use the New button to create one in the visual editor, or Generate with AI."
        onItemClick={(item) =>
          navigate(`/library/workflows/${item.org}/${item.slug}`)
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
                    navigate(`/library/workflows/${item.org}/${item.slug}`)
                  }
                >
                  View details
                </ActionMenu.Item>
                <ActionMenu.Item
                  icon={<Copy className="size-4" />}
                  onSelect={() => {
                    navigator.clipboard.writeText(`${item.org}/${item.slug}`);
                    toast.success("Copied workflow reference");
                  }}
                >
                  Copy reference
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
        aria-label="Workflow workbench"
      />

      <ConfirmDialog
        state={confirmState}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />

      <WorkflowArchitectDialog
        open={showGenerateDialog}
        onOpenChange={setShowGenerateDialog}
        org={org}
        onSuccess={(genOrg, slug) => {
          setListVersion((v) => v + 1);
          navigate(`/library/workflows/${genOrg}/${slug}`);
        }}
        onError={(message) => toast.error(message)}
      />
    </>
  );
}
