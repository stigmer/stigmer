/**
 * Pins the typeface rule every preset follows: a preset whose light block
 * names a UI font (`--stgm-font-sans`) also declares
 * `font-family: var(--stgm-font-sans)` in that same block, and a preset
 * that names no font declares no `font-family` at all.
 *
 * The token alone reaches only text that reads it by name (#2824):
 * `font-family` is resolved once on the page's root element and inherited
 * as a value, so a token redeclared on the preset's class changes nothing
 * its paragraphs, headings and labels inherit. The one declaration beside
 * the token makes inherited text inside the scope follow it, while the
 * default look and the font-less presets keep taking the host page's font.
 * The browser proof is `sdk/react`'s preset-typeface layout suite; this is
 * the contract over the files themselves.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { THEME_PRESETS } from "../index";

const PRESETS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The declarations of a preset file's light block (`.stgm-theme-<id> {`),
 * as property and value pairs. The preset files are machine-formatted: flat
 * top-level blocks, one declaration per line, comments on their own lines.
 */
function lightBlockDeclarations(css: string, className: string): Map<string, string> {
  const opening = css.split("\n").findIndex((line) => line.trim() === `.${className} {`);
  if (opening < 0) throw new Error(`no light block for .${className}`);
  const declarations = new Map<string, string>();
  for (const raw of css.split("\n").slice(opening + 1)) {
    const line = raw.trim();
    if (line.startsWith("}")) break;
    const match = /^([\w-]+)\s*:\s*(.+?);$/.exec(line);
    if (match) declarations.set(match[1], match[2]);
  }
  return declarations;
}

const NAMED_PRESETS = THEME_PRESETS.filter((preset) => preset.id !== "default");

describe("a preset that names a typeface applies it on its own scope", () => {
  it.each(NAMED_PRESETS)("$id", ({ id, className }) => {
    const css = readFileSync(join(PRESETS_DIR, `${id}.css`), "utf-8");
    const block = lightBlockDeclarations(css, className);

    if (block.has("--stgm-font-sans")) {
      expect(block.get("font-family"), `${id} names a typeface, so its scope must use it`).toBe(
        "var(--stgm-font-sans)",
      );
    } else {
      expect(block.has("font-family"), `${id} names no typeface, so the host's stays`).toBe(false);
    }
  });

  it("covers the three presets that name one, so the rule is never vacuous", () => {
    const naming = NAMED_PRESETS.filter(({ id, className }) =>
      lightBlockDeclarations(readFileSync(join(PRESETS_DIR, `${id}.css`), "utf-8"), className).has(
        "--stgm-font-sans",
      ),
    ).map(({ id }) => id);

    expect(naming).toEqual(["corporate", "friendly", "fintech"]);
  });
});
