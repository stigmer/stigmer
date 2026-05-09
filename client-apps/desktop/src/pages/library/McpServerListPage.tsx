import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Upload, Server } from "lucide-react";
import {
  ResourceWorkbench,
  McpServerConnectDialog,
  ImportResourceDialog,
  useStigmer,
  useActiveOrgSlug,
  type WorkbenchColumnDef,
} from "@stigmer/react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

const SCOPE_STORAGE_KEY = "stigmer:library:mcp-servers:scope";
const VIEW_MODE_STORAGE_KEY = "stigmer:workbench:mcp-servers:viewMode";

function readPersistedScope(): "org" | "all" {
  const stored = localStorage.getItem(SCOPE_STORAGE_KEY);
  return stored === "all" ? "all" : "org";
}

interface ConnectTarget {
  readonly org: string;
  readonly slug: string;
}

const MCP_COLUMNS: WorkbenchColumnDef<SearchResult>[] = [
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

export default function McpServerListPage() {
  const org = useActiveOrgSlug();
  const stigmer = useStigmer();
  const navigate = useNavigate();

  const [scope, setScope] = useState<"org" | "all">(readPersistedScope);
  const [connectTarget, setConnectTarget] = useState<ConnectTarget | null>(
    null,
  );
  const [importOpen, setImportOpen] = useState(false);

  const handleScopeChange = useCallback((newScope: "org" | "all") => {
    setScope(newScope);
    localStorage.setItem(SCOPE_STORAGE_KEY, newScope);
  }, []);

  const listFn = useMemo(
    () => (params: Parameters<typeof stigmer.mcpServer.list>[0]) =>
      stigmer.mcpServer.list(params),
    [stigmer],
  );

  const createUrl = "/library/mcp-servers/new";

  return (
    <>
      <div className="mb-6">
        <h1 className="text-foreground text-xl font-semibold">MCP Servers</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Browse and manage MCP servers in your organization.
        </p>
      </div>

      <ResourceWorkbench
        listFn={listFn}
        org={org}
        columns={MCP_COLUMNS}
        scope={scope}
        onScopeChange={handleScopeChange}
        defaultViewMode="cards"
        viewModes={["table", "cards"]}
        viewModeStorageKey={VIEW_MODE_STORAGE_KEY}
        searchPlaceholder="Search MCP servers…"
        emptyIcon={<Server className="size-10" aria-hidden="true" />}
        emptyTitle="No MCP servers yet"
        emptyDescription="Add an MCP server to connect external tools and data sources to your agents."
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
              Add MCP server
            </Link>
          </div>
        }
        emptyAction={
          <Link
            to={createUrl}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add MCP server
          </Link>
        }
        onItemClick={(item) =>
          navigate(`/library/mcp-servers/${item.org}/${item.slug}`)
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
        aria-label="MCP server workbench"
      />

      <McpServerConnectDialog
        org={connectTarget?.org ?? ""}
        slug={connectTarget?.slug ?? ""}
        activeOrg={org}
        open={connectTarget !== null}
        onClose={() => setConnectTarget(null)}
      />

      <ImportResourceDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        org={org ?? ""}
      />
    </>
  );
}
