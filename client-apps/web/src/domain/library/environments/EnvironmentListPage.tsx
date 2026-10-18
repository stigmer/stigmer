"use client";

import { useMemo, useReducer, useState } from "react";
import Link from "next/link";
import { Box, Plus, Upload } from "lucide-react";
import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { useLibraryNavigation } from "@/domain/library/library-navigation";
import {
  ApplyManifestDialog,
  EnvironmentsNotOnServerNotice,
  ResourceWorkbench,
  createEnvironmentColumns,
  createEnvironmentListFn,
  useActiveOrgId,
  useCanCreateEnvironment,
  useStigmer,
} from "@stigmer/react-sdk";

/**
 * The organization's Environments: every one the person may view, with
 * its network and packages. Only an admin is offered "New environment"
 * and Apply YAML, and neither shows until the server has answered, so a
 * member never sees them flash.
 */
export function EnvironmentListPage() {
  const org = useActiveOrgId();
  const stigmer = useStigmer();
  const { navigateToDetail } = useLibraryNavigation();
  const { allowed: canCreate } = useCanCreateEnvironment(org || null);

  const [importOpen, setImportOpen] = useState(false);
  // Bumped after Apply YAML so the list refetches in place.
  const [refetchToken, refreshList] = useReducer((n: number) => n + 1, 0);

  const listFn = useMemo(() => createEnvironmentListFn(stigmer), [stigmer]);
  const columns = useMemo(() => createEnvironmentColumns(), []);

  const newEnvironmentButton = canCreate ? (
    <Link
      href="/library/environments/new"
      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Plus className="size-3.5" aria-hidden="true" />
      New environment
    </Link>
  ) : undefined;

  const headerActions = canCreate ? (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => setImportOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Upload className="size-3.5" aria-hidden="true" />
        Apply YAML
      </button>
      {newEnvironmentButton}
    </div>
  ) : undefined;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-foreground text-xl font-semibold">Environments</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Packages and network access for the sandboxes your agents run in.
        </p>
      </div>

      <EnvironmentsNotOnServerNotice className="mb-6" />

      {/* Environments are not in search: listed through the direct query,
          hence searchable={false}. */}
      <ResourceWorkbench<Environment>
        refetchToken={refetchToken}
        listFn={listFn}
        org={org}
        columns={columns}
        getItemId={(item) => item.metadata?.id ?? ""}
        searchable={false}
        defaultViewMode="table"
        viewModes={["table"]}
        emptyIcon={<Box className="size-10" aria-hidden="true" />}
        emptyTitle="No environments yet"
        emptyDescription="Create an environment to give your agents' sandboxes packages and a network policy."
        headerAction={headerActions}
        emptyAction={newEnvironmentButton}
        onItemClick={(item) =>
          navigateToDetail("environments", item.metadata?.org ?? "", item.metadata?.slug ?? "")
        }
        aria-label="Environment workbench"
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
