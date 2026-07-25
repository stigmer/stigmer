import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Hero } from "../welcome-hero";

/**
 * The Hero is the landing-page header for `hero: true` docs pages. Because the
 * default DocsTitle row is suppressed on those pages, the Hero owns the page's
 * `h1` — the heading-level assertion here is a real a11y/SEO contract, not a
 * styling detail.
 */
afterEach(() => {
  cleanup();
});

describe("Hero", () => {
  it("renders the title as the page h1", () => {
    render(<Hero eyebrow="Get started" title="Stigmer Documentation" />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Stigmer Documentation");
  });

  it("renders the eyebrow and description", () => {
    render(
      <Hero
        eyebrow="Get started"
        title="Stigmer Documentation"
        description="Build AI agents with Stigmer."
      />,
    );

    expect(screen.getByText("Get started")).toBeTruthy();
    expect(screen.getByText("Build AI agents with Stigmer.")).toBeTruthy();
  });

  it("mounts the media slot below the text block", () => {
    render(
      <Hero eyebrow="Get started" title="Stigmer Documentation">
        <figure aria-label="Product tour" />
      </Hero>,
    );

    expect(screen.getByRole("figure", { name: "Product tour" })).toBeTruthy();
  });

  it("renders without a description or media slot", () => {
    render(<Hero eyebrow="Get started" title="Stigmer Documentation" />);

    const header = screen.getByRole("banner");
    // Only the eyebrow and the h1 — no empty description/media wrappers.
    expect(header.children.length).toBe(2);
  });

  it("opts out of prose typography so DocsBody cannot restyle it", () => {
    render(<Hero eyebrow="Get started" title="Stigmer Documentation" />);

    expect(screen.getByRole("banner").className).toContain("not-prose");
  });
});
