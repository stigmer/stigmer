// ---------------------------------------------------------------------------
// The library zone's breadcrumb — the trail from Library to the current page
//
// Pins how the breadcrumb reads the zone's current path: nothing at the
// library root; a link back to Library, then each known category (Agents,
// Skills, Schedules) as a link to its list; an intermediate segment that is
// no category (the org in /skills/<org>/<slug>) left out; and the last
// segment as the current page, named by the label a detail page set
// (useBreadcrumbLabel) when it is not a category, else by its own text.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const zone = vi.hoisted(() => ({ path: "/library", label: null as string | null }));
vi.mock("@/domain/library/library-navigation", () => ({
  useLibraryNavigation: () => ({ currentLibraryPath: zone.path }),
}));
vi.mock("@stigmer/react-sdk", () => ({
  useBreadcrumbLabel: () => zone.label,
}));

import { LibraryBreadcrumb } from "../LibraryBreadcrumb";

function trail(): Array<[string, string | null]> {
  const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
  return within(nav)
    .getAllByRole("listitem")
    .map((item) => {
      const link = within(item).queryByRole("link");
      const text = (link ?? item).textContent?.replace(/^\//, "") ?? "";
      return [text, link?.getAttribute("href") ?? null];
    });
}

function currentPage(): HTMLElement {
  const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
  const current = nav.querySelector('[aria-current="page"]');
  expect(current, "a current page is marked").not.toBeNull();
  return current as HTMLElement;
}

beforeEach(() => {
  zone.path = "/library";
  zone.label = null;
});

describe("LibraryBreadcrumb", () => {
  it("renders nothing at the library root", () => {
    const { container } = render(<LibraryBreadcrumb />);
    expect(container.innerHTML).toBe("");
  });

  it("names a category list page by its label, after a link back to Library", () => {
    zone.path = "/library/agents";
    render(<LibraryBreadcrumb />);
    expect(trail()).toEqual([
      ["Library", "/library"],
      ["Agents", null],
    ]);
    expect(currentPage().textContent).toBe("Agents");
  });

  it("links the category, skips the org, and names the detail page by its override label", () => {
    zone.path = "/library/skills/acme/code-review";
    zone.label = "Code Review";
    render(<LibraryBreadcrumb />);
    expect(trail()).toEqual([
      ["Library", "/library"],
      ["Skills", "/library/skills"],
      ["Code Review", null],
    ]);
    expect(screen.queryByText("acme")).toBeNull();
  });

  it("names the detail page by its segment when no label was set", () => {
    zone.path = "/library/schedules/acme/nightly-report";
    render(<LibraryBreadcrumb />);
    expect(currentPage().textContent).toBe("nightly-report");
  });

  it("keeps a category's own label on its list page even when a label is set", () => {
    zone.path = "/library/schedules";
    zone.label = "Nightly report";
    render(<LibraryBreadcrumb />);
    expect(currentPage().textContent).toBe("Schedules");
  });
});
