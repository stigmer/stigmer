/**
 * The theme playground's code, compiled as the docs' own examples are.
 *
 * The playground on the theming page hands a reader the lines that give
 * their product the look they picked, written by one function
 * (`site/src/lib/theme-snippet.mjs`). No fence holds that code, so the gate
 * writes it here for every look the playground offers: each preset the live
 * demos draw (`LIVE_PRESETS` in `test/visual/src/live.ts`), in light and in
 * dark, at the preset's own radius and at a radius moved off it. Each is a
 * unit of its own, a whole file, compiled with the docs' TypeScript and
 * reported against the writer, so a change to the writer or to the kit that
 * breaks what a reader copies fails the gate.
 *
 * A tree without the writer (a branch from before the playground) has no
 * such units. Pure apart from reading the two files.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { pageLines } from "./collect.mjs";

/** The writer, from the repository root; the units are reported against it. */
export const THEME_SNIPPET_FILE = "site/src/lib/theme-snippet.mjs";

/** The list of the live demos' presets, from the repository root. */
export const LIVE_FILE = "test/visual/src/live.ts";

/** The radii each look is written at: the preset's own, and one moved off it. */
export const THEME_RADII = [null, 0.75];

/** The colour modes each look is written in. */
export const THEME_MODES = ["light", "dark"];

/**
 * The presets `LIVE_PRESETS` names, read from the module's text: the gate is
 * plain Node and does not load TypeScript modules.
 * @param {string} source live.ts's text
 * @returns {string[]}
 */
export function livePresets(source) {
  const m = /export const LIVE_PRESETS\s*=\s*\[([^\]]*)\]\s*as const/.exec(source);
  if (m === null) throw new Error(`${LIVE_FILE} declares no LIVE_PRESETS array the snippet gate can read`);
  const presets = [...m[1].matchAll(/"([^"]+)"/g)].map((p) => p[1]);
  if (presets.length === 0) throw new Error(`${LIVE_FILE}: LIVE_PRESETS is empty`);
  return presets;
}

/**
 * Every look's code as a whole-file TypeScript unit, numbered from `firstId`.
 * @param {(theme: {preset: string, mode: "light" | "dark", radius: number | null}) => {tsx: string}} write
 * @param {string[]} presets
 * @param {number} firstId
 */
export function themeUnits(write, presets, firstId) {
  const units = [];
  let id = firstId;
  for (const preset of presets) {
    for (const mode of THEME_MODES) {
      for (const radius of THEME_RADII) {
        const { tsx } = write({ preset, mode, radius });
        units.push({
          id: id++,
          page: THEME_SNIPPET_FILE,
          line: 1,
          lang: "tsx",
          language: "typescript",
          generated: true,
          variant: `preset ${preset}, ${mode}, radius ${radius ?? "the preset's own"}`,
          kind: "file",
          title: "Themed.tsx",
          text: tsx,
          setup: [],
          body: pageLines(tsx, 1),
          prelude: [],
          siblings: [],
        });
      }
    }
  }
  return units;
}

/**
 * The playground's units in the tree at `root`, or none when it has no
 * writer.
 * @param {string} root
 * @param {number} firstId
 */
export async function themeSnippetUnits(root, firstId) {
  const writer = join(root, THEME_SNIPPET_FILE);
  if (!existsSync(writer)) return [];
  const { themeSnippet } = await import(pathToFileURL(writer).href);
  return themeUnits(themeSnippet, livePresets(readFileSync(join(root, LIVE_FILE), "utf8")), firstId);
}
