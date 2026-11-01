/**
 * SettingsSkeleton, what a settings page draws while it reads: one region
 * assistive technology hears as busy, named by what is loading, holding
 * the page's shape (rows, or figures over a chart) and nothing a screen
 * reader would read as content.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SettingsSkeleton } from "../SettingsSkeleton";

afterEach(cleanup);

/** The one busy region on the page. */
function busyRegion(container: HTMLElement): HTMLElement {
  const busy = container.querySelectorAll<HTMLElement>("[aria-busy='true']");
  expect(busy).toHaveLength(1);
  return busy[0];
}

describe("SettingsSkeleton", () => {
  it("is one busy region named by what it loads, with the rows asked for hidden from assistive technology", () => {
    const { container } = render(<SettingsSkeleton label="Loading members" rows={3} />);
    const region = busyRegion(container);
    expect(screen.getByText("Loading members")).toBeTruthy();
    const list = region.querySelector("ul");
    expect(list?.getAttribute("aria-hidden")).toBe("true");
    expect(list?.querySelectorAll("li")).toHaveLength(3);
    expect(region.getAttribute("role")).toBeNull();
  });

  it("says Loading when given no label, and draws four rows", () => {
    const { container } = render(<SettingsSkeleton />);
    expect(screen.getByText("Loading")).toBeTruthy();
    expect(busyRegion(container).querySelectorAll("li")).toHaveLength(4);
  });

  it("draws figures over a chart for a page of numbers", () => {
    const { container } = render(<SettingsSkeleton variant="figures" label="Loading usage data" rows={2} />);
    const region = busyRegion(container);
    expect(screen.getByText("Loading usage data")).toBeTruthy();
    expect(region.querySelector("ul")).toBeNull();
    const [figures] = region.querySelectorAll("[aria-hidden='true']");
    expect(figures.children).toHaveLength(2);
  });
});
