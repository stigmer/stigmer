/**
 * Providers for embed-agent-tour. Every beat is prop-driven — the chat
 * surfaces render from the execution fixture and composer props, and the
 * code beat is a Scenar shell — so no RPCs need mocking. The no-op
 * register still wires styles, theme, and the inert transport once
 * (`_shared/stigmer-preview.tsx`).
 */
import { createStigmerPreview } from "../../_shared/stigmer-preview";

export const PreviewProviders = createStigmerPreview(() => {});
