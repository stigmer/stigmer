// @vitest-environment node
// ---------------------------------------------------------------------------
// fonts — the site's type resolves to the brand's three faces
//
// Two quiet failures this guards. A font token named outside Tailwind 4's
// `--font-*` namespace (the site's `--font-family-*` until M7) compiles to
// nothing, and every page renders in the visitor's system font while the
// brand's files still download. And a loader whose variable nothing reads,
// or a token naming a variable no loader defines, falls back the same way.
// So the cases compile globals.css with Tailwind's own compiler and read the
// font stacks it emits, check every variable a stack names has a loader, and
// hold each loader to its face in brand/type.ts and its file in brand/fonts/.
// Where the layout puts the variables is pinned in layout.test.ts.
// `next/font/local` is a build-time transform, so the mock hands back the
// options each loader was called with.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { compile } from "@tailwindcss/node";
import { TYPE, type TypeRole } from "../../../../brand/type";

interface LocalFontCall {
  readonly src: string;
  readonly variable: string;
  readonly weight: string;
}

vi.mock("next/font/local", () => ({
  default: (options: LocalFontCall) => ({ ...options, className: "", style: {} }),
}));

import { siteFonts } from "../fonts";

// Vitest runs with cwd at the site's root.
const APP_DIR = resolve(process.cwd(), "src", "app");
const BRAND_FONTS = resolve(process.cwd(), "..", "brand", "fonts");
const calls = siteFonts as unknown as readonly LocalFontCall[];

/** The `font-family` each font utility compiles to, from the real globals.css. */
async function compiledStacks(): Promise<Record<string, string>> {
  const css = readFileSync(join(APP_DIR, "globals.css"), "utf8");
  const compiler = await compile(css, { base: APP_DIR, onDependency: () => {} });
  const utilities = ["font-sans", "font-mono", "font-display"];
  const output = compiler.build(utilities);
  return Object.fromEntries(
    utilities.map((utility) => {
      const rule = output.match(new RegExp(`\\.${utility}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      return [utility, rule.match(/font-family:\s*([^;]+);?/)?.[1]?.trim() ?? ""];
    }),
  );
}

/** The loader variable a stack falls back through first. */
function firstVariable(stack: string): string | undefined {
  return stack.match(/^var\(\s*(--font-[\w-]+)\s*\)/)?.[1];
}

/** The loader that sets each role, found by the face's file. */
function loaderFor(role: TypeRole): LocalFontCall | undefined {
  return calls.find((font) => basename(font.src) === TYPE[role].file);
}

describe("the site's type", () => {
  it("compiles each font utility to the stack its loader leads", async () => {
    const stacks = await compiledStacks();

    expect(firstVariable(stacks["font-sans"]), stacks["font-sans"]).toBe(loaderFor("sans")?.variable);
    expect(firstVariable(stacks["font-mono"]), stacks["font-mono"]).toBe(loaderFor("mono")?.variable);
    expect(firstVariable(stacks["font-display"]), stacks["font-display"]).toBe(
      loaderFor("display")?.variable,
    );
    // Display falls back to the body face before the system font, so the
    // headlines never drop to a third face while Instrument Sans loads.
    expect(stacks["font-display"]).toContain(`var(${loaderFor("sans")?.variable})`);
  });

  it("defines every font variable globals.css names", () => {
    const css = readFileSync(join(APP_DIR, "globals.css"), "utf8");
    const named = new Set([...css.matchAll(/var\(\s*(--font-(?:geist|instrument)[\w-]*)/g)].map((m) => m[1]));
    const provided = new Set(calls.map((font) => font.variable));

    expect(named.size, "globals.css names the loaders' variables").toBeGreaterThan(0);
    expect([...named].filter((variable) => !provided.has(variable))).toEqual([]);
  });

  it("keeps the product theme's variable names for Geist", () => {
    // sdk/theme/src/tokens.css falls back through these, so the product
    // components the site shows resolve to Geist as they do in the console.
    expect(loaderFor("sans")?.variable).toBe("--font-geist-sans");
    expect(loaderFor("mono")?.variable).toBe("--font-geist-mono");
  });

  it("loads exactly the brand's three faces, each from its file in brand/fonts", () => {
    const roles = Object.keys(TYPE) as TypeRole[];

    expect(calls.map((font) => basename(font.src)).sort()).toEqual(
      roles.map((role) => TYPE[role].file).sort(),
    );
    for (const role of roles) {
      const font = loaderFor(role);
      expect(font && resolve(APP_DIR, font.src), role).toBe(join(BRAND_FONTS, TYPE[role].file));
      expect(font?.weight, role).toBe(TYPE[role].weights.join(" "));
      expect(existsSync(join(BRAND_FONTS, TYPE[role].file)), TYPE[role].file).toBe(true);
    }
  });

  it("gives each loader its own variable", () => {
    const variables = calls.map((font) => font.variable);
    expect(new Set(variables).size).toBe(variables.length);
  });
});
