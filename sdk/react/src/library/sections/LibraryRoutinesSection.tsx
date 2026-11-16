"use client";

// The Library's Routines list: the organization's routines with their live
// status, New routine (the form) and Apply YAML (the declarative path) in the
// header. Routines are listed through the direct query (full records with
// live status), not search, so the list has no search box.

import { useCallback, useMemo, useState } from "react";
import { CalendarClock, Plus, Upload } from "lucide-react";
import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";
import { useStigmer } from "@stigmer/react-core";
import { Button } from "../../button/Button.js";
import { LinkButton } from "../../button/LinkButton.js";
import { ApplyManifestDialog } from "../../manifest/ApplyManifestDialog.js";
import { ResourceWorkbench } from "../../resource-workbench/components/ResourceWorkbench.js";
import { RoutineRowActions } from "../../routine/RoutineRowActions.js";
import { createRoutineColumns } from "../../routine/routineColumns.js";
import { createRoutineListFn } from "../../routine/routineListFn.js";
import { useActiveOrgId } from "../../organization/OrgProvider.js";
import { LIBRARY_HREFS, type LibrarySectionNavigation } from "./navigation.js";
import { LibrarySectionFrame, useRefetchToken } from "./LibrarySectionFrame.js";

/** Props for {@link LibraryRoutinesSection}. */
export interface LibraryRoutinesSectionProps extends LibrarySectionNavigation {
  /** Where New routine goes. @default "/library/routines/new" */
  readonly createHref?: string;
}

/**
 * The Library's Routines page: the active organization's routines with
 * their status, New routine and Apply YAML.
 *
 * @example
 * ```tsx
 * <LibraryRoutinesSection onOpen={({ kind, org, slug }) => navigate(`/library/${kind}/${org}/${slug}`)} />
 * ```
 */
export function LibraryRoutinesSection({ onOpen, renderLink, createHref = LIBRARY_HREFS.newRoutine }: LibraryRoutinesSectionProps) {
  const org = useActiveOrgId();
  const stigmer = useStigmer();
  const [importOpen, setImportOpen] = useState(false);
  // Bumped after Apply YAML or a row action (trigger/resume) so the list
  // refetches in place and status columns update without a reload.
  const [refetchToken, refreshList] = useRefetchToken();

  const listFn = useMemo(() => createRoutineListFn(stigmer), [stigmer]);
  const columns = useMemo(() => createRoutineColumns(), []);
  const open = useCallback(
    (item: Routine) => onOpen({ kind: "routines", org: item.metadata?.org ?? "", slug: item.metadata?.slug ?? "" }),
    [onOpen],
  );

  // Form-based creation is the primary path; Apply YAML stays as the
  // secondary, declarative/GitOps path.
  const newRoutineButton = (
    <LinkButton href={createHref} icon={<Plus className="stg:size-3.5" aria-hidden="true" />} renderLink={renderLink}>
      New routine
    </LinkButton>
  );

  return (
    <LibrarySectionFrame
      title="Routines"
      description="Start an agent on a routine, by hand, or from another system."
      actions={
        <>
          <Button variant="ghost" icon={<Upload className="stg:size-3.5" aria-hidden="true" />} onClick={() => setImportOpen(true)}>
            Apply YAML
          </Button>
          {newRoutineButton}
        </>
      }
    >
      <ResourceWorkbench<Routine>
        refetchToken={refetchToken}
        listFn={listFn}
        org={org}
        columns={columns}
        getItemId={(item) => item.metadata?.id ?? ""}
        searchable={false}
        defaultViewMode="table"
        viewModes={["table"]}
        renderItemAction={(item) => <RoutineRowActions routine={item} onChanged={refreshList} />}
        emptyIcon={<CalendarClock className="stg:size-10" aria-hidden="true" />}
        emptyTitle="No routines yet"
        emptyDescription="Create a routine to start an agent on a routine, by hand, or from another system."
        emptyAction={newRoutineButton}
        onItemClick={open}
        aria-label="Routine workbench"
      />

      <ApplyManifestDialog open={importOpen} onOpenChange={setImportOpen} org={org ?? ""} onApplied={refreshList} />
    </LibrarySectionFrame>
  );
}
