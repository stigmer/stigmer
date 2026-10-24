/**
 * The reveal wrappers and the hero render the same markup whatever the
 * visitor's motion preference.
 *
 * The site is a static export: its HTML is rendered once, without the
 * preference, and React keeps the server's attributes when it hydrates. When
 * the wrappers rendered a plain div under reduced motion, the exported
 * `opacity:0` stayed on the page and every section below the header was
 * blank, and the hero's card rendered another tree, which failed hydration.
 * So the preference never changes markup: the stylesheet, not the render,
 * keeps reveals visible and the hero's picture still.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "react-dom/server";
import { FadeIn, FadeInUp, ScaleIn, StaggerContainer, StaggerItem } from "../motion";
import { Hero } from "@/components/sections/Hero";

let reduceMotion = false;
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useReducedMotion: () => reduceMotion,
}));

function markup(reduce: boolean, element: React.ReactElement): string {
  reduceMotion = reduce;
  return renderToString(element);
}

const REVEALS = (
  <>
    <FadeInUp>up</FadeInUp>
    <FadeIn>in</FadeIn>
    <ScaleIn>scale</ScaleIn>
    <StaggerContainer>
      <StaggerItem>item</StaggerItem>
    </StaggerContainer>
  </>
);

describe("motion and the motion preference", () => {
  it("renders the reveal wrappers the same with reduced motion on or off", () => {
    const html = markup(false, REVEALS);

    expect(markup(true, REVEALS)).toBe(html);
    expect(html.match(/data-reveal/g)).toHaveLength(5);
  });

  it("renders the hero the same with reduced motion on or off", () => {
    expect(markup(true, <Hero />)).toBe(markup(false, <Hero />));
  });

  it("keeps every reveal visible and still in the stylesheet when motion is reduced", () => {
    const css = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../app/globals.css"),
      "utf8",
    );
    const reduced = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/g) ?? [];
    const rule = reduced.join("\n").match(/\[data-reveal\][^{]*\{([^}]*)\}/)?.[1] ?? "";

    expect(rule).toMatch(/opacity:\s*1\s*!important/);
    expect(rule).toMatch(/transform:\s*none\s*!important/);
  });
});
