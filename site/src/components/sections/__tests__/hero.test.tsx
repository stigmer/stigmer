/**
 * The homepage's first screen: the headline and its two buttons over the
 * picture of Stigmer's panel inside a product. The picture is the page's
 * largest paint, so it loads eagerly, ahead of other images, and outside
 * every reveal; below the crop breakpoint the browser is offered the
 * panel's crop alone; and each pin layer and its list switch at that same
 * breakpoint, so a pin never shows over the crop it was not placed on.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SITE_CONFIG } from "@/lib/constants";
import { AGENT_GETS } from "@/lib/agent-gets";
import { screenSrcSet } from "@/lib/screens";
import { CROP_BREAKPOINT } from "@/components/visuals/ScreenPicture";
import { HERO_ALT, HERO_SCREEN, Hero } from "../Hero";

afterEach(cleanup);

function picture(): HTMLImageElement {
  return screen.getByRole("img", { name: HERO_ALT }) as HTMLImageElement;
}

describe("Hero", () => {
  it("heads the page with the headline and its two buttons", () => {
    render(<Hero />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(SITE_CONFIG.headline);
    expect(screen.getByRole("link", { name: /Start free/ }).getAttribute("href")).toBe(SITE_CONFIG.cloudSignupUrl);
    expect(screen.getByRole("link", { name: "Run the quickstart" }).getAttribute("href")).toBe(
      "/docs/getting-started/quickstart",
    );
  });

  it("loads the whole picture first: eager, at high priority, and outside every reveal", () => {
    const { container } = render(<Hero />);
    const img = picture();
    expect(img.getAttribute("src")).toBe(`/screens/${HERO_SCREEN.whole}-1x.webp`);
    expect(img.getAttribute("loading")).toBe("eager");
    expect(img.getAttribute("fetchpriority")).toBe("high");
    expect(img.closest("[data-reveal]")).toBeNull();
    expect(container.querySelector('[data-diagram="job-path"]')).toBeNull();
  });

  it("offers the panel's crop alone below the crop breakpoint", () => {
    render(<Hero />);
    const sources = picture().closest("picture")?.querySelectorAll("source") ?? [];
    expect(sources).toHaveLength(1);
    const [source] = sources;
    expect(source.getAttribute("media")).toBe(CROP_BREAKPOINT.media);
    expect(source.getAttribute("srcset")).toBe(screenSrcSet(HERO_SCREEN.panel));
    expect(source.getAttribute("srcset")).toContain(`/screens/${HERO_SCREEN.panel}-2x.webp`);
  });

  it("switches each pin layer and its list at the picture's breakpoint", () => {
    const { container } = render(<Hero />);
    const shownOn = (selector: string, on: string) => {
      const element = container.querySelector(`[${selector}="${on}"]`);
      expect(element, `${selector}="${on}"`).not.toBeNull();
      return element?.className.split(/\s+/) ?? [];
    };
    expect(shownOn("data-pins", HERO_SCREEN.panel)).toContain(CROP_BREAKPOINT.narrowOnly);
    expect(shownOn("data-pin-rail", HERO_SCREEN.panel)).toContain(CROP_BREAKPOINT.narrowOnly);
    expect(shownOn("data-pins", HERO_SCREEN.whole)).toContain(CROP_BREAKPOINT.wideOnly);
    expect(shownOn("data-pin-rail", HERO_SCREEN.whole)).toContain(CROP_BREAKPOINT.wideOnly);
  });

  it("pins only what the drawing proves, the panel's crop keeping the pin inside it", () => {
    const { container } = render(<Hero />);
    const pins = (on: string) =>
      [...container.querySelectorAll(`[data-pins="${on}"] [data-pin]`)].map((pin) => pin.getAttribute("data-pin"));
    expect(pins(HERO_SCREEN.whole)).toEqual(["asks-first", "walls"]);
    expect(pins(HERO_SCREEN.panel)).toEqual(["asks-first"]);
    expect(container.querySelector(`[data-pins="${HERO_SCREEN.whole}"]`)?.getAttribute("aria-hidden")).toBe("true");
  });

  it("lists what each pin says, linked to its proof further down", () => {
    const { container } = render(<Hero />);
    const rail = container.querySelector(`[data-pin-rail="${HERO_SCREEN.whole}"]`);
    const items = [...(rail?.querySelectorAll("a") ?? [])].map((link) => [link.textContent, link.getAttribute("href")]);
    expect(items).toEqual([
      [`1${AGENT_GETS["asks-first"].title}`, "#hard-parts-asks-first"],
      [`2${AGENT_GETS.walls.title}`, "#hard-parts-walls"],
    ]);
  });
});
