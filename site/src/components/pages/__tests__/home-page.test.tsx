/**
 * The homepage, and where the site's story pages send a reader.
 *
 * Pins that the homepage leads with the headline from brand/positioning.ts
 * and tells the story in its order: the problem, what each customer's agent
 * gets, how it fits, the jobs, why it was built, open source, the first job.
 *
 * Pins too that every docs link on the homepage, the use-cases page and the
 * comparison lands on a docs page that exists, never on one the redirect
 * file moved: the homepage once linked four Getting Started pages that only
 * redirects still answered.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_CONFIG } from "@/lib/constants";
import { HomePage } from "../HomePage";
import { UseCasesPage } from "../UseCasesPage";
import { CompareManagedAgentsPage } from "../CompareManagedAgentsPage";

afterEach(cleanup);

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = resolve(HERE, "../../../../../docs");
const REDIRECTS = resolve(HERE, "../../../../public/_redirects");

/** The paths the redirect file sends elsewhere. */
const MOVED = new Set(
  readFileSync(REDIRECTS, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("/"))
    .map((line) => line.split(/\s+/)[0]),
);

function docsLinks(container: HTMLElement): string[] {
  return [...container.querySelectorAll("a")]
    .map((link) => link.getAttribute("href") ?? "")
    .filter((href) => href.startsWith("/docs/"));
}

describe("HomePage", () => {
  it("leads with the headline and tells the story in order", () => {
    render(<HomePage />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(SITE_CONFIG.headline);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.id);
    expect(headings).toEqual([
      "problem-heading",
      "what-each-agent-gets-heading",
      "how-it-fits-heading",
      "use-cases-heading",
      "built-for-planton-heading",
      "open-source-heading",
      "final-cta-heading",
    ]);
  });

  it.each([
    ["the homepage", HomePage],
    ["the use-cases page", UseCasesPage],
    ["the comparison", CompareManagedAgentsPage],
  ])("sends every docs link on %s to a page that exists", (_, Page) => {
    const { container } = render(<Page />);
    const links = docsLinks(container);

    expect(links.length).toBeGreaterThan(0);
    for (const href of links) {
      const path = href.split("#")[0];
      expect(MOVED.has(path), `${href} is redirected`).toBe(false);
      const page = path.slice("/docs/".length);
      expect(
        existsSync(resolve(DOCS, `${page}.mdx`)) || existsSync(resolve(DOCS, page, "index.mdx")),
        `${href} has no docs page`,
      ).toBe(true);
    }
  });
});
