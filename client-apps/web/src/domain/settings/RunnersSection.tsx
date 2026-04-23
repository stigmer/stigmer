"use client";

import { RunnerListPanel } from "@stigmer/react";
import { useActiveOrgSlug } from "@/domain/_shared/org/org-context";

export function RunnersSection() {
  const org = useActiveOrgSlug();

  return (
    <section aria-labelledby="runners-heading">
      <h2
        id="runners-heading"
        className="text-foreground mb-1 text-sm font-semibold"
      >
        Runners
      </h2>
      <p className="text-muted-foreground mb-4 text-xs">
        Machines that execute your agents. Runners are registered via the CLI
        or auto-provisioned by Stigmer Cloud for on-demand executions.
      </p>

      {!org ? (
        <p className="text-muted-foreground py-4 text-center text-xs">
          Select an organization to view runners.
        </p>
      ) : (
        <RunnerListPanel org={org} />
      )}
    </section>
  );
}
