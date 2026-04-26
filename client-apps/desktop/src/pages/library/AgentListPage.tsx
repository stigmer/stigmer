import { useCallback, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bot, Plus } from "lucide-react";
import {
  useAgentList,
  useActiveOrgSlug,
  ResourceListView,
} from "@stigmer/react";
import type { ResourceListScope } from "@stigmer/react";

const SCOPE_STORAGE_KEY = "stigmer:library:agents:scope";

function readPersistedScope(): ResourceListScope {
  const stored = localStorage.getItem(SCOPE_STORAGE_KEY);
  return stored === "all" ? "all" : "org";
}

export default function AgentListPage() {
  const org = useActiveOrgSlug();
  const navigate = useNavigate();

  const [scope, setScope] = useState<ResourceListScope>(readPersistedScope);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const { agents, isLoading, error, totalCount, totalPages, refetch } =
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
          to="/?draft=agent"
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
        currentPage={page}
        onSearchChange={setQuery}
        searchPlaceholder="Search agents…"
        scope={scope}
        onScopeChange={handleScopeChange}
        onPageChange={setPage}
        onItemClick={(item) =>
          navigate(`/library/agents/${item.org}/${item.slug}`)
        }
        emptyIcon={<Bot className="size-10" aria-hidden="true" />}
        emptyTitle="No agents found"
        onRetry={refetch}
        aria-label="Agent list"
      />
    </>
  );
}
