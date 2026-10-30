/**
 * The homepage, and where the site's story pages send a reader.
 *
 * Pins that the homepage leads with the headline from brand/positioning.ts
 * and tells the story in its order: the problem, what each customer's agent
 * gets, how it fits, open source, the first job.
 *
 * Pins too that every internal link on the homepage, the page on why we
 * built Stigmer and the comparison lands on a path the site serves, never on
 * one the redirect file moved or one that no longer exists: the homepage
 * once linked four Getting Started pages that only redirects still answered.
 * Each page renders the footer, so each always has links to check.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SITE_CONFIG } from "@/lib/constants";
import { servedPath } from "@/__test-utils__/site-paths";
import { HomePage } from "../HomePage";
import { AboutPage } from "../AboutPage";
import { CompareManagedAgentsPage } from "../CompareManagedAgentsPage";

afterEach(cleanup);

describe("HomePage", () => {
  it("leads with the headline and tells the story in order", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(SITE_CONFIG.headline);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.id);
    expect(headings).toEqual([
      "problem-heading",
      "what-each-agent-gets-heading",
      "how-it-fits-heading",
      "open-source-heading",
      "final-cta-heading",
    ]);
  });

  it.each([
    ["the homepage", HomePage],
    ["the page on why we built Stigmer", AboutPage],
    ["the comparison", CompareManagedAgentsPage],
  ])("sends every internal link on %s to a path the site serves", (_, Page) => {
    const { container } = render(<Page />);
    const internal = [...container.querySelectorAll("a")]
      .map((link) => link.getAttribute("href") ?? "")
      .filter((href) => href.startsWith("/"));

    expect(internal.length).toBeGreaterThan(0);
    for (const href of internal) {
      expect(servedPath(href), `${href} is not served`).toBe(true);
    }
  });
});
