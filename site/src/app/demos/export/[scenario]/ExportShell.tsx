"use client";

import { useEffect, useMemo } from "react";
import { VideoExportProvider } from "@/components/docs/demos/engine/VideoExportContext";
import { SCENARIO_REGISTRY } from "@/components/docs/demos/scenarios/registry";

interface ExportShellProps {
  scenario: string;
}

/**
 * Full-viewport shell for video export recording.
 *
 * Wraps the scenario component in {@link VideoExportProvider} so
 * ScenarioPlayer starts unmuted with controls hidden. Initialises
 * `window.__exportTimeline` for the export script to read after
 * playback completes.
 */
export function ExportShell({ scenario }: ExportShellProps) {
  const Component = useMemo(
    () => SCENARIO_REGISTRY[scenario] ?? null,
    [scenario],
  );

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__exportTimeline = [];
  }, []);

  if (!Component) return null;

  return (
    <div className="flex h-screen w-screen flex-col justify-center overflow-hidden bg-neutral-950">
      <VideoExportProvider>
        <Component />
      </VideoExportProvider>

      <div className="pointer-events-none absolute bottom-3 right-4 select-none text-xs tracking-wide text-white/25">
        stigmer.ai
      </div>
    </div>
  );
}
