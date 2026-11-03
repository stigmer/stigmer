/**
 * The code the theme playground hands a reader (../theme-snippet.mjs): the
 * preset's stylesheet and prop only for a preset, the colour mode always,
 * and a one-token stylesheet with its class only when the radius moves off
 * the preset's own. The docs' snippet check compiles the TypeScript for
 * every preset; this holds the text.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { THEME_PRESETS } from "@stigmer/design-tokens";
import { THEME_CLASS, themeSnippet } from "../theme-snippet.mjs";

describe("themeSnippet", () => {
  it("writes the default look with the tokens alone and the colour mode", () => {
    const { tsx, css } = themeSnippet({ preset: "default", mode: "dark", radius: null });
    expect(css).toBeNull();
    expect(tsx).toBe(
      [
        'import "@stigmer/design-tokens/tokens.css";',
        'import type { ReactNode } from "react";',
        'import type { Stigmer } from "@stigmer/client";',
        'import { StigmerProvider } from "@stigmer/react-sdk";',
        "",
        "export function Themed({ client, children }: { client: Stigmer; children: ReactNode }) {",
        "  return (",
        '    <StigmerProvider client={client} colorMode="dark">',
        "      {children}",
        "    </StigmerProvider>",
        "  );",
        "}",
        "",
      ].join("\n"),
    );
  });

  it("imports a preset's stylesheet and names it on the provider", () => {
    const { tsx } = themeSnippet({ preset: "fintech", mode: "light", radius: null });
    expect(tsx).toContain('import "@stigmer/design-tokens/presets/fintech.css";');
    expect(tsx).toContain('<StigmerProvider client={client} preset="fintech" colorMode="light">');
  });

  it("writes a radius off the preset's own as one token under its own class, imported and named", () => {
    const { tsx, css } = themeSnippet({ preset: "friendly", mode: "dark", radius: 0.75 });
    expect(css).toBe(`.${THEME_CLASS} {\n  --stgm-radius: 0.75rem;\n}\n`);
    expect(tsx).toContain('import "./my-theme.css";');
    expect(tsx).toContain(`<StigmerProvider client={client} preset="friendly" colorMode="dark" className="${THEME_CLASS}">`);
    expect(themeSnippet({ preset: "default", mode: "dark", radius: 0 }).css).toContain("--stgm-radius: 0rem;");
    expect(themeSnippet({ preset: "default", mode: "dark", radius: 0.125 }).css).toContain("--stgm-radius: 0.125rem;");
  });

  it("names, for every preset but the default, a stylesheet the theme package exports", () => {
    const pkg = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../../sdk/theme/package.json"), "utf8")) as { exports: Record<string, string> };
    for (const preset of THEME_PRESETS.filter((p) => p.id !== "default")) {
      const { tsx } = themeSnippet({ preset: preset.id, mode: "light", radius: null });
      const sheet = /presets\/([a-z]+)\.css/.exec(tsx)![1];
      expect(pkg.exports[`./presets/${sheet}.css`], preset.id).toBeDefined();
    }
  });
});
