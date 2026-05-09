"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Bot, Plus, MoreHorizontal, Copy, ExternalLink, Trash2 } from "lucide-react";
import { getDraftSessionUrl } from "@/domain/session/draft-session";
import { useLibraryNavigation } from "@/domain/library/library-navigation";
import {
  useAgentList,
  ResourceListView,
  ActionMenu,
  useActiveOrgSlug,
  toast,
  type ResourceListScope,
} from "@stigmer/react";

const SCOPE_STORAGE_KEY = "stigmer:library:agents:scope";

function readPersistedScope(): ResourceListScope {
  if (typeof window === "undefined") return "org";
  const stored = localStorage.getItem(SCOPE_STORAGE_KEY);
  return stored === "all" ? "all" : "org";
}

export function AgentListPage() {
  const org = useActiveOrgSlug();
  const { navigateToDetail } = useLibraryNavigation();

  const [scope, setScope] = useState<ResourceListScope>(readPersistedScope);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const { agents, totalCount, totalPages, currentPage, isLoading, error, refetch } =
    useAgentList(org || null, { scope, query, page });

  const handleScopeChange = useCallback((newScope: ResourceListScope) => {
    setScope(newScope);
    localStorage.setItem(SCOPE_STORAGE_KEY, newScope);
  }, []);

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-xl font-semibold">Agents</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Browse and manage agents in your organization.
          </p>
        </div>
        <Link
          href={getDraftSessionUrl("agent")}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add Agent
        </Link>
      </div>

      <ResourceListView
        layout="grid"
        items={agents}
        isLoading={isLoading}
        error={error}
        totalCount={totalCount}
        totalPages={totalPages}
        currentPage={currentPage}
        onSearchChange={setQuery}
        searchPlaceholder="Search agents…"
        scope={scope}
        onScopeChange={handleScopeChange}
        onPageChange={setPage}
        emptyIcon={<Bot className="size-10" aria-hidden="true" />}
        emptyTitle="No agents yet"
        emptyDescription="Create an agent to define instructions, tools, skills, and execution behavior."
        onItemClick={(item) => navigateToDetail("agents", item.org, item.slug)}
        renderItemAction={(item) => (
          <div onClick={(e) => e.stopPropagation()}>
            <ActionMenu>
              <ActionMenu.Trigger aria-label={`Actions for ${item.name || item.slug}`}>
                <MoreHorizontal className="size-4" />
              </ActionMenu.Trigger>
              <ActionMenu.Content>
                <ActionMenu.Item
                  icon={<ExternalLink className="size-4" />}
                  onSelect={() => navigateToDetail("agents", item.org, item.slug)}
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
                  onSelect={() => {
                    /* TODO: wire to delete flow in Phase 2 */
                  }}
                >
                  Delete
                </ActionMenu.Item>
              </ActionMenu.Content>
            </ActionMenu>
          </div>
        )}
        onRetry={refetch}
        aria-label="Agent list"
      />
    </>
  );
}
