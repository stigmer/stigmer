/**
 * ResolveSpinner, the overlay the composer lays over the agent picker while
 * a chosen agent's requirements are checked: it tells the person in words
 * what is happening, and keeps the spinning glyph out of the accessibility
 * tree so a screen reader hears the sentence alone.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ResolveSpinner } from "../icons";

afterEach(cleanup);

describe("ResolveSpinner", () => {
  it("says the agent's requirements are being checked, with the glyph hidden from assistive tech", () => {
    const { container } = render(<ResolveSpinner />);

    expect(screen.getByText("Checking agent requirements...")).toBeTruthy();
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });
});
