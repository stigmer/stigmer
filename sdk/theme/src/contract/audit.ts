import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseThemeCss, type ThemeFileTokens } from "./parse.js";
import {
  presetLightLeaksIntoDark,
  resolveTokens,
  type ColorMode,
} from "./resolve.js";
import { contrastRatio, lightnessDelta } from "./color.js";
import {
  CONTRAST_PAIRS,
  SURFACE_PAIRS,
  SUPPORTING_TEXT_MIN_RATIO,
  SURFACE_MIN_DELTA_L,
  TEXT_MIN_RATIO,
  type ContrastPair,
} from "./pairs.js";

/**
 * Contrast-audit runner: evaluates the declared pair contract against every
 * preset × color mode, resolving tokens through the real cascade.
 *
 * Consumed by the vitest suite (assertions) and by
 * `scripts/contrast-report.ts` (the full human-readable matrix).
 */

const SRC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

export const PRESET_IDS = [
  "default",
  "corporate",
  "startup",
  "friendly",
  "fintech",
  "monochrome",
] as const;

export type PresetId = (typeof PRESET_IDS)[number];
export const COLOR_MODES: readonly ColorMode[] = ["light", "dark"];

export interface PairResult {
  readonly pair: ContrastPair;
  readonly preset: PresetId;
  readonly mode: ColorMode;
  /** WCAG ratio for text pairs; OKLCH lightness delta for surface pairs. */
  readonly measured: number;
  readonly threshold: number;
  readonly passes: boolean;
  /** False when the pair is measured in this mode but not gated (report-only). */
  readonly enforced: boolean;
  readonly foregroundValue: string;
  readonly backgroundValue: string;
}

export interface PresetLeak {
  readonly preset: PresetId;
  readonly tokens: readonly string[];
}

export interface AuditReport {
  readonly results: readonly PairResult[];
  /** Preset tokens whose light value leaks into dark mode (cascade defect). */
  readonly leaks: readonly PresetLeak[];
}

function loadDefaults(): ThemeFileTokens {
  return parseThemeCss(readFileSync(join(SRC_DIR, "tokens.css"), "utf-8"));
}

function loadPreset(id: PresetId): ThemeFileTokens | undefined {
  if (id === "default") return undefined;
  return parseThemeCss(
    readFileSync(join(SRC_DIR, "presets", `${id}.css`), "utf-8"),
  );
}

function thresholdFor(pair: ContrastPair): number {
  switch (pair.kind) {
    case "text":
      return TEXT_MIN_RATIO;
    case "supporting":
      return SUPPORTING_TEXT_MIN_RATIO;
    case "surface":
      return SURFACE_MIN_DELTA_L;
  }
}

/** Evaluate the full declared contract. */
export function runContrastAudit(): AuditReport {
  const defaults = loadDefaults();
  const results: PairResult[] = [];
  const leaks: PresetLeak[] = [];

  for (const preset of PRESET_IDS) {
    const presetTokens = loadPreset(preset);
    if (presetTokens) {
      const leaked = presetLightLeaksIntoDark(defaults, presetTokens);
      if (leaked.length > 0) leaks.push({ preset, tokens: leaked });
    }

    for (const mode of COLOR_MODES) {
      const resolved = resolveTokens(defaults, presetTokens, mode);
      for (const pair of [...CONTRAST_PAIRS, ...SURFACE_PAIRS]) {
        const foreground = resolved.get(pair.foreground);
        const background = resolved.get(pair.background);
        if (!foreground || !background) {
          throw new Error(
            `Contract pair references unknown token: ${pair.foreground} / ${pair.background}`,
          );
        }
        const threshold = thresholdFor(pair);
        const measured =
          pair.kind === "surface"
            ? lightnessDelta(foreground.value, background.value)
            : contrastRatio(foreground.value, background.value);
        results.push({
          pair,
          preset,
          mode,
          measured,
          threshold,
          passes: measured >= threshold,
          enforced: pair.enforcedModes?.includes(mode) ?? true,
          foregroundValue: foreground.value,
          backgroundValue: background.value,
        });
      }
    }
  }

  return { results, leaks };
}

/** Stable identity for a result, used by the exemption list and reporting. */
export function resultId(result: PairResult): string {
  return `${result.preset}/${result.mode}: ${result.pair.foreground} on ${result.pair.background}`;
}
