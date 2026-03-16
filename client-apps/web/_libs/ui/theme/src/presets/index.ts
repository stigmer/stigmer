export interface ThemePreset {
  readonly id: string;
  readonly name: string;
  /** CSS class added to the root element. Empty string for the built-in default. */
  readonly className: string;
  readonly description: string;
  /** Representative OKLCH color string used for swatch rendering. */
  readonly swatch: string;
}

export const THEME_PRESETS: readonly ThemePreset[] = [
  {
    id: "default",
    name: "Default",
    className: "",
    description: "Stigmer's built-in teal palette",
    swatch: "oklch(0.55 0.12 190)",
  },
  {
    id: "rose",
    name: "Rose",
    className: "stgm-theme-rose",
    description: "Warm pink and rose tones",
    swatch: "oklch(0.55 0.2 350)",
  },
  {
    id: "amber",
    name: "Amber",
    className: "stgm-theme-amber",
    description: "Warm amber and gold tones",
    swatch: "oklch(0.65 0.18 75)",
  },
  {
    id: "violet",
    name: "Violet",
    className: "stgm-theme-violet",
    description: "Purple and indigo tones",
    swatch: "oklch(0.50 0.2 290)",
  },
  {
    id: "emerald",
    name: "Emerald",
    className: "stgm-theme-emerald",
    description: "Rich green tones",
    swatch: "oklch(0.55 0.17 155)",
  },
] as const;
