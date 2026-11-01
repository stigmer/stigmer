/**
 * The console's root layout: what a browser tab and a shared link show for
 * every console page that sets no title of its own, and where the typefaces'
 * variables are defined.
 *
 * Pins that the tab names the app and that the description is the one
 * sentence from brand/positioning.ts, which the website reads too, so the
 * console never carries a hand-kept copy of the site's words.
 *
 * Pins that every font loader's variable class sits on `<html>`, not
 * `<body>`. The theme's font stacks (`--stgm-font-sans` in
 * `sdk/theme/src/tokens.css`) are declared on `:root` and resolve there, so
 * the `--font-*` variable they fall back through must be defined on that same
 * element; defined on `<body>` it comes too late, and every page renders in
 * the computer's own font while the console's files download unused
 * (stigmer#1564).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { POSITIONING } from "../../../../../brand/positioning";

vi.mock("@/providers/Providers", () => ({ Providers: () => null }));
vi.mock("@/domain/_shared/layout/AppShell", () => ({ AppShell: () => null }));
vi.mock("@/domain/_shared/navigation/app-navigation", () => ({ AppNavigationProvider: () => null }));
vi.mock("@/domain/session/session-navigation", () => ({ SessionNavigationProvider: () => null }));
vi.mock("../fonts/fonts", () => ({ consoleFonts: [{ variable: "font-a" }, { variable: "font-b" }] }));

describe("the console's root metadata", () => {
  it("names the app in the tab and describes it in the one sentence", async () => {
    const { metadata } = await import("../layout");

    expect(metadata.title).toBe("Stigmer");
    expect(metadata.description).toBe(POSITIONING.oneSentence);
  });
});

describe("the console's root element", () => {
  it("defines every font variable on <html>, where the theme's font stacks resolve", async () => {
    const { default: RootLayout } = await import("../layout");
    const html = renderToStaticMarkup(RootLayout({ children: null }));
    const classesOf = (tag: string): string[] =>
      (html.match(new RegExp(`<${tag}\\b[^>]*\\bclass="([^"]*)"`))?.[1] ?? "").split(/\s+/).filter(Boolean);

    expect(classesOf("html")).toEqual(expect.arrayContaining(["font-a", "font-b"]));
    expect(classesOf("body")).not.toContain("font-a");
    expect(classesOf("body")).not.toContain("font-b");
  });
});
