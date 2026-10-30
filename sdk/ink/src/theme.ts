// The terminal kit's colours, by role. Components ask for a role (accent,
// muted, success, warning, danger), never a hue, so a host CLI gives the kit
// its own look in one place and the default stays Stigmer's: black and white
// on purpose (the terminal's own foreground, bold for the accent, dim for the
// quiet text), with hue kept for status alone. A terminal's palette already
// adapts green, yellow and red to its light or dark background. A host whose
// own colours differ between a light and a dark terminal passes its theme as
// a function of the background (terminal-background.ts detects it).
//
// Proven by __tests__/theme.test.tsx.

import { createContext, useContext } from "react";
import type { TerminalBackground } from "./terminal-background.js";

/**
 * A host's colours by role. Each is an Ink colour: a name (`"magenta"`), a
 * hex value (`"#7c3aed"`) or `rgb(...)`. `accent` and `muted` are unset by
 * default: the accent is the terminal's foreground in bold, muted text is dim.
 */
export interface InkTheme {
  /** Prompts, the selected row, the working spinner. */
  readonly accent?: string;
  /** Secondary text: hints, counts, settled rows. */
  readonly muted?: string;
  /** A turn or a tool that succeeded; added lines. */
  readonly success: string;
  /** Something waiting on a person, or a reconnect. */
  readonly warning: string;
  /** A failure, a denial, removed lines. */
  readonly danger: string;
}

/** Stigmer's default: monochrome, with a hue only where a status needs one. */
export const DEFAULT_INK_THEME: InkTheme = {
  success: "green",
  warning: "yellow",
  danger: "red",
};

/** The roles a component asks for. */
export type InkRole = keyof InkTheme;

/** The `<Text>` props a role draws with. */
export interface RoleStyle {
  /** The Ink colour, when the role has one. */
  readonly color?: string;
  /** Drawn bold: the accent, so an unset accent still stands out in monochrome. */
  readonly bold?: boolean;
  /** Drawn dim: muted text with no colour of its own. */
  readonly dimColor?: boolean;
}

/**
 * What a host passes as its theme: roles over the default, or a function of
 * the terminal's background that returns them, so its colours follow a light
 * or a dark terminal.
 */
export type InkThemeInput = Partial<InkTheme> | ((background: TerminalBackground) => Partial<InkTheme>);

/** A host's theme over the default, under the background in effect ("unknown" when not detected). */
export function resolveInkTheme(theme?: InkThemeInput, background: TerminalBackground = "unknown"): InkTheme {
  return { ...DEFAULT_INK_THEME, ...(typeof theme === "function" ? theme(background) : theme) };
}

/** How a role draws under a theme: an unset accent is bold foreground, an unset muted is dim. */
export function roleStyle(theme: InkTheme, role: InkRole): RoleStyle {
  if (role === "accent") return theme.accent === undefined ? { bold: true } : { color: theme.accent, bold: true };
  if (role === "muted") return theme.muted === undefined ? { dimColor: true } : { color: theme.muted };
  return { color: theme[role] };
}

/** The theme in effect; the default outside a provider that sets one. */
export const InkThemeContext = createContext<InkTheme>(DEFAULT_INK_THEME);

/** The terminal's background in effect; "unknown" outside a provider that knows it. */
export const TerminalBackgroundContext = createContext<TerminalBackground>("unknown");

/** The terminal's background the nearest `InkStigmerProvider` was given, for a host's own components. */
export function useTerminalBackground(): TerminalBackground {
  return useContext(TerminalBackgroundContext);
}

/** The theme the nearest `InkStigmerProvider` set, or Stigmer's default. */
export function useInkTheme(): InkTheme {
  return useContext(InkThemeContext);
}

/** Every role's `<Text>` props under the theme in effect, for a component that draws several. */
export function useRoles(): Readonly<Record<InkRole, RoleStyle>> {
  const theme = useInkTheme();
  return {
    accent: roleStyle(theme, "accent"),
    muted: roleStyle(theme, "muted"),
    success: roleStyle(theme, "success"),
    warning: roleStyle(theme, "warning"),
    danger: roleStyle(theme, "danger"),
  };
}
