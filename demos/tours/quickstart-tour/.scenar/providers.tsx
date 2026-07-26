/**
 * Providers for the Quickstart overview tour.
 *
 * Every beat is prop-driven: the created key arrives through
 * `ApiKeyCreatedAlert`'s props, and the editor/terminal beats render pure
 * `@scenar/react` shells. The router registers no fixture (scenar-cloud
 * DD-006: fixtures only for data a component fetches — and nothing here
 * fetches at all; `ApiKeyCreatedAlert` is pure local state).
 *
 * `createStigmerPreview` is still required for the `.stgm` theme scope
 * (`?theme` → color mode) and the SDK client context the real component
 * expects.
 */
import { createStigmerPreview } from "../../_shared/stigmer-preview";

export const PreviewProviders = createStigmerPreview(() => {
  // No RPCs to mock: everything on screen arrives via props.
});
