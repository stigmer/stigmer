/**
 * The page on why we built Stigmer.
 *
 * Pins that it links the dated post it is drawn from, which stays the long
 * version, and that it prints no figure other than a year: nothing counts
 * the assistant's use yet, so any other number on the page would have no
 * measured source. Only the page's own content is read, because the footer
 * prints the current year and the licence's version. The page's sentences
 * are not pinned; the maintainer's look judges the words.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AboutPage } from "../AboutPage";

afterEach(cleanup);

describe("AboutPage", () => {
  it("asks its question and links the post it is drawn from", () => {
    const { container } = render(<AboutPage />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Why we built Stigmer");
    const hrefs = [...container.querySelectorAll("main a")].map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/blog/how-we-put-agents-into-planton");
  });

  it("prints no figure other than a year", () => {
    render(<AboutPage />);

    // Text node by node, so a date ending a label never runs into the heading after it.
    const walker = document.createTreeWalker(screen.getByRole("main"), NodeFilter.SHOW_TEXT);
    const pieces: string[] = [];
    while (walker.nextNode()) pieces.push(walker.currentNode.textContent ?? "");
    expect(pieces.join(" ").replace(/\b\d{4}\b/g, "")).not.toMatch(/\d/);
  });
});
