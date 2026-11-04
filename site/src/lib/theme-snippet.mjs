// The code the theme playground hands a reader to copy: the lines that give
// their product the look they picked (a preset, a colour mode, and a corner
// radius off the preset's own), as the theming page teaches them.
//
// One function writes it, so the playground shows exactly what is checked:
// a site unit test holds its text, and the docs' snippet check compiles its
// TypeScript for every preset in both modes. It imports nothing, so a plain
// Node script can import it as the site does (its types are in
// theme-snippet.d.mts).

/** The class the radius override is written under, as the theming page's "Override tokens directly" names its own. */
export const THEME_CLASS = "my-theme";

/**
 * The code for `theme`: a component file that wraps a host's tree in the
 * provider with that look, and, when the radius is moved off the preset's
 * own, the one-token stylesheet it imports.
 *
 * @param {{ preset: string, mode: "light" | "dark", radius: number | null }} theme
 * @returns {{ tsx: string, css: string | null }}
 */
export function themeSnippet(theme) {
  const css = theme.radius === null ? null : `.${THEME_CLASS} {\n  --stgm-radius: ${formatRem(theme.radius)};\n}\n`;
  const imports = ['import "@stigmer/design-tokens/tokens.css";'];
  if (theme.preset !== "default") imports.push(`import "@stigmer/design-tokens/presets/${theme.preset}.css";`);
  if (css !== null) imports.push('import "./my-theme.css";');
  imports.push(
    'import type { ReactNode } from "react";',
    'import type { Stigmer } from "@stigmer/client";',
    'import { StigmerProvider } from "@stigmer/react-sdk";',
  );
  const props = ["client={client}"];
  if (theme.preset !== "default") props.push(`preset="${theme.preset}"`);
  props.push(`colorMode="${theme.mode}"`);
  if (css !== null) props.push(`className="${THEME_CLASS}"`);
  const tsx = [
    ...imports,
    "",
    "export function Themed({ client, children }: { client: Stigmer; children: ReactNode }) {",
    "  return (",
    `    <StigmerProvider ${props.join(" ")}>`,
    "      {children}",
    "    </StigmerProvider>",
    "  );",
    "}",
    "",
  ].join("\n");
  return { tsx, css };
}

/** A radius in rem as CSS writes it: `0.75rem`, `1rem`, `0rem`. */
function formatRem(rem) {
  return `${Number(rem.toFixed(4))}rem`;
}
