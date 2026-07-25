/**
 * Providers for the MCP server connect tour.
 *
 * The resource that varies across the timeline — the server before vs after
 * discovery — is injected by `index.tsx` through `McpServerDetailView`'s
 * `mcpServerState` prop, so the router registers no fixture for it
 * (scenar-cloud DD-006: fixtures only for tour-constant data, props for
 * anything that changes per step).
 *
 * The view's remaining lookups (personal environment list, org OAuth app,
 * permission check) fall through to the router's built-in `unimplemented`
 * response, which the SDK hooks degrade from: no personal environment means
 * every declared env var counts as missing — exactly the state the
 * credential-form beats depict. `createStigmerPreview` is still required
 * for the `.stgm` theme scope (`?theme` → color mode) and the SDK client
 * context the real component expects.
 */
import { createStigmerPreview } from "../../_shared/stigmer-preview";

export const PreviewProviders = createStigmerPreview(() => {
  // No RPCs to mock: varying data arrives via props, constant lookups
  // degrade gracefully from `unimplemented`.
});
