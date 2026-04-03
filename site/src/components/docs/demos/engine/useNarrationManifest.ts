"use client";

import { useEffect, useState } from "react";
import type { NarrationManifest } from "./narration";

/**
 * Fetch and return the narration manifest for a scenario.
 *
 * Returns `undefined` until the manifest loads (or if narration audio
 * has not been generated for this scenario). ScenarioPlayer treats
 * `undefined` as "no narration" — the demo runs silently with its
 * original visual timing.
 *
 * The manifest is fetched once on mount from `/demos/{scenarioId}/manifest.json`
 * (a static asset produced by `make generate-narration`). A 404 or
 * network error is silently ignored so the demo always works.
 */
export function useNarrationManifest(
  scenarioId: string,
): NarrationManifest | undefined {
  const [manifest, setManifest] = useState<NarrationManifest>();

  useEffect(() => {
    fetch(`/demos/${scenarioId}/manifest.json`)
      .then((response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((data) => {
        if (data) setManifest(data as NarrationManifest);
      })
      .catch(() => {});
  }, [scenarioId]);

  return manifest;
}
