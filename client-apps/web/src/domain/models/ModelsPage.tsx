"use client";

import { ModelsHub, useActiveOrgId } from "@stigmer/react-sdk";

/**
 * Models & providers: which models the organization's agents can run, the
 * providers behind them, and the person's default model per engine.
 *
 * Mounted at `/models`, a top-level page in the workspace sidebar, because
 * a provider is what a new person needs before a first answer. Everything
 * on it (the readiness answer, the provider cards and their acts, the
 * defaults) is the SDK's `ModelsHub`; the desktop app mounts it the same
 * way.
 */
export function ModelsPage() {
  const org = useActiveOrgId();
  if (!org) return null;
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <ModelsHub org={org} />
    </div>
  );
}
