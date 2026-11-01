/**
 * Display is a role, not a size: Instrument Sans (`font-display`, brand/type.ts)
 * sets the words a page is named by, and Geist sets everything else.
 *
 * Renders every page that renders here and reads the roles from the markup:
 * each page title (`h1`), each section headline (the `h2` a
 * `<section aria-labelledby>` is named by) and the homepage's closing line
 * carry `font-display`; no row title (`h3`) does, since
 * rows are read as a list, not as headlines. A headline added without the
 * face, or a row title given it, fails here naming the element. The download
 * page, the blog and the docs title do not render under vitest; the static
 * export is read for them when the type changes. The header and footer draw
 * "Stigmer" as the outlined lockup (components/ui/__tests__/brand-surfaces.test.tsx);
 * the `Logo` component's live name is held to the lockup's face and weight here.
 */
import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SITE_CONFIG } from "@/lib/constants";
import { Logo } from "@/components/ui/logo";
import ContactSalesPage from "@/app/contact-sales/page";
import { Hero as WelcomeHero } from "@/components/docs/welcome-hero";
import { TURN_LINE } from "@/components/sections/HardParts";
import { AboutPage } from "../AboutPage";
import { CompareManagedAgentsPage } from "../CompareManagedAgentsPage";
import { HomePage } from "../HomePage";
import { PricingPage } from "../PricingPage";
import { PrivacyPage } from "../PrivacyPage";

afterEach(cleanup);

const DISPLAY = "font-display";

const PAGES: readonly [string, ComponentType][] = [
  ["the homepage", HomePage],
  ["the page on why we built Stigmer", AboutPage],
  ["the comparison", CompareManagedAgentsPage],
  ["pricing", PricingPage],
  ["privacy", PrivacyPage],
  ["contact sales", ContactSalesPage],
  ["the docs' welcome hero", () => <WelcomeHero eyebrow="Get started" title="Stigmer Documentation" />],
];

/** A short name for an element in a failure message. */
const describeElement = (element: Element) =>
  `<${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ""}> "${element.textContent?.trim().slice(0, 60)}"`;

const lacking = (elements: Element[]) =>
  elements.filter((element) => !element.classList.contains(DISPLAY)).map(describeElement);

/** The headings `<section aria-labelledby>` elements are named by. */
function sectionHeadlines(container: HTMLElement): Element[] {
  return [...container.querySelectorAll("section[aria-labelledby]")]
    .map((section) => container.querySelector(`[id="${section.getAttribute("aria-labelledby")}"]`))
    .filter((heading): heading is Element => heading !== null);
}

describe("the display face", () => {
  it.each(PAGES)("sets the page title and every section headline on %s", (_, Page) => {
    const { container } = render(<Page />);
    const titles = [...container.querySelectorAll("h1")];
    const headlines = sectionHeadlines(container);

    expect(titles.length, "one page title").toBe(1);
    expect(lacking(titles), "page titles without the display face").toEqual([]);
    expect(lacking(headlines), "section headlines without the display face").toEqual([]);
    for (const headline of headlines) {
      expect(headline.tagName, describeElement(headline)).toMatch(/^H[12]$/);
    }
  });

  it.each(PAGES)("leaves every row title on %s in the body face", (_, Page) => {
    const { container } = render(<Page />);
    const rowTitles = [...container.querySelectorAll("h3, h4")];

    expect(
      rowTitles.filter((element) => element.classList.contains(DISPLAY)).map(describeElement),
      "row titles set in the display face",
    ).toEqual([]);
  });

  it("names the homepage's sections in it, and its closing line", () => {
    const { container, getByText } = render(<HomePage />);

    expect(sectionHeadlines(container).length).toBeGreaterThanOrEqual(6);
    expect(getByText(TURN_LINE).classList.contains(DISPLAY)).toBe(true);
  });

  it("sets the Logo component's live name as the lockup is drawn: the display face at 600", () => {
    const { getByText } = render(<Logo />);
    const name = getByText(SITE_CONFIG.name);

    expect(name.classList.contains(DISPLAY)).toBe(true);
    expect(name.classList.contains("font-semibold")).toBe(true);
  });
});
