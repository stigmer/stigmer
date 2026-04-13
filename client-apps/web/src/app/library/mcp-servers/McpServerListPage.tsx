"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Plus, Server } from "lucide-react";
import { getDraftSessionUrl } from "@/utils/draft-session";
import { useLibraryNavigation } from "@/contexts/library-navigation";
import {
  useMcpServerList,
  ResourceListView,
  McpServerConnectDialog,
  type ResourceListScope,
} from "@stigmer/react";
import { useActiveOrgSlug } from "@/contexts/org-context";

const SCOPE_STORAGE_KEY = "stigmer:library:mcp-servers:scope";

function readPersistedScope(): ResourceListScope {
  if (typeof window === "undefined") return "org";
  const stored = localStorage.getItem(SCOPE_STORAGE_KEY);
  return stored === "all" ? "all" : "org";
}

interface ConnectTarget {
  readonly org: string;
  readonly slug: string;
}

export function McpServerListPage() {
  const org = useActiveOrgSlug();
  const { navigateToDetail } = useLibraryNavigation();

  const [scope, setScope] = useState<ResourceListScope>(readPersistedScope);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [connectTarget, setConnectTarget] = useState<ConnectTarget | null>(null);

  const { mcpServers, totalCount, totalPages, currentPage, isLoading, error, refetch } =
    useMcpServerList(org || null, { scope, query, page });

  const handleScopeChange = useCallback((newScope: ResourceListScope) => {
    setScope(newScope);
    localStorage.setItem(SCOPE_STORAGE_KEY, newScope);
  }, []);

  return (
    <>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-foreground text-xl font-semibold">MCP Servers</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Browse and manage MCP servers in your organization.
          </p>
        </div>
        <Link
          href={getDraftSessionUrl("mcp-server")}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add MCP Server
        </Link>
      </div>

      <ResourceListView
        layout="grid"
        items={mcpServers}
        isLoading={isLoading}
        error={error}
        totalCount={totalCount}
        totalPages={totalPages}
        currentPage={currentPage}
        onSearchChange={setQuery}
        searchPlaceholder="Search MCP servers…"
        scope={scope}
        onScopeChange={handleScopeChange}
        onPageChange={setPage}
        onItemClick={(item) =>
          navigateToDetail("mcp-servers", item.org, item.slug)
        }
        renderItemAction={(item) => (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setConnectTarget({ org: item.org, slug: item.slug });
            }}
            aria-label={`Connect ${item.name || item.slug}`}
            className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        )}
        emptyIcon={<Server className="size-10" aria-hidden="true" />}
        emptyTitle="No MCP servers found"
        onRetry={refetch}
        aria-label="MCP server list"
      />

      <McpServerConnectDialog
        org={connectTarget?.org ?? ""}
        slug={connectTarget?.slug ?? ""}
        activeOrg={org}
        open={connectTarget !== null}
        onClose={() => setConnectTarget(null)}
      />
    </>
  );
}
