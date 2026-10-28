import { ModelsHub, useActiveOrgId } from "@stigmer/react-sdk";

/**
 * Models & providers: which models the organization's agents can run, the
 * providers behind them, and the person's default model per engine.
 *
 * Mounted at `/models`, a top-level page in the workspace sidebar; the
 * same wiring as the web console's page. Everything on it is the SDK's
 * `ModelsHub`.
 */
export default function ModelsPage() {
  const org = useActiveOrgId();
  if (!org) return null;
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8">
      <ModelsHub org={org} />
    </div>
  );
}
