import { useMemo, useReducer, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarClock, Plus, Upload } from "lucide-react";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import {
  Button,
  LinkButton,
  ResourceWorkbench,
  ApplyManifestDialog,
  RoutineRowActions,
  createRoutineColumns,
  createRoutineListFn,
  useStigmer,
  useActiveOrgId,
  useOrgSlugForId,
  PageHeader,
} from "@stigmer/react-sdk";
import { renderJourneyLink } from "../../journey/journey-links";

export default function RoutineListPage() {
  const org = useActiveOrgId();
  const slugForOrg = useOrgSlugForId();
  const stigmer = useStigmer();
  const navigate = useNavigate();

  const [importOpen, setImportOpen] = useState(false);
  // Bumped after Apply YAML or a row action (trigger/resume) so the list
  // refetches in place and status columns update without a reload.
  const [refetchToken, refreshList] = useReducer((n: number) => n + 1, 0);

  const listFn = useMemo(() => createRoutineListFn(stigmer), [stigmer]);
  const columns = useMemo(() => createRoutineColumns(), []);

  // Form-based creation is the primary path; Apply YAML stays as the
  // secondary, declarative/GitOps path.
  const newRoutineButton = (
    <LinkButton href="/library/routines/new" icon={<Plus className="size-3.5" aria-hidden="true" />} renderLink={renderJourneyLink}>
      New routine
    </LinkButton>
  );

  const applyYamlButton = (
    <Button variant="ghost" icon={<Upload className="size-3.5" aria-hidden="true" />} onClick={() => setImportOpen(true)}>
      Apply YAML
    </Button>
  );

  const headerActions = (
    <>
      {applyYamlButton}
      {newRoutineButton}
    </>
  );

  return (
    <>
      <PageHeader
        className="mb-6"
        headingLevel={1}
        title="Routines"
        description="Start an agent on a routine, by hand, or from another system."
        actions={headerActions}
      />

      {/*
        Routines are the one Library kind listed via the direct query
        (full protos with live status), not the search service — hence
        searchable={false} (no server text search). Wired identically to
        the web Library.
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
        emptyAction={newRoutineButton}
        onItemClick={(item) =>
          navigate(
            `/library/routines/${slugForOrg(item.metadata?.org ?? "")}/${item.metadata?.slug ?? ""}`,
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
