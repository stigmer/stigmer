// @vitest-environment node
/**
 * Every colour a code example can draw on the dark site is readable on the
 * ground it sits on (stigmer#2902).
 *
 * The site highlights code with github-dark, whose comment colour fails
 * WCAG AA on the site's code grounds; `CODE_HIGHLIGHT` replaces it. These
 * cases load the theme through fumadocs' own highlighter (the one the site
 * renders with), apply the replacements as Shiki does, and hold every token
 * foreground that sets no background of its own to 4.5:1 on both code
 * grounds, read from `globals.css` so a palette change is judged again: the
 * card ground every block sits on, and the secondary ground a code group's
 * blocks sit on. A last case highlights a commented line with these exact
 * options and finds the replacement in the output, so the options reach
 * Shiki as written. Node, not happy-dom: Shiki's regex engine loads
 * WebAssembly.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { getHighlighter, highlightHast } from "fumadocs-core/highlight";
import { CODE_HIGHLIGHT } from "../code-highlight";

/** WCAG 2's minimum contrast for normal text (AA). */
const AA_TEXT = 4.5;

type Rgb = readonly [number, number, number];

// Vitest runs with cwd at the site's root.
const GLOBALS = readFileSync(resolve(process.cwd(), "src", "app", "globals.css"), "utf8");

/** A `--color-fd-*` token of globals.css, which declares each code ground as `hsl(0 0% L%)`. */
function ground(token: string): Rgb {
  const match = new RegExp(`--${token}:\\s*hsl\\((\\d+(?:\\.\\d+)?)\\s+(\\d+(?:\\.\\d+)?)%\\s+(\\d+(?:\\.\\d+)?)%\\)`).exec(GLOBALS);
  if (!match) throw new Error(`globals.css declares no opaque hsl() --${token}`);
  const [h, s, l] = [Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100];
  const a = s * Math.min(l, 1 - l);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return [channel(0), channel(8), channel(4)];
}

/** A `#rgb`, `#rrggbb` or `#rrggbbaa` colour, any alpha composited over the ground. */
function over(hex: string, base: Rgb): Rgb {
  const digits = hex.slice(1);
  const full = digits.length <= 4 ? [...digits].map((d) => d + d).join("") : digits;
  const [r, g, b, alpha] = [0, 2, 4, 6].map((i) => (i < full.length ? parseInt(full.slice(i, i + 2), 16) : 255));
  const t = alpha / 255;
  return [r * t + base[0] * (1 - t), g * t + base[1] * (1 - t), b * t + base[2] * (1 - t)];
}

/** WCAG 2 relative luminance. */
function luminance([r, g, b]: Rgb): number {
  const linear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2 contrast ratio of two opaque colours. */
function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const GROUNDS = {
  "--color-fd-card": ground("color-fd-card"),
  "--color-fd-secondary": ground("color-fd-secondary"),
};

describe("the site's code colours", () => {
  it("draws every dark-theme token foreground at AA contrast on both code grounds", async () => {
    const name = CODE_HIGHLIGHT.themes.dark;
    const highlighter = await getHighlighter("oniguruma", { langs: [], themes: [name] });
    const theme = highlighter.getTheme(name);
    const replacements: Record<string, string> = { ...theme.colorReplacements, ...CODE_HIGHLIGHT.colorReplacements[name] };
    const drawn = (color: string) => replacements[color.toLowerCase()] ?? color;

    const foregrounds = new Set(
      [theme.fg, ...theme.settings.filter((rule) => !rule.settings.background).map((rule) => rule.settings.foreground)]
        .filter((color): color is string => typeof color === "string")
        .map((color) => color.toLowerCase()),
    );
    expect(foregrounds.size).toBeGreaterThan(5);

    const failing = [...foregrounds].flatMap((color) =>
      Object.entries(GROUNDS)
        .map(([token, base]) => ({ token, ratio: contrast(over(drawn(color), base), base) }))
        .filter(({ ratio }) => ratio < AA_TEXT)
        .map(({ token, ratio }) => `${color} (drawn ${drawn(color)}) on ${token}: ${ratio.toFixed(2)}:1`),
    );
    expect(failing, `${name} foregrounds under ${AA_TEXT}:1:\n${failing.join("\n")}`).toEqual([]);
  });

  it("hands the replacement to Shiki through the options the site highlights with", async () => {
    const hast = await highlightHast("# install the CLI", { lang: "bash", ...CODE_HIGHLIGHT });
    const styles = JSON.stringify(hast).toLowerCase();
    expect(styles).toContain("--shiki-dark:#8b949e");
    expect(styles).not.toContain("--shiki-dark:#6a737d");
  });
});
