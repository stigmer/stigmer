// The types of theme-snippet.mjs: the code the theme playground hands a
// reader to copy.

/** The class the radius override is written under. */
export declare const THEME_CLASS: string;

/** A look the playground offers: a preset (`default` for none), a colour mode, and a radius in rem or null for the preset's own. */
export interface SnippetTheme {
  readonly preset: string;
  readonly mode: "light" | "dark";
  readonly radius: number | null;
}

/** The component file that gives a host's tree `theme`, and the one-token stylesheet it imports when the radius moves. */
export declare function themeSnippet(theme: SnippetTheme): { readonly tsx: string; readonly css: string | null };
