import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Database, Upload } from "lucide-react";
import {
  ResourceWorkbench,
  ApplyManifestDialog,
  useStigmer,
  useActiveOrgSlug,
  type WorkbenchColumnDef,
} from "@stigmer/react";
import type { SearchResult } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";
import {
  readPersistedScope,
  writePersistedScope,
} from "./scope-persistence";

const VIEW_MODE_STORAGE_KEY = "stigmer:workbench:datastores:viewMode";

const DATASTORE_COLUMNS: WorkbenchColumnDef<SearchResult>[] = [
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
    cell: (item) => <span className="text-muted-foreground">{item.org}</span>,
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

export default function DatastoreListPage() {
  const org = useActiveOrgSlug();
  const stigmer = useStigmer();
  const navigate = useNavigate();

  const [scope, setScope] = useState<"org" | "all">(() =>
    readPersistedScope("datastores"),
  );
  const [importOpen, setImportOpen] = useState(false);

  const handleScopeChange = useCallback((newScope: "org" | "all") => {
    setScope(newScope);
    writePersistedScope("datastores", newScope);
  }, []);

  const listFn = useMemo(
    () => (params: Parameters<typeof stigmer.datastore.list>[0]) =>
      stigmer.datastore.list(params),
    [stigmer],
  );

  // Datastores are declared in YAML and applied — there is no creation
  // wizard (DD-008: browse + record CRUD + Edit YAML + guarded delete).
  const applyYamlButton = (
    <button
      type="button"
      onClick={() => setImportOpen(true)}
      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Upload className="size-3.5" aria-hidden="true" />
      Apply YAML
    </button>
  );

  return (
    <>
      <div className="mb-6">
        <h1 className="text-foreground text-xl font-semibold">Datastores</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Browse and manage record datastores your agents read and write.
        </p>
      </div>

      <ResourceWorkbench
        listFn={listFn}
        org={org}
        columns={DATASTORE_COLUMNS}
        scope={scope}
        onScopeChange={handleScopeChange}
        defaultViewMode="cards"
        viewModes={["table", "cards"]}
        viewModeStorageKey={VIEW_MODE_STORAGE_KEY}
        searchPlaceholder="Search datastores…"
        emptyIcon={<Database className="size-10" aria-hidden="true" />}
        emptyTitle="No datastores yet"
        emptyDescription="Declare a datastore in YAML and apply it to give your agents durable, structured records."
        headerAction={applyYamlButton}
        emptyAction={applyYamlButton}
        onItemClick={(item) => navigate(`/library/datastores/${item.org}/${item.slug}`)}
        aria-label="Datastore workbench"
      />

      <ApplyManifestDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        org={org ?? ""}
      />
    </>
  );
}
