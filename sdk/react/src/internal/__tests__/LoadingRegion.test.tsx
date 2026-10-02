/**
 * LoadingRegion (stigmer#1653): the container for a labelled loading region. Pins its markup:
 * busy, no role and no aria-label, a label given as visually hidden text that
 * comes first, and no hidden text when no label is given (the children say it
 * themselves). The axe audit of the same markup is
 * `a11y/loading-region.a11y.browser.test.tsx`.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { LoadingRegion } from "../LoadingRegion.js";

afterEach(cleanup);

describe("LoadingRegion", () => {
  it("is a busy region with no role or aria-label, named by hidden text placed first", () => {
    const { container } = render(
      <LoadingRegion className="stg:space-y-2" label="Loading sessions">
        <div data-testid="bar" />
      </LoadingRegion>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-busy")).toBe("true");
    expect(root.getAttribute("role")).toBeNull();
    expect(root.getAttribute("aria-label")).toBeNull();
    expect(root.className).toBe("stg:space-y-2");
    const name = screen.getByText("Loading sessions");
    expect(name.className).toBe("stg:sr-only");
    expect(root.firstElementChild).toBe(name);
    expect(root.lastElementChild).toBe(screen.getByTestId("bar"));
  });

  it.each([undefined, ""])("renders no hidden text for label %j, so visible children are not read twice", (label) => {
    const { container } = render(
      <LoadingRegion label={label}>
        <p>Looking up acme…</p>
      </LoadingRegion>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-busy")).toBe("true");
    expect(root.querySelector(".stg\\:sr-only")).toBeNull();
    expect(root.children).toHaveLength(1);
  });
});
