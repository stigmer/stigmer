"use client";

import { useCallback, useRef } from "react";
import { RunnerListPanel, useLaunchLocalRunner } from "@stigmer/react";
import { useActiveOrgSlug } from "@/domain/_shared/org/org-context";

export function RunnersSection() {
  const org = useActiveOrgSlug();
  const { launch, isLaunching, error, clearError } = useLaunchLocalRunner();
  const listRefetchRef = useRef<(() => void) | null>(null);

  const handleRefetchRef = useCallback((refetch: () => void) => {
    listRefetchRef.current = refetch;
  }, []);

  const handleLaunch = useCallback(async () => {
    if (!org) return;
    clearError();
    try {
      await launch({ org });
    } catch {
      // error state surfaced via useLaunchLocalRunner hook
    }
  }, [org, launch, clearError]);

  return (
    <section aria-labelledby="runners-heading">
      <div className="mb-1 flex items-center justify-between">
        <h2
          id="runners-heading"
          className="text-foreground text-sm font-semibold"
        >
          Runners
        </h2>

        {org && (
          <button
            type="button"
            onClick={handleLaunch}
            disabled={isLaunching}
            className="text-primary hover:text-foreground text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            {isLaunching ? "Launching\u2026" : "Launch Local Runner"}
          </button>
        )}
      </div>
      <p className="text-muted-foreground mb-4 text-xs">
        Machines that execute your agents. Runners are registered via the CLI
        or auto-provisioned by Stigmer Cloud for on-demand executions.
      </p>

      {error && (
        <p className="text-destructive mb-3 text-xs" role="alert">
          {error.message}
        </p>
      )}

      {!org ? (
        <p className="text-muted-foreground py-4 text-center text-xs">
          Select an organization to view runners.
        </p>
      ) : (
        <RunnerListPanel org={org} onRefetchRef={handleRefetchRef} />
      )}
    </section>
  );
}
