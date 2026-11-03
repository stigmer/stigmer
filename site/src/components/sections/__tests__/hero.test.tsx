/**
 * The homepage's first screen: the headline and its two buttons over the
 * picture of Stigmer's panel inside a product. The picture is the page's
 * largest paint, so it loads eagerly, ahead of other images, and outside
 * every reveal; below the crop breakpoint the browser is offered the
 * panel's crop alone. The picture shows two of the five things every
 * customer's agent needs, so it singles out none: nothing is laid over it,
 * and one line under it points to the section where all five are said.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SITE_CONFIG } from "@/lib/constants";
import { screenSrcSet } from "@/lib/screens";
import { CROP_MEDIA } from "@/components/visuals/ScreenPicture";
import { HardParts } from "../HardParts";
import { HERO_ALT, HERO_LINE, HERO_SCREEN, Hero } from "../Hero";

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
    expect(source.getAttribute("media")).toBe(CROP_MEDIA);
    expect(source.getAttribute("srcset")).toBe(screenSrcSet(HERO_SCREEN.panel));
    expect(source.getAttribute("srcset")).toContain(`/screens/${HERO_SCREEN.panel}-2x.webp`);
  });

  it("lays nothing over the picture, so it singles out none of the five", () => {
    render(<Hero />);
    const frame = picture().closest("picture")?.parentElement;
    expect([...(frame?.children ?? [])].map((child) => child.tagName)).toEqual(["PICTURE"]);
  });

  it("points under the picture to the section that says all five", () => {
    render(<Hero />);
    const link = screen.getByRole("link", { name: HERO_LINE.link });
    expect(link.getAttribute("href")).toBe("#hard-parts");
    expect(link.parentElement?.textContent).toBe(`${HERO_LINE.lead} ${HERO_LINE.link}`);
    cleanup();
    const { container } = render(<HardParts />);
    expect(container.querySelector("#hard-parts")).not.toBeNull();
  });
});
