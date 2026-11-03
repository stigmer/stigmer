/**
 * The homepage's first screen: the headline and its two buttons over the
 * five hard parts, named, and a picture of the product that steps through
 * one real moment of each.
 *
 * The ask is the page's largest paint: eager, ahead of other images, outside
 * every reveal, and beneath the others with no loop part of its own, so it
 * always shows. The other four load after it and carry their loop parts.
 * Every moment's whole picture is the ask's size and every crop is the
 * ask's crop's, so one covers another exactly; below the crop breakpoint
 * the browser is offered each moment's crop alone. The five names sit above
 * the picture in the five's order, each linking to its row in the section
 * below, and the pictures' descriptions come in the same order.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { SITE_CONFIG } from "@/lib/constants";
import { AGENT_GET_IDS } from "@/lib/agent-gets";
import { screenSrcSet, shownScreen, shownSize } from "@/lib/screens";
import { CROP_MEDIA } from "@/components/visuals/ScreenPicture";
import { HERO_BASE, HERO_LINK, HERO_MOMENTS, HERO_SCREENS, momentName } from "@/components/visuals/hero-moments";
import { HardParts } from "../HardParts";
import { Hero } from "../Hero";

afterEach(cleanup);

function picture(id: (typeof AGENT_GET_IDS)[number]): HTMLImageElement {
  return screen.getByRole("img", { name: HERO_MOMENTS[id].alt }) as HTMLImageElement;
}

const OTHERS = AGENT_GET_IDS.filter((id) => id !== HERO_BASE);

describe("Hero", () => {
  it("heads the page with the headline and its two buttons", () => {
    render(<Hero />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(SITE_CONFIG.headline);
    expect(screen.getByRole("link", { name: /Start free/ }).getAttribute("href")).toBe(SITE_CONFIG.cloudSignupUrl);
    expect(screen.getByRole("link", { name: "Run the quickstart" }).getAttribute("href")).toBe(
      "/docs/getting-started/quickstart",
    );
  });

  it("loads the ask first: eager, at high priority, outside every reveal, with no loop part, so it always shows", () => {
    const { container } = render(<Hero />);
    const img = picture(HERO_BASE);
    expect(img.getAttribute("src")).toBe(`/screens/${HERO_SCREENS[HERO_BASE].whole}-1x.webp`);
    expect(img.getAttribute("loading")).toBe("eager");
    expect(img.getAttribute("fetchpriority")).toBe("high");
    expect(img.closest("[data-reveal]")).toBeNull();
    expect(img.closest("[data-part]")).toBeNull();
    expect(container.querySelector('[data-diagram="job-path"]')).toBeNull();
  });

  it("loads the other four after it, lazily and at no priority, each shown by its own loop part", () => {
    render(<Hero />);
    for (const id of OTHERS) {
      const img = picture(id);
      expect(img.getAttribute("src"), id).toBe(`/screens/${HERO_SCREENS[id].whole}-1x.webp`);
      expect(img.getAttribute("loading"), id).toBe("lazy");
      expect(img.getAttribute("fetchpriority"), id).toBeNull();
      expect(img.closest("[data-part]")?.getAttribute("data-part"), id).toBe(id);
    }
  });

  it("holds the ask beneath the others by stacking order, with every picture in one cell", () => {
    render(<Hero />);
    const layers = AGENT_GET_IDS.map((id) => picture(id).closest("picture")!.parentElement!.parentElement!);
    const cell = layers[0].parentElement;
    for (const [index, id] of AGENT_GET_IDS.entries()) {
      expect(layers[index].parentElement, id).toBe(cell);
      expect(layers[index].className, id).toContain("col-start-1 row-start-1");
      expect(layers[index].className, id).toContain(id === HERO_BASE ? "z-0" : "z-10");
    }
  });

  it("draws every moment the ask's size, whole and cropped, so each covers the one beneath exactly", () => {
    const whole = shownSize(shownScreen(HERO_SCREENS[HERO_BASE].whole));
    const narrow = shownSize(shownScreen(HERO_SCREENS[HERO_BASE].narrow));
    for (const id of OTHERS) {
      expect(shownSize(shownScreen(HERO_SCREENS[id].whole)), id).toEqual(whole);
      expect(shownSize(shownScreen(HERO_SCREENS[id].narrow)), id).toEqual(narrow);
    }
  });

  it("offers each moment's crop alone below the crop breakpoint", () => {
    render(<Hero />);
    for (const id of AGENT_GET_IDS) {
      const sources = picture(id).closest("picture")?.querySelectorAll("source") ?? [];
      expect(sources, id).toHaveLength(1);
      expect(sources[0].getAttribute("media"), id).toBe(CROP_MEDIA);
      expect(sources[0].getAttribute("srcset"), id).toBe(screenSrcSet(HERO_SCREENS[id].narrow));
    }
  });

  it("describes the pictures in the five's order", () => {
    render(<Hero />);
    const alts = screen.getAllByRole("img").map((img) => img.getAttribute("alt"));
    expect(alts).toEqual(AGENT_GET_IDS.map((id) => HERO_MOMENTS[id].alt));
  });

  it("names the five above the picture, in the five's order, each linking to its row below", () => {
    render(<Hero />);
    const names = screen.getByRole("navigation", { name: "The five hard parts" });
    // Each name is read once: its lit copy is hidden from the reading order.
    const links = within(names).getAllByRole("link");
    expect(links).toEqual(AGENT_GET_IDS.map((id) => within(names).getByRole("link", { name: momentName(id) })));
    // Each to the row HardParts anchors for it, spelled here rather than read from the hero's own data.
    expect(links.map((link) => link.getAttribute("href"))).toEqual(AGENT_GET_IDS.map((id) => `#hard-parts-${id}`));
    expect(names.compareDocumentPosition(picture(HERO_BASE)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
    const { container } = render(<HardParts />);
    for (const id of AGENT_GET_IDS) expect(container.querySelector(`#hard-parts-${id}`), id).not.toBeNull();
  });

  it("lights each name and caption with its own moment, and keeps both out of the reading order", () => {
    render(<Hero />);
    const names = screen.getByRole("navigation", { name: "The five hard parts" });
    for (const id of AGENT_GET_IDS) {
      const lit = [...names.querySelectorAll(`[data-part="${id}"]`)];
      expect(lit.map((element) => element.textContent), id).toEqual([momentName(id), HERO_MOMENTS[id].caption]);
      for (const element of lit) expect(element.closest("[aria-hidden=true]"), id).not.toBeNull();
    }
  });

  it("points after the picture to the section that says all five", () => {
    render(<Hero />);
    const link = screen.getByRole("link", { name: HERO_LINK.text });
    expect(link.getAttribute("href")).toBe("#hard-parts");
    expect(picture(HERO_BASE).compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("pauses the walk and plays it again, its button the same either way", () => {
    const { container } = render(<Hero />);
    const button = screen.getByRole("button", { name: "Pause animation" });
    const figure = container.querySelector("[data-hero-moments]")!;
    expect([figure.getAttribute("data-paused"), button.getAttribute("aria-pressed")]).toEqual(["false", "false"]);
    fireEvent.click(button);
    expect([figure.getAttribute("data-paused"), button.getAttribute("aria-pressed")]).toEqual(["true", "true"]);
    fireEvent.click(button);
    expect(figure.getAttribute("data-paused")).toBe("false");
  });
});
