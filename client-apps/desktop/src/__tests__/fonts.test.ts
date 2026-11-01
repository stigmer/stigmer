/**
 * The desktop app draws the console's own typefaces, as the web console and
 * the gallery do (stigmer#1564). The theme's font stacks fall back through
 * `--font-*` variables only a host defines; a variable the app leaves
 * undefined silently renders the system font, and a missing file fails only
 * in the built app. These cases catch both: every `var(--font-*)` in the
 * theme stylesheets `globals.css` imports is defined on `:root` by
 * `fonts.css`, each face's file is on disk, and the entry imports it.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

// Vitest runs with cwd at the app's root (client-apps/desktop).
const SRC_DIR = resolve(process.cwd(), "src");
const FONTS_CSS = join(SRC_DIR, "fonts.css");
const requireFromApp = createRequire(join(process.cwd(), "package.json"));

function themeStylesheets(): string[] {
  const globals = readFileSync(join(SRC_DIR, "globals.css"), "utf8");
  return [...globals.matchAll(/@import\s+"(@stigmer\/design-tokens\/[^"]+\.css)"/g)].map((m) =>
    requireFromApp.resolve(m[1]),
  );
}

describe("the desktop app's fonts", () => {
  const css = readFileSync(FONTS_CSS, "utf8");
  const root = /:root\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";

  it("defines on :root every font variable the imported theme stylesheets fall back through", () => {
    const named = new Set(themeStylesheets().flatMap((file) => [...readFileSync(file, "utf8").matchAll(/var\(\s*(--font-[\w-]+)/g)].map((m) => m[1])));
    expect(named.size).toBeGreaterThan(0);
    for (const variable of named) {
      expect(root, `fonts.css defines no ${variable} on :root`).toMatch(new RegExp(`${variable}\\s*:`));
    }
  });

  it("loads every face from a file on disk", () => {
    const urls = [...css.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(existsSync(resolve(dirname(FONTS_CSS), url)), `${url} is missing`).toBe(true);
    }
  });

  it("is imported by the app's entry", () => {
    expect(readFileSync(join(SRC_DIR, "main.tsx"), "utf8")).toMatch(/import "\.\/fonts\.css";/);
  });
});
