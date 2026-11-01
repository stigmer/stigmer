"use client";

/**
 * Settings section listing everything the platform remembers about the
 * caller in the active organization.
 *
 * The helper copy carries the memory transparency statement: a
 * confirmed memory is injected into the caller's future sessions and
 * appears in those executions' records. Memory content everywhere else
 * is subject-only — this page shows the caller their own records and
 * nobody else's.
 */
import { MemoryListPanel } from "../memory/MemoryListPanel.js";
import { useActiveOrgId } from "../organization/OrgProvider.js";
import { NoOrganization } from "./NoOrganization.js";
import { SettingsPage } from "./SettingsPage.js";

/** Settings section for the caller's own memories in the active organization. */
export function MemorySection() {
  const org = useActiveOrgId();

  return (
    <SettingsPage
      title="Memory"
      description={
        <>
          Facts agents proposed to remember about you in this organization. Confirmed memories are shared with agents in
          your future sessions and appear in those runs&apos; records; once you have many, each conversation recalls the
          most relevant ones, shown on the run. Only you can see them here, and you can edit or delete any of them at any
          time.
        </>
      }
    >
      {!org ? <NoOrganization what="its memories" /> : <MemoryListPanel org={org} />}
    </SettingsPage>
  );
}
