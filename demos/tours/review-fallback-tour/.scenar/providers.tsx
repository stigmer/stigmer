/**
 * Providers for review-fallback-tour. `scenar pack` and `scenar render` wrap
 * every step of this tour in the exported `PreviewProviders`.
 *
 * The gate is fully prop-driven — no RPC fixtures. And this surface
 * registers NO review renderers, deliberately: the tour depicts the
 * portability fallback, where the SDK's built-in approval card presents the
 * payload as structured data. (Its sibling `review-renderer-tour` registers
 * the `article-diff` map — that difference IS the two tours' story.) The
 * provider tree itself is still needed for the SDK client and the `.stgm`
 * theme scope.
 */
import { createStigmerPreview } from "../../_shared/stigmer-preview";

export const PreviewProviders = createStigmerPreview(() => {});
