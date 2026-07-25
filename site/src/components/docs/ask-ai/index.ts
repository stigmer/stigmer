/**
 * Ask AI — the docs-site launcher for the `stigmer/stigmer-docs` agent,
 * embedded through `@stigmer/embed`'s `<stigmer-agent>` element.
 *
 * Layered headless-first (behavior hook → provider → presentational
 * trigger/panel) so a future extraction of a generic "Ask AI launcher" into
 * `@stigmer/react` is a file move. Not exported through the docs MDX barrel:
 * this is layout chrome, not page content.
 */

export { AskAiProvider, useAskAi } from "./AskAiProvider";
export { AskAiTrigger } from "./AskAiTrigger";
export { AskAiPanel } from "./AskAiPanel";
export {
  useAskAiPanel,
  type AskAiPanelState,
  type AskAiStatus,
} from "./useAskAiPanel";
