/**
 * `<ScreenImage>`: the bare shown picture a page outside the docs uses,
 * sized from the visual suite's list, offered at both densities for the slot
 * it is given, with no zoom around it, and refusing a name the list does not
 * hold or blank alt text.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { shownScreen, shownSize } from "@/lib/screens";
import { ScreenImage } from "../ScreenImage";

afterEach(cleanup);

const ALT = "Northwind's ledger agent asks before it posts an adjustment";

describe("ScreenImage", () => {
  it("stands bare, sized from the list, offering both files for its slot", () => {
    const { width, height } = shownSize(shownScreen("asks-first"));
    const { container } = render(<ScreenImage name="asks-first" alt={ALT} sizes="(min-width: 1024px) 640px, 100vw" className="rounded" />);
    expect(container.querySelector("[data-rmiz]")).toBeNull();
    const img = screen.getByRole("img", { name: ALT });
    expect(img.getAttribute("width")).toBe(String(width));
    expect(img.getAttribute("height")).toBe(String(height));
    expect(img.getAttribute("srcset")).toBe(`/screens/asks-first-1x.webp ${width}w, /screens/asks-first-2x.webp ${width * 2}w`);
    expect(img.getAttribute("sizes")).toBe("(min-width: 1024px) 640px, 100vw");
    expect(img.className).toContain("rounded");
  });

  it("refuses a screen the visual suite does not show, and blank alt text", () => {
    expect(() => render(<ScreenImage name="dashboard" alt={ALT} sizes="100vw" />)).toThrow(/no screen named "dashboard"/);
    expect(() => render(<ScreenImage name="asks-first" alt=" " sizes="100vw" />)).toThrow(/alt text is required/);
  });
});
