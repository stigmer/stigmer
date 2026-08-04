import { useMemo, useReducer, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CalendarClock, Plus, Upload } from "lucide-react";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import {
  ResourceWorkbench,
  ApplyManifestDialog,
  ScheduleRowActions,
  createScheduleColumns,
  createScheduleListFn,
  useStigmer,
  useActiveOrgSlug,
} from "@stigmer/react";

export default function ScheduleListPage() {
  const org = useActiveOrgSlug();
  const stigmer = useStigmer();
  const navigate = useNavigate();

  const [importOpen, setImportOpen] = useState(false);
  // Bumped after Apply YAML or a row action (trigger/resume) so the list
  // refetches in place and status columns update without a reload.
  const [refetchToken, refreshList] = useReducer((n: number) => n + 1, 0);

  const listFn = useMemo(() => createScheduleListFn(stigmer), [stigmer]);
  const columns = useMemo(() => createScheduleColumns(), []);

  // Form-based creation is the primary path; Apply YAML stays as the
  // secondary, declarative/GitOps path.
  const newScheduleButton = (
    <Link
      to="/library/schedules/new"
      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Plus className="size-3.5" aria-hidden="true" />
      New schedule
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
      {newScheduleButton}
    </div>
  );

  return (
    <>
      <div className="mb-6">
        <h1 className="text-foreground text-xl font-semibold">Schedules</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Run agents on a cron cadence and see when each schedule fires next.
        </p>
      </div>

      {/*
        Schedules are the one Library kind listed via the direct query
        (full protos with live status), not the search service — hence
        searchable={false} (no server text search) and no Org/All scope
        toggle (schedules are never public/cross-org). Wired identically
        to the web Library (DD-016 parity).
      */}
      <ResourceWorkbench<Schedule>
        refetchToken={refetchToken}
        listFn={listFn}
        org={org}
        columns={columns}
        getItemId={(item) => item.metadata?.id ?? ""}
        searchable={false}
        defaultViewMode="table"
        viewModes={["table"]}
        renderItemAction={(item) => (
          <ScheduleRowActions schedule={item} onChanged={refreshList} />
        )}
        emptyIcon={<CalendarClock className="size-10" aria-hidden="true" />}
        emptyTitle="No schedules yet"
        emptyDescription="Create a schedule to run an agent on a cadence — daily, weekly, or any cron expression."
        headerAction={headerActions}
        emptyAction={newScheduleButton}
        onItemClick={(item) =>
          navigate(
            `/library/schedules/${item.metadata?.org ?? ""}/${item.metadata?.slug ?? ""}`,
          )
        }
        aria-label="Schedule workbench"
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
