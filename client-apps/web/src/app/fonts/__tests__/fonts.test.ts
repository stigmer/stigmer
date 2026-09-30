// ---------------------------------------------------------------------------
// fonts — the console provides every font the theme names, from files it ships
//
// The theme's font stacks fall back through `--font-*` variables
// (`var(--font-inter, "Inter", system-ui, sans-serif)`) that only the host
// defines. A preset whose variable no loader defines silently renders in the
// system font, and a loader whose file is missing fails only at `next build`.
// These cases catch both in seconds: every `var(--font-*)` in the theme CSS
// the console imports has a loader, and every loader's file is on disk.
// `next/font/local` is a build-time transform, so the mock hands back the
// options each loader was called with.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

interface LocalFontCall {
  readonly src: string | readonly { readonly path: string }[];
  readonly variable: string;
}

vi.mock("next/font/local", () => ({
  default: (options: LocalFontCall) => ({
    ...options,
    className: "",
    style: {},
  }),
}));

import { consoleFonts } from "../fonts";

// Vitest runs with cwd at the workspace root (client-apps/web); happy-dom
// rewrites module URLs to a non-file scheme, so paths resolve from cwd.
const APP_DIR = resolve(process.cwd(), "src", "app");
const FONTS_DIR = join(APP_DIR, "fonts");
const requireFromConsole = createRequire(join(process.cwd(), "package.json"));

/** The `@stigmer/theme` stylesheets `globals.css` imports, resolved to files. */
function themeStylesheets(): string[] {
  const globals = readFileSync(join(APP_DIR, "globals.css"), "utf8");
  const specifiers = [
    ...globals.matchAll(/@import\s+"(@stigmer\/theme\/[^"]+\.css)"/g),
  ].map((m) => m[1]);
  return specifiers.map((specifier) => requireFromConsole.resolve(specifier));
}

function fontVariablesNamedBy(css: string): string[] {
  return [...css.matchAll(/var\(\s*(--font-[\w-]+)/g)].map((m) => m[1]);
}

function sourcePaths(src: LocalFontCall["src"]): string[] {
  return typeof src === "string" ? [src] : src.map((file) => file.path);
}

const calls = consoleFonts as unknown as readonly LocalFontCall[];

describe("the console's fonts", () => {
  it("defines every font variable the imported theme stylesheets fall back through", () => {
    const stylesheets = themeStylesheets();
    expect(
      stylesheets.length,
      "globals.css imports the theme's tokens and presets",
    ).toBeGreaterThan(1);

    const named = new Set(
      stylesheets.flatMap((file) =>
        fontVariablesNamedBy(readFileSync(file, "utf8")),
      ),
    );
    const provided = new Set(calls.map((font) => font.variable));
    const missing = [...named].filter((variable) => !provided.has(variable));

    expect(
      named.size,
      "the theme names at least the default stack's variables",
    ).toBeGreaterThan(0);
    expect(
      missing,
      "theme font variables no loader in fonts.ts defines",
    ).toEqual([]);
  });

  it("gives each loader its own variable", () => {
    const variables = calls.map((font) => font.variable);
    expect(new Set(variables).size).toBe(variables.length);
  });

  it("ships every file a loader names", () => {
    const missing = calls
      .flatMap((font) => sourcePaths(font.src))
      .filter((path) => !existsSync(join(FONTS_DIR, path)));
    expect(
      missing,
      "font files named in fonts.ts but absent from src/app/fonts",
    ).toEqual([]);
  });
});
