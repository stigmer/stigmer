import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot } from "lucide-react";
import {
  useAgentList,
  ResourceListView,
} from "@stigmer/react";
import type { ResourceListScope } from "@stigmer/react";
import { useActiveOrgSlug } from "../../org/OrgProvider";

export default function AgentListPage() {
  const org = useActiveOrgSlug();
  const navigate = useNavigate();

  const [scope, setScope] = useState<ResourceListScope>("org");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const { agents, isLoading, error, totalCount, totalPages, refetch } =
    useAgentList(org || null, { scope, query, page });

  const handleScopeChange = (s: ResourceListScope) => {
    setScope(s);
    setPage(1);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
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
        emptyIcon={<Bot className="size-10 text-muted-foreground" />}
        emptyTitle="No agents found"
        onRetry={refetch}
        aria-label="Agent list"
      />
    </div>
  );
}
