/**
 * Providers for the Connect Tools overview tour.
 *
 * Every beat is prop-driven: the connected server arrives through
 * `McpServerDetailView`'s `mcpServerState` prop, the approval-story
 * executions through `ComposerView`'s `execution` prop, and the widget rail
 * renders purely from those executions. The router registers no fixture
 * (scenar-cloud DD-006: fixtures only for tour-constant data, props for
 * anything that changes per step — and nothing here is fetched at all).
 *
 * The detail view's remaining lookups (personal environment list, org OAuth
 * app, permission check) fall through to the router's built-in
 * `unimplemented` response, which the SDK hooks degrade from gracefully.
 * `createStigmerPreview` is still required for the `.stgm` theme scope
 * (`?theme` → color mode) and the SDK client context the real components
 * expect.
 */
import { createStigmerPreview } from "../../_shared/stigmer-preview";

export const PreviewProviders = createStigmerPreview(() => {
  // No RPCs to mock: everything on screen arrives via props.
});
