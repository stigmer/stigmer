"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Monitor } from "lucide-react";
import { toast } from "sonner";
import {
  RunnerListPanel,
  useLaunchLocalRunner,
  useRunnerList,
  useActiveOrgSlug,
} from "@stigmer/react";
import { triggerDesktopDownload } from "@/lib/desktop-download";
import {
  markLocalRunnerDetected,
  useHasDesktopSignal,
} from "@/domain/_shared/layout/DesktopAppBanner";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1"]);

function isLocalHostname(hostname: string | undefined): boolean {
  if (!hostname) return false;
  const lower = hostname.toLowerCase();
  return (
    LOCAL_HOSTNAMES.has(lower) ||
    lower.endsWith(".local") ||
    lower.startsWith("192.168.") ||
    lower.startsWith("10.")
  );
}

const LAUNCH_POLL_MS = 3_000;
const LAUNCH_TIMEOUT_MS = 15_000;
const LAUNCH_TOAST_ID = "launch-local-runner";

type LaunchOutcome = "idle" | "awaiting" | "succeeded" | "timed-out";

export function RunnersSection() {
  const org = useActiveOrgSlug();
  const { launch, isLaunching, error, clearError } = useLaunchLocalRunner();
  const hasDesktop = useHasDesktopSignal();

  const [launchOutcome, setLaunchOutcome] = useState<LaunchOutcome>("idle");
  const [prelaunchRunnerIds, setPrelaunchRunnerIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const awaitingLaunch = launchOutcome === "awaiting";
  const launchTimedOut = launchOutcome === "timed-out";

  const { runners } = useRunnerList(org ?? null, {
    refetchInterval: awaitingLaunch ? LAUNCH_POLL_MS : false,
  });

  useEffect(() => {
    const hasLocal = runners.some((r) =>
      isLocalHostname(r.status?.connectionInfo?.hostname),
    );
    if (hasLocal) markLocalRunnerDetected();
  }, [runners]);

  // Detect new runner during render (React-sanctioned setState-during-render).
  // When a new runner ID appears while awaiting, transition to "succeeded".
  // React will discard this render and immediately re-render with the new state.
  if (
    awaitingLaunch &&
    runners.some(
      (r) => r.metadata?.id && !prelaunchRunnerIds.has(r.metadata.id),
    )
  ) {
    setLaunchOutcome("succeeded");
  }

  // Timeout: transition to "timed-out" after LAUNCH_TIMEOUT_MS.
  // setState inside the timer callback is async, not synchronous in the effect body.
  useEffect(() => {
    if (!awaitingLaunch) return;
    const timer = setTimeout(() => setLaunchOutcome("timed-out"), LAUNCH_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [awaitingLaunch]);

  // Toast side effects driven by outcome transitions.
  useEffect(() => {
    if (launchOutcome === "succeeded") {
      toast.success("Runner launched successfully.", { id: LAUNCH_TOAST_ID });
    }
    if (launchOutcome === "timed-out") {
      toast.warning("Stigmer Desktop didn\u2019t respond.", {
        id: LAUNCH_TOAST_ID,
        description: "Is the desktop app installed and running?",
        action: {
          label: "Download Desktop",
          onClick: () => triggerDesktopDownload(),
        },
        duration: 12_000,
      });
    }
  }, [launchOutcome]);

  const handleLaunch = useCallback(async () => {
    if (!org) return;
    clearError();
    setLaunchOutcome("idle");

    setPrelaunchRunnerIds(
      new Set(runners.map((r) => r.metadata?.id ?? "").filter(Boolean)),
    );

    try {
      await launch({ org });
      setLaunchOutcome("awaiting");
      toast.loading("Opening Stigmer Desktop\u2026", {
        id: LAUNCH_TOAST_ID,
        description: "Waiting for the desktop app to start a runner.",
      });
    } catch {
      // error state surfaced via useLaunchLocalRunner hook
    }
  }, [org, launch, clearError, runners]);

  const showDesktopPromo = !hasDesktop || launchTimedOut;

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
            disabled={isLaunching || awaitingLaunch}
            className="text-primary hover:text-foreground text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50"
          >
            {isLaunching || awaitingLaunch
              ? "Launching\u2026"
              : "Launch Local Runner"}
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
        <RunnerListPanel org={org} />
      )}

      {showDesktopPromo && <DesktopAppPromo />}
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
      <button
        type="button"
        onClick={triggerDesktopDownload}
        className="text-primary hover:text-foreground mt-0.5 inline-flex shrink-0 items-center gap-1 text-xs font-medium transition-colors"
      >
        Download
        <Download className="text-muted-foreground size-3" />
      </button>
    </aside>
  );
}
