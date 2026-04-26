export interface ThemePreset {
  readonly id: string;
  readonly name: string;
  /** CSS class added to the root element. Empty string for the built-in default. */
  readonly className: string;
  readonly description: string;
  /** Representative OKLCH color string used for swatch rendering. */
  readonly swatch: string;
}

export const THEME_PRESETS = [
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
  {
    id: "monochrome",
    name: "Monochrome",
    className: "stgm-theme-monochrome",
    description: "Black-and-white editorial — zero chroma, typographic, sharp",
    swatch: "oklch(0.18 0 0)",
  },
] as const satisfies readonly ThemePreset[];

/** Union of built-in preset identifiers. */
export type ThemePresetId = (typeof THEME_PRESETS)[number]["id"];

/**
 * Resolve a preset ID to its CSS class name.
 *
 * Returns `""` for `"default"` (no additional class needed).
 * Emits a dev-mode warning for unrecognised IDs (guards JS consumers).
 */
export function resolvePresetClass(id: ThemePresetId): string {
  const preset = THEME_PRESETS.find((p) => p.id === id);
  if (!preset) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        `[@stigmer/theme] Unknown preset "${String(id)}". ` +
          `Available: ${THEME_PRESETS.map((p) => p.id).join(", ")}`,
      );
    }
    return "";
  }
  return preset.className;
}
