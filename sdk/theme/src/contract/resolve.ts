import type { ThemeFileTokens, TokenDeclaration } from "./parse.js";

/**
 * Cascade-faithful token resolution for a Stigmer theme scope.
 *
 * Models the element `StigmerProvider` renders:
 * `<div class="stgm stgm-theme-<id>" data-stgm-color-mode="<mode>">` with
 * `tokens.css` loaded before the preset CSS. On that element the cascade
 * resolves each token in this priority order (highest first):
 *
 * 1. **preset dark** — `[data-stgm-color-mode="dark"] .stgm-theme-<id>`
 *    (specificity 0,2,0) beats everything else.
 * 2. **preset light** — `.stgm-theme-<id>` (0,1,0) ties with the default
 *    dark block (0,1,0) and wins: preset CSS is loaded after `tokens.css`
 *    (source order within a layer) and, in app setups that import presets
 *    unlayered while `tokens.css` sits in `@layer stgm`, unlayered wins
 *    outright. Both routes give the preset-light value priority — which is
 *    why a preset that defines a token only in its light block leaks that
 *    light value into dark mode (a defect the audit detects; see
 *    `presetLightLeaksIntoDark`).
 * 3. **default dark** — `[data-stgm-color-mode="dark"]` in `tokens.css`.
 * 4. **default light** — `:root` in `tokens.css` (inherited).
 */

/** Which cascade layer supplied a resolved token value. */
export type TokenSource =
  | "preset-dark"
  | "preset-light"
  | "default-dark"
  | "default-light";

/** A token value after cascade resolution, with its winning layer. */
export interface ResolvedToken {
  readonly name: string;
  readonly value: string;
  readonly source: TokenSource;
}

export type ColorMode = "light" | "dark";

/**
 * Resolve every token visible in the given scope.
 *
 * @param defaults Parsed `tokens.css`.
 * @param preset Parsed preset CSS, or `undefined` for the built-in default
 *   preset (no theme class).
 */
export function resolveTokens(
  defaults: ThemeFileTokens,
  preset: ThemeFileTokens | undefined,
  mode: ColorMode,
): ReadonlyMap<string, ResolvedToken> {
  // Lowest priority first; later layers overwrite.
  const layers: readonly { source: TokenSource; tokens: ReadonlyMap<string, TokenDeclaration> }[] = [
    { source: "default-light", tokens: defaults.light },
    ...(mode === "dark" ? [{ source: "default-dark" as const, tokens: defaults.dark }] : []),
    ...(preset ? [{ source: "preset-light" as const, tokens: preset.light }] : []),
    ...(preset && mode === "dark"
      ? [{ source: "preset-dark" as const, tokens: preset.dark }]
      : []),
  ];

  const resolved = new Map<string, ResolvedToken>();
  for (const layer of layers) {
    for (const [name, declaration] of layer.tokens) {
      resolved.set(name, { name, value: declaration.value, source: layer.source });
    }
  }
  return resolved;
}

/**
 * Tokens whose dark-mode value is silently the preset's *light* value —
 * the preset defines them in its light block but not its dark block, while
 * the defaults do provide a dark value that can no longer take effect.
 *
 * Every such token is a latent defect: the preset author almost certainly
 * intended the default dark value to show through, but the cascade gives
 * the preset-light value priority (see module doc, rule 2).
 */
export function presetLightLeaksIntoDark(
  defaults: ThemeFileTokens,
  preset: ThemeFileTokens,
): readonly string[] {
  const leaks: string[] = [];
  for (const name of preset.light.keys()) {
    if (!preset.dark.has(name) && defaults.dark.has(name)) {
      leaks.push(name);
    }
  }
  return leaks;
}
