"use client";

// The Library's Environments list: every environment the person may view,
// with its network and packages. Only an admin is offered New environment
// and Apply YAML, and neither shows until the server has answered, so a
// member never sees them flash. Environments are not in search: listed
// through the direct query, so the list has no search box.

import { useCallback, useMemo, useState } from "react";
import { Box, Plus, Upload } from "lucide-react";
import type { Environment } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/api_pb";
import { useStigmer } from "@stigmer/react-core";
import { LinkButton } from "../button/LinkButton.js";
import { ApplyManifestDialog } from "../manifest/ApplyManifestDialog.js";
import { ResourceWorkbench } from "../resource-workbench/components/ResourceWorkbench.js";
import { EnvironmentsNotOnServerNotice } from "../environment/EnvironmentsNotOnServerNotice.js";
import { createEnvironmentColumns, describePackagesShort } from "../environment/environmentColumns.js";
import { NetworkingType } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/spec_pb";
import { useOrgSlugForId } from "../organization/useOrgRefs.js";
import { IconButton } from "../button/IconButton.js";
import { createEnvironmentListFn } from "../environment/environmentListFn.js";
import { useCanCreateEnvironment } from "../environment/useCanCreateEnvironment.js";
import { useActiveOrgId } from "../organization/OrgProvider.js";
import { LIBRARY_HREFS, type LibrarySectionNavigation } from "./navigation.js";
import { LibraryRow, LibraryRowActions, LibrarySectionFrame, copyReference, useRefetchToken, visibilityTag } from "./LibrarySectionFrame.js";

/** What an Environment's sandbox may reach, as its row's tag: the form's own words. */
function networkTag(environment: Environment): string {
  return environment.spec?.networking?.type === NetworkingType.limited ? "Listed websites" : "Any website";
}

/** Props for {@link LibraryEnvironmentsSection}. */
export interface LibraryEnvironmentsSectionProps extends LibrarySectionNavigation {
  /** Where New environment goes. @default "/library/environments/new" */
  readonly createHref?: string;
}

/**
 * The Library's Environments page: the active organization's environments,
 * with New environment and Apply YAML for an admin.
 *
 * @example
 * ```tsx
 * <LibraryEnvironmentsSection onOpen={({ kind, org, slug }) => window.location.assign(`/library/${kind}/${org}/${slug}`)} />
 * ```
 */
export function LibraryEnvironmentsSection({
  onOpen,
  renderLink,
  createHref = LIBRARY_HREFS.newEnvironment,
}: LibraryEnvironmentsSectionProps) {
  const org = useActiveOrgId();
  const stigmer = useStigmer();
  const { allowed: canCreate } = useCanCreateEnvironment(org || null);
  const [importOpen, setImportOpen] = useState(false);
  // Bumped after Apply YAML so the list refetches in place.
  const [refetchToken, refreshList] = useRefetchToken();

  const listFn = useMemo(() => createEnvironmentListFn(stigmer), [stigmer]);
  const columns = useMemo(() => createEnvironmentColumns(), []);
  const slugForOrg = useOrgSlugForId();
  const open = useCallback(
    (item: Environment) => onOpen({ kind: "environments", org: item.metadata?.org ?? "", slug: item.metadata?.slug ?? "" }),
    [onOpen],
  );

  const newEnvironmentButton = canCreate ? (
    <LinkButton href={createHref} icon={<Plus className="stg:size-3.5" aria-hidden="true" />} renderLink={renderLink}>
      New environment
    </LinkButton>
  ) : undefined;

  const headerActions = canCreate ? (
    <>
      <IconButton
        variant="outline"
        label="Apply YAML"
        icon={<Upload className="stg:size-3.5" aria-hidden="true" />}
        onClick={() => setImportOpen(true)}
      />
      {newEnvironmentButton}
    </>
  ) : undefined;

  return (
    <LibrarySectionFrame
      title="Environments"
      description="The packages and network access your agents' sandboxes get."
      actions={headerActions}
    >
      <EnvironmentsNotOnServerNotice className="stg:mb-6" />

      <ResourceWorkbench<Environment>
        refetchToken={refetchToken}
        listFn={listFn}
        org={org}
        columns={columns}
        getItemId={(item) => item.metadata?.id ?? ""}
        searchable={false}
        defaultViewMode="list"
        viewModes={["list"]}
        itemsLabel="environments"
        renderRow={(item) => (
          <LibraryRow
            icon={<Box />}
            name={item.metadata?.name || item.metadata?.slug || ""}
            tags={[networkTag(item), ...visibilityTag(item.metadata?.visibility)]}
            description={item.spec?.description || describePackagesShort(item)}
          />
        )}
        renderItemAction={(item) => (
          <LibraryRowActions
            resource={{ kind: "environment", id: item.metadata?.id ?? "" }}
            name={item.metadata?.name || item.metadata?.slug || ""}
            onCopyId={() => copyReference(slugForOrg(item.metadata?.org ?? ""), item.metadata?.slug ?? "", "environment")}
          />
        )}
        emptyIcon={<Box className="stg:size-10" aria-hidden="true" />}
        emptyTitle="No environments yet"
        emptyDescription={
          canCreate
            ? "Create an environment to give your agents' sandboxes packages and a network policy."
            : `Admins of ${slugForOrg(org ?? "")} set up environments. Until one does, sandboxes get the server's standard packages and network.`
        }
        emptyAction={newEnvironmentButton}
        onItemClick={open}
        aria-label="Environment workbench"
      />

      <ApplyManifestDialog open={importOpen} onOpenChange={setImportOpen} org={org ?? ""} onApplied={refreshList} />
    </LibrarySectionFrame>
  );
}
