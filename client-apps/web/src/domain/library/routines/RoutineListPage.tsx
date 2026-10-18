"use client";

import { useMemo, useReducer, useState } from "react";
import Link from "next/link";
import { CalendarClock, Plus, Upload } from "lucide-react";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { useLibraryNavigation } from "@/domain/library/library-navigation";
import {
  ResourceWorkbench,
  ApplyManifestDialog,
  RoutineRowActions,
  createRoutineColumns,
  createRoutineListFn,
  useStigmer,
  useActiveOrgId,
} from "@stigmer/react-sdk";

export function RoutineListPage() {
  const org = useActiveOrgId();
  const stigmer = useStigmer();
  const { navigateToDetail } = useLibraryNavigation();

  const [importOpen, setImportOpen] = useState(false);
  // Bumped after Apply YAML or a row action (trigger/resume) so the list
  // refetches in place and status columns update without a reload.
  const [refetchToken, refreshList] = useReducer((n: number) => n + 1, 0);

  const listFn = useMemo(() => createRoutineListFn(stigmer), [stigmer]);
  const columns = useMemo(() => createRoutineColumns(), []);

  // Form-based creation is the primary path; Apply YAML stays as the
  // secondary, declarative/GitOps path.
  const newRoutineButton = (
    <Link
      href="/library/routines/new"
      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Plus className="size-3.5" aria-hidden="true" />
      New routine
    </Link>
  );

  const applyYamlButton = (
    <button
      type="button"
      onClick={() => setImportOpen(true)}
      className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Upload className="size-3.5" aria-hidden="true" />
      Apply YAML
    </button>
  );

  const headerActions = (
    <div className="flex items-center gap-2">
      {applyYamlButton}
      {newRoutineButton}
    </div>
  );

  return (
    <>
      <div className="mb-6">
        <h1 className="text-foreground text-xl font-semibold">Routines</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Start an agent on a routine, by hand, or from another system.
        </p>
      </div>

      {/*
        Routines are the one Library kind listed via the direct query
        (full protos with live status), not the search service — hence
        searchable={false} (no server text search).
      */}
      <ResourceWorkbench<Routine>
        refetchToken={refetchToken}
        listFn={listFn}
        org={org}
        columns={columns}
        getItemId={(item) => item.metadata?.id ?? ""}
        searchable={false}
        defaultViewMode="table"
        viewModes={["table"]}
        renderItemAction={(item) => (
          <RoutineRowActions routine={item} onChanged={refreshList} />
        )}
        emptyIcon={<CalendarClock className="size-10" aria-hidden="true" />}
        emptyTitle="No routines yet"
        emptyDescription="Create a routine to start an agent on a routine, by hand, or from another system."
        headerAction={headerActions}
        emptyAction={newRoutineButton}
        onItemClick={(item) =>
          navigateToDetail(
            "routines",
            item.metadata?.org ?? "",
            item.metadata?.slug ?? "",
          )
        }
        aria-label="Routine workbench"
      />

      <ApplyManifestDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        org={org ?? ""}
        onApplied={refreshList}
      />
    </>
  );
}
