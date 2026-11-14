/**
 * The homepage's first screen: the headline and its two buttons over the
 * five hard parts, as tabs above a picture of the product that shows a real
 * moment of each, with the worry it answers and what it proves.
 *
 * The ask is the page's largest paint: eager, ahead of other images, outside
 * every reveal, and beneath the others with no fade of its own, so it always
 * shows. The other four load after it. Every moment's whole picture is the
 * ask's size and every crop is the ask's crop's, so one covers another
 * exactly; below the crop breakpoint the browser is offered each moment's
 * crop alone. The tabs sit above the picture in the five's order; only the
 * chosen moment's words and picture are read. The hero steps by itself once
 * the page wakes, unless the visitor asked for less motion; pointing at it,
 * focusing in it or its pause button holds it, and choosing a moment stops
 * it for good.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { SITE_CONFIG } from "@/lib/constants";
import { AGENT_GET_IDS, type AgentGetId } from "@/lib/agent-gets";
import { screenSrcSet, shownScreen, shownSize } from "@/lib/screens";
import { CROP_MEDIA } from "@/components/visuals/ScreenPicture";
import { HERO_BASE, HERO_MOMENTS, HERO_SCREENS, momentName, momentWorry } from "@/components/visuals/hero-moments";
import { HardParts } from "../HardParts";
import { Hero } from "../Hero";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The visitor's motion preference, as the browser answers it. */
function preferReducedMotion(reduce: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query === "(prefers-reduced-motion: reduce)",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

/** A moment's picture, read or not. */
function picture(container: HTMLElement, id: AgentGetId): HTMLImageElement {
  const img = [...container.querySelectorAll("img")].find((candidate) => candidate.getAttribute("alt") === HERO_MOMENTS[id].alt);
  if (!img) throw new Error(`no picture for ${id}`);
  return img;
}

/** The layer a moment's picture sits in. */
function layer(container: HTMLElement, id: AgentGetId): HTMLElement {
  return container.querySelector(`[data-moment="${id}"]`) as HTMLElement;
}

function tab(id: AgentGetId): HTMLElement {
  return screen.getByRole("tab", { name: momentName(id) });
}

/** The words shown for the chosen moment: its worry, its answer and its link. */
function shownWords(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-moment-words]")]
    .filter((words) => !words.className.includes("invisible"))
    .map((words) => words.getAttribute("data-moment-words")!);
}

function progress(container: HTMLElement): Element | null {
  return container.querySelector("[data-hero-moments-progress]");
}

describe("Hero", () => {
  it("heads the page with the headline and its two buttons", () => {
    render(<Hero />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(SITE_CONFIG.headline);
    // The newcomer's first click opens the console's create-account screen,
    // not its sign-in page: pinned to the address, not to the constant.
    expect(screen.getByRole("link", { name: /Start free/ }).getAttribute("href")).toBe(
      "https://app.stigmer.ai/login?signup=1",
    );
    expect(screen.getByRole("link", { name: "Run the quickstart" }).getAttribute("href")).toBe(
      "/docs/getting-started/quickstart",
    );
  });

  it("offers a third door, for people who hand setup to their coding agent", () => {
    render(<Hero />);
    expect(screen.getByRole("link", { name: "Let your coding agent set it up" }).getAttribute("href")).toBe(
      "/docs/getting-started/coding-agent",
    );
  });

  it("loads the ask first: eager, at high priority, outside every reveal, never faded, so it always shows", () => {
    const { container } = render(<Hero />);
    const img = picture(container, HERO_BASE);
    expect(img.getAttribute("src")).toBe(`/screens/${HERO_SCREENS[HERO_BASE].whole}-1x.webp`);
    expect(img.getAttribute("loading")).toBe("eager");
    expect(img.getAttribute("fetchpriority")).toBe("high");
    expect(img.closest("[data-reveal]")).toBeNull();
    expect(img.closest("[data-hero-moments-picture]")).toBeNull();
    expect(container.querySelector('[data-diagram="job-path"]')).toBeNull();
  });

  it("loads the other four after it, lazily and at no priority, each in a layer that fades", () => {
    const { container } = render(<Hero />);
    for (const id of AGENT_GET_IDS.filter((other) => other !== HERO_BASE)) {
      const img = picture(container, id);
      expect(img.getAttribute("src"), id).toBe(`/screens/${HERO_SCREENS[id].whole}-1x.webp`);
      expect(img.getAttribute("loading"), id).toBe("lazy");
      expect(img.getAttribute("fetchpriority"), id).toBeNull();
      expect(img.closest("[data-hero-moments-picture]"), id).toBe(layer(container, id));
    }
  });

  it("holds the ask beneath the others in one cell, the chosen one on top and the rest hidden", () => {
    const { container } = render(<Hero />);
    const cell = layer(container, HERO_BASE).parentElement;
    for (const id of AGENT_GET_IDS) {
      expect(layer(container, id).parentElement, id).toBe(cell);
      expect(layer(container, id).className, id).toContain("col-start-1 row-start-1");
    }
    expect(layer(container, HERO_BASE).className).toContain("z-0");
    fireEvent.click(tab("walls"));
    expect(layer(container, "walls").className).toContain("z-20 opacity-100");
    expect(layer(container, "keys").className).toContain("z-10 opacity-0");
    expect(layer(container, HERO_BASE).className).not.toContain("opacity-0");
  });

  it("draws every moment the ask's size, whole and cropped, so each covers the one beneath exactly", () => {
    const whole = shownSize(shownScreen(HERO_SCREENS[HERO_BASE].whole));
    const narrow = shownSize(shownScreen(HERO_SCREENS[HERO_BASE].narrow));
    for (const id of AGENT_GET_IDS.filter((other) => other !== HERO_BASE)) {
      expect(shownSize(shownScreen(HERO_SCREENS[id].whole)), id).toEqual(whole);
      expect(shownSize(shownScreen(HERO_SCREENS[id].narrow)), id).toEqual(narrow);
    }
  });

  it("offers each moment's crop alone below the crop breakpoint", () => {
    const { container } = render(<Hero />);
    for (const id of AGENT_GET_IDS) {
      const sources = picture(container, id).closest("picture")?.querySelectorAll("source") ?? [];
      expect(sources, id).toHaveLength(1);
      expect(sources[0].getAttribute("media"), id).toBe(CROP_MEDIA);
      expect(sources[0].getAttribute("srcset"), id).toBe(screenSrcSet(HERO_SCREENS[id].narrow));
    }
  });

  it("names the five as tabs above the picture, in the five's order, the ask chosen first", () => {
    const { container } = render(<Hero />);
    const list = screen.getByRole("tablist", { name: "The five hard parts" });
    const tabs = within(list).getAllByRole("tab");
    expect(tabs).toEqual(AGENT_GET_IDS.map((id) => tab(id)));
    expect(tabs.map((element) => element.getAttribute("aria-selected"))).toEqual(AGENT_GET_IDS.map((id) => String(id === HERO_BASE)));
    expect(tabs.map((element) => element.tabIndex)).toEqual(AGENT_GET_IDS.map((id) => (id === HERO_BASE ? 0 : -1)));
    const panel = screen.getByRole("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe(tab(HERO_BASE).id);
    expect(list.compareDocumentPosition(picture(container, HERO_BASE)) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("says the chosen moment's problem, then what its picture proves, and links to its row below", () => {
    const { container } = render(<Hero />);
    expect(shownWords(container)).toEqual([HERO_BASE]);
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText(momentWorry(HERO_BASE))).toBeTruthy();
    const link = within(panel).getByRole("link", { name: "See the proof" });
    // Each to the row HardParts anchors for it, spelled here rather than read from the hero's own data.
    expect(link.getAttribute("href")).toBe(`#hard-parts-${HERO_BASE}`);
    expect(link.parentElement?.textContent).toBe(`${HERO_MOMENTS[HERO_BASE].answer} See the proof`);
    for (const id of AGENT_GET_IDS) {
      const words = container.querySelector(`[data-moment-words="${id}"]`)!;
      expect(within(words as HTMLElement).getByText(momentWorry(id)), id).toBeTruthy();
      expect(words.querySelector("a")?.getAttribute("href"), id).toBe(`#hard-parts-${id}`);
    }
    cleanup();
    const { container: section } = render(<HardParts />);
    for (const id of AGENT_GET_IDS) expect(section.querySelector(`#hard-parts-${id}`), id).not.toBeNull();
  });

  it("reads only the chosen moment's picture, in the five's order as they are chosen", () => {
    const { container } = render(<Hero />);
    expect(screen.getAllByRole("img").map((img) => img.getAttribute("alt"))).toEqual([HERO_MOMENTS[HERO_BASE].alt]);
    expect([...container.querySelectorAll("img")].map((img) => img.getAttribute("alt"))).toEqual(
      AGENT_GET_IDS.map((id) => HERO_MOMENTS[id].alt),
    );
    fireEvent.click(tab("keys"));
    expect(screen.getAllByRole("img").map((img) => img.getAttribute("alt"))).toEqual([HERO_MOMENTS.keys.alt]);
  });

  it("shows a moment when its tab is chosen, and stops stepping for good", () => {
    preferReducedMotion(false);
    const { container } = render(<Hero />);
    expect(progress(container)).not.toBeNull();
    fireEvent.click(tab("walls"));
    expect(tab("walls").getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tab("walls").id);
    expect(shownWords(container)).toEqual(["walls"]);
    expect(progress(container)).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause animation" })).toBeNull();
  });

  it("moves between the tabs with the arrow keys, Home and End, round at either end", () => {
    render(<Hero />);
    const list = screen.getByRole("tablist");
    fireEvent.keyDown(list, { key: "ArrowRight" });
    expect(document.activeElement).toBe(tab("walls"));
    expect(tab("walls").getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(list, { key: "Home" });
    expect(document.activeElement).toBe(tab("own-computer"));
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(tab("keys"));
    fireEvent.keyDown(list, { key: "End" });
    expect(tab("keys").getAttribute("aria-selected")).toBe("true");
    // Any other key is the page's, and moves nothing.
    fireEvent.keyDown(list, { key: "a" });
    expect(tab("keys").getAttribute("aria-selected")).toBe("true");
  });

  it("steps to the next moment when the lit name's line has filled, and fills it again", () => {
    preferReducedMotion(false);
    const { container } = render(<Hero />);
    const line = progress(container)!;
    expect(tab(HERO_BASE).contains(line)).toBe(true);
    fireEvent.animationEnd(line);
    expect(tab("walls").getAttribute("aria-selected")).toBe("true");
    expect(shownWords(container)).toEqual(["walls"]);
    expect(tab("walls").contains(progress(container))).toBe(true);
  });

  it("holds the moment while the visitor points at it, focuses in it, or pauses it", () => {
    preferReducedMotion(false);
    const { container } = render(<Hero />);
    const hero = container.querySelector("[data-hero-moments]")!;
    expect(hero.getAttribute("data-held")).toBe("false");
    fireEvent.pointerOver(hero);
    expect(hero.getAttribute("data-held")).toBe("true");
    fireEvent.pointerOut(hero);
    expect(hero.getAttribute("data-held")).toBe("false");
    const pause = screen.getByRole("button", { name: "Pause animation" });
    fireEvent.click(pause);
    expect([hero.getAttribute("data-held"), pause.getAttribute("aria-pressed")]).toEqual(["true", "true"]);
    fireEvent.click(pause);
    expect(pause.getAttribute("aria-pressed")).toBe("false");
    const proof = screen.getByRole("link", { name: "See the proof" });
    fireEvent.focus(proof);
    expect(hero.getAttribute("data-held")).toBe("true");
    // Focus moving within the hero keeps it held; leaving it lets it go.
    fireEvent.blur(proof, { relatedTarget: tab("hours") });
    expect(hero.getAttribute("data-held")).toBe("true");
    fireEvent.blur(proof, { relatedTarget: document.body });
    expect(hero.getAttribute("data-held")).toBe("false");
  });

  it("renders the ask, not stepping, before the page wakes, so the exported page and the woken one agree", () => {
    preferReducedMotion(false);
    const html = renderToString(<Hero />);
    // The attribute on an element, not the stylesheet's selector for it.
    expect(html).not.toContain('data-hero-moments-progress=""');
    expect(html).not.toContain("Pause animation");
    expect(html).toMatch(/aria-selected="true"[^>]*id="hero-moments-tab-asks-first"|id="hero-moments-tab-asks-first"[^>]*aria-selected="true"/);
  });

  it("never steps when the visitor asked for less motion, and the tabs still work", () => {
    preferReducedMotion(true);
    const { container } = render(<Hero />);
    expect(progress(container)).toBeNull();
    expect(screen.queryByRole("button", { name: "Pause animation" })).toBeNull();
    expect(shownWords(container)).toEqual([HERO_BASE]);
    fireEvent.click(tab("hours"));
    expect(shownWords(container)).toEqual(["hours"]);
  });
});
