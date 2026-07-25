/**
 * Providers for the MCP server creation tour.
 *
 * Every beat is prop-driven — the real wizard step components render entirely
 * from the wizard-data snapshots in `steps.ts` — so the router registers no
 * RPC fixtures (the first pure-props Path-A tour). `createStigmerPreview` is
 * still required: it mounts the `StigmerProvider` theme scope (`.stgm` +
 * `?theme` → color mode) and the SDK client context the real components
 * expect to exist.
 */
import { createStigmerPreview } from "../../_shared/stigmer-preview";

export const PreviewProviders = createStigmerPreview(() => {
  // No RPCs to mock: every component in this tour renders from props.
});
