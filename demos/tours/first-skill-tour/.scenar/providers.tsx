/**
 * Providers for the First Skill outcome tour.
 *
 * Both beats are pure `@scenar/react` shells driven by props, so the
 * router registers no fixture. `createStigmerPreview` is still wired for
 * one measured reason: it pulls the compiled SDK stylesheet and the
 * self-hosted Geist fonts into the bundle's graph, and that stylesheet's
 * Tailwind theme maps `font-mono` through `--font-geist-mono`. Packed
 * both ways on 2026-07-26: without providers the editor/terminal body
 * text falls back to the system mono stack, visibly diverging from
 * `quickstart-tour`'s beats of this same workspace one page earlier;
 * the shell chrome (tabs, title bars) is identical either way.
 */
import { createStigmerPreview } from "../../_shared/stigmer-preview";

export const PreviewProviders = createStigmerPreview(() => {
  // No RPCs to mock: everything on screen arrives via props.
});
