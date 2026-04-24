import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Server } from "lucide-react";
import {
  useMcpServerList,
  ResourceListView,
} from "@stigmer/react";
import type { ResourceListScope } from "@stigmer/react";
import { useActiveOrgSlug } from "../../org/OrgProvider";

export default function McpServerListPage() {
  const org = useActiveOrgSlug();
  const navigate = useNavigate();

  const [scope, setScope] = useState<ResourceListScope>("org");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const { mcpServers, isLoading, error, totalCount, totalPages, refetch } =
    useMcpServerList(org || null, { scope, query, page });

  const handleScopeChange = (s: ResourceListScope) => {
    setScope(s);
    setPage(1);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <ResourceListView
        layout="grid"
        items={mcpServers}
        isLoading={isLoading}
        error={error}
        totalCount={totalCount}
        totalPages={totalPages}
        currentPage={page}
        onSearchChange={setQuery}
        searchPlaceholder="Search MCP servers…"
        scope={scope}
        onScopeChange={handleScopeChange}
        onPageChange={setPage}
        onItemClick={(item) =>
          navigate(`/library/mcp-servers/${item.org}/${item.slug}`)
        }
        emptyIcon={<Server className="size-10 text-muted-foreground" />}
        emptyTitle="No MCP servers found"
        onRetry={refetch}
        aria-label="MCP server list"
      />
    </div>
  );
}
