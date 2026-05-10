import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Plus,
  Sparkles,
  MoreHorizontal,
  Copy,
  ExternalLink,
  Trash2,
} from "lucide-react";
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

const SCOPE_STORAGE_KEY = "stigmer:library:skills:scope";
const VIEW_MODE_STORAGE_KEY = "stigmer:workbench:skills:viewMode";

function readPersistedScope(): "org" | "all" {
  const stored = localStorage.getItem(SCOPE_STORAGE_KEY);
  return stored === "all" ? "all" : "org";
}

const SKILL_COLUMNS: WorkbenchColumnDef<SearchResult>[] = [
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

export default function SkillListPage() {
  const org = useActiveOrgSlug();
  const stigmer = useStigmer();
  const navigate = useNavigate();
  const { confirmState, confirm, handleConfirm, handleCancel } =
    useConfirmAction();

  const [scope, setScope] = useState<"org" | "all">(readPersistedScope);
  const [listVersion, setListVersion] = useState(0);

  const handleScopeChange = useCallback((newScope: "org" | "all") => {
    setScope(newScope);
    localStorage.setItem(SCOPE_STORAGE_KEY, newScope);
  }, []);

  const listFn = useMemo(
    () => (params: Parameters<typeof stigmer.skill.list>[0]) =>
      stigmer.skill.list(params),
    [stigmer],
  );

  const handleDeleteItem = useCallback(
    async (item: SearchResult) => {
      const confirmed = await confirm({
        title: `Delete ${item.name || item.slug}?`,
        description:
          "This action cannot be undone. The skill and its content will be permanently removed.",
        confirmLabel: "Delete",
        variant: "destructive",
      });
      if (!confirmed) return;
      try {
        await stigmer.skill.delete(item.id);
        toast.success(`${item.name || item.slug} deleted`);
        setListVersion((v) => v + 1);
      } catch {
        toast.error("Failed to delete skill");
      }
    },
    [confirm, stigmer],
  );

  return (
    <>
      <div className="mb-6">
        <h1 className="text-foreground text-xl font-semibold">Skills</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Browse and manage skills in your organization.
        </p>
      </div>

      <ResourceWorkbench
        key={listVersion}
        listFn={listFn}
        org={org}
        columns={SKILL_COLUMNS}
        scope={scope}
        onScopeChange={handleScopeChange}
        defaultViewMode="cards"
        viewModes={["table", "cards"]}
        viewModeStorageKey={VIEW_MODE_STORAGE_KEY}
        searchPlaceholder="Search skills…"
        emptyIcon={<Sparkles className="size-10" aria-hidden="true" />}
        emptyTitle="No skills yet"
        emptyDescription="Upload a skill package to provide reusable instructions and context for your agents."
        headerAction={
          <Link
            to="/library/skills/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Upload skill
          </Link>
        }
        emptyAction={
          <Link
            to="/library/skills/new"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Upload skill
          </Link>
        }
        onItemClick={(item) =>
          navigate(`/library/skills/${item.org}/${item.slug}`)
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
                    navigate(`/library/skills/${item.org}/${item.slug}`)
                  }
                >
                  View details
                </ActionMenu.Item>
                <ActionMenu.Item
                  icon={<Copy className="size-4" />}
                  onSelect={() => {
                    navigator.clipboard.writeText(`${item.org}/${item.slug}`);
                    toast.success("Copied skill ID");
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
        aria-label="Skill workbench"
      />

      <ConfirmDialog
        state={confirmState}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </>
  );
}
