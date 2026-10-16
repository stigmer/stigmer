/**
 * Data fixtures for chat-link-tour. `scenar pack` and `scenar render` wrap
 * every step of this tour in the exported `PreviewProviders`.
 *
 * The dialog itself is prop-driven (agent + chat link travel as props from
 * `steps.ts`), and its who-pays copy names the organization from the chat
 * link alone, so no RPC needs mocking. Everything the dialog might ask (tool
 * readiness, saves — never reached in an inert playback) falls through to
 * the router's `unimplemented` response, which the hooks degrade from. The
 * no-op register still wires styles, theme, and the inert transport once
 * (`_shared/stigmer-preview.tsx`).
 */
import { createStigmerPreview } from "../../_shared/stigmer-preview";

export const PreviewProviders = createStigmerPreview(() => {});
