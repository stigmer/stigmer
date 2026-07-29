/**
 * The two color modes the Stigmer SDK theme scope understands.
 * Mirrors the `data-stgm-color-mode` attribute contract.
 */
export type StigmerColorMode = "light" | "dark";

/**
 * Resolves the docs reader's color mode for `.stgm` theme scopes.
 *
 * Consumers (demo shells, the Ask AI panel) pass this value as
 * `data-stgm-color-mode` on their `.stgm` scoping element — the same
 * "pass your theme state straight through" pattern the theming docs
 * prescribe for host applications embedding the SDK.
 *
 * The site is dark-only (`<html class="dark">` is hardcoded and the docs
 * RootProvider mounts no theme machinery), so the host state this hook
 * passes through is the constant `"dark"`. Kept as a hook so consumers
 * keep expressing "give me the host's color mode" rather than each
 * hardcoding the site-wide decision.
 */
export function useDocsColorMode(): StigmerColorMode {
  return "dark";
}
