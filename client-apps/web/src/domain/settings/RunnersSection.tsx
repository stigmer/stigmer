"use client";

import { useCallback, useRef } from "react";
import { ArrowUpRight, Monitor } from "lucide-react";
import { RunnerListPanel, useLaunchLocalRunner } from "@stigmer/react";
import { EXTERNAL_LINKS } from "@/config/external-links";
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

      <DesktopAppPromo />
    </section>
  );
}

function DesktopAppPromo() {
  return (
    <aside
      aria-label="Stigmer Desktop"
      className="mt-6 flex items-start gap-3 rounded-lg border border-border-muted px-4 py-3"
    >
      <Monitor className="text-muted-foreground mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-xs font-medium">Stigmer Desktop</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          Manage runners from your system tray with deep-link launches and
          native notifications.
        </p>
      </div>
      <a
        href={EXTERNAL_LINKS.download}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary hover:text-foreground mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs font-medium transition-colors"
      >
        Download
        <ArrowUpRight className="text-muted-foreground size-3" />
      </a>
    </aside>
  );
}
