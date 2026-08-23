"use client";

import { useId } from "react";
import { MemoryListPanel } from "../memory/MemoryListPanel.js";
import { useActiveOrgSlug } from "../organization/OrgProvider.js";

/**
 * Settings section listing everything the platform remembers about the
 * caller in the active organization.
 *
 * The helper copy carries the DD-006 D6 transparency statement: a
 * confirmed memory is injected into the caller's future sessions and
 * appears in those executions' records. Memory content everywhere else
 * is subject-only — this page shows the caller their own records and
 * nobody else's.
 */
export function MemorySection() {
  const headingId = useId();
  const org = useActiveOrgSlug();

  return (
    <section aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="stg:text-foreground stg:mb-1 stg:text-sm stg:font-semibold"
      >
        Memory
      </h2>
      <p className="stg:text-muted-foreground stg:mb-6 stg:text-xs">
        Facts agents proposed to remember about you in this organization.
        Confirmed memories are shared with agents in your future sessions
        and appear in those executions&apos; records; once you have many,
        each conversation recalls the most relevant ones, shown on the
        execution. Only you can see them here, and you can edit or delete
        any of them at any time.
      </p>

      {!org ? (
        <p className="stg:text-muted-foreground stg:py-4 stg:text-center stg:text-xs">
          Select an organization to view its memories.
        </p>
      ) : (
        <MemoryListPanel org={org} />
      )}
    </section>
  );
}
