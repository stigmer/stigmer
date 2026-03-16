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
    id: "corporate",
    name: "Corporate",
    className: "stgm-theme-corporate",
    description: "Enterprise SaaS — tight radius, blue, cool grays, dark sidebar",
    swatch: "oklch(0.48 0.15 250)",
  },
  {
    id: "startup",
    name: "Startup",
    className: "stgm-theme-startup",
    description: "Modern dev tools — clean, monochrome, violet accent, minimal",
    swatch: "oklch(0.50 0.22 285)",
  },
  {
    id: "friendly",
    name: "Friendly",
    className: "stgm-theme-friendly",
    description: "Consumer SaaS — very rounded, warm coral, cream surfaces",
    swatch: "oklch(0.62 0.19 45)",
  },
  {
    id: "fintech",
    name: "Fintech",
    className: "stgm-theme-fintech",
    description: "Premium financial — sharp corners, indigo, crisp, dark sidebar",
    swatch: "oklch(0.50 0.22 280)",
  },
] as const;
