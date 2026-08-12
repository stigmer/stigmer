"use client";

import { useMemo, type ReactNode } from "react";
import { PreviewProvider } from "@scenar/preview/runtime";
import { http, HttpResponse, type HttpHandler } from "msw";
import { PreviewProviders } from "../../../../../.scenar/providers";

/**
 * The provider chain (`PreviewProviders` → `StigmerProvider`) fires two
 * plain-GET registry fetches on mount, in every demo, before any
 * scenario fixture is consulted. Without handlers they escape MSW
 * (`onUnhandledRequest: "bypass"`) to the real network, 404 against the
 * site server, and retry with backoff — harmless-looking on Chromium,
 * but WebKit surfaces the failures as `TypeError: Load failed` and the
 * Playwright smoke suite fails any demo with a page error (oss#271).
 *
 * The payloads are shape-faithful subsets of the server's embedded
 * registries (`backend/.../workflow/registry/data/*.json`), trimmed to
 * the fields the SDK parsers consume. The real files total ~186KB and
 * would ship to every docs visitor for data no demo renders; a demo
 * that ever renders registry-driven UI should override these with its
 * own scenario fixtures (which are matched first).
 */
const MODEL_REGISTRY_FIXTURE = {
  models: [
    {
      id: "claude-opus-4-8",
      displayName: "Claude 4.8 Opus",
      shortDescription: "Frontier Opus via Cursor",
      speedTier: "slow",
      provider: "anthropic",
      harness: "cursor",
      costTier: "premium",
      featured: true,
    },
    {
      id: "claude-sonnet-4-6",
      displayName: "Claude 4.6 Sonnet",
      shortDescription: "Balanced via Cursor",
      speedTier: "fast",
      provider: "anthropic",
      harness: "cursor",
      costTier: "standard",
      featured: true,
    },
  ],
};

const TASK_KIND_REGISTRY_FIXTURE = {
  version: "1.0.0",
  generatedAt: "demo-fixture",
  descriptors: [],
};

/** Baseline MSW handlers for the fetches StigmerProvider always makes. */
function stigmerBaseFixtures(): HttpHandler[] {
  return [
    http.get("*/v1/proxy/model-registry", () =>
      HttpResponse.json(MODEL_REGISTRY_FIXTURE),
    ),
    http.get("*/v1/proxy/task-kind-registry", () =>
      HttpResponse.json(TASK_KIND_REGISTRY_FIXTURE),
    ),
  ];
}

interface StigmerPreviewProviderProps {
  /**
   * Scenario-specific MSW handlers (typically Connect-RPC fixtures
   * built with `connectFixture`). Placed before the baseline
   * handlers; MSW resolves first-match-wins, so scenarios can
   * override the baseline registries if they ever need to.
   */
  readonly fixtures?: readonly HttpHandler[];
  readonly children: ReactNode;
}

/**
 * Demo-scenario wrapper around Scenar's PreviewProvider.
 *
 * Composes the shared Stigmer provider chain with the baseline
 * registry fixtures every StigmerProvider mount requires, so no
 * scenario can forget them. Scenarios pass only their own fixtures.
 */
export function StigmerPreviewProvider({
  fixtures,
  children,
}: StigmerPreviewProviderProps) {
  // PreviewProvider tears down and re-registers MSW on fixtures
  // identity change; memoize so re-renders don't churn the worker.
  const allFixtures = useMemo(
    () => [...(fixtures ?? []), ...stigmerBaseFixtures()],
    [fixtures],
  );

  return (
    <PreviewProvider providers={PreviewProviders} fixtures={allFixtures}>
      {children}
    </PreviewProvider>
  );
}
