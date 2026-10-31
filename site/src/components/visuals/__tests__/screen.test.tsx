/**
 * `<Screen>`: the docs' shown picture by its name, sized from the visual
 * suite's list so nothing moves while it loads, offered at both densities
 * in the docs column, with its alt text; opening larger on a click; and
 * refusing a name the list does not hold or blank alt text, so the build
 * fails on the page that asked. The bare picture is `ScreenImage`'s test.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { shownScreen, shownSize } from "@/lib/screens";
import { DOCS_IMAGE_SIZES, Screen } from "../Screen";

afterEach(cleanup);

const ALT = "A tool call waits for approval, with Approve and Deny";

describe("Screen", () => {
  it("sizes the picture from the list and offers its 1x and 2x files", () => {
    const { width, height } = shownSize(shownScreen("approval"));
    render(<Screen name="approval" alt={ALT} />);
    const img = screen.getByRole("img", { name: ALT });
    expect(img.getAttribute("width")).toBe(String(width));
    expect(img.getAttribute("height")).toBe(String(height));
    expect(img.getAttribute("src")).toBe("/screens/approval-1x.webp");
    expect(img.getAttribute("srcset")).toBe(`/screens/approval-1x.webp ${width}w, /screens/approval-2x.webp ${width * 2}w`);
    expect(img.getAttribute("sizes")).toBe(DOCS_IMAGE_SIZES);
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("decoding")).toBe("async");
  });

  it("opens larger on a click, and passes its slot and class to the picture", () => {
    const { container } = render(<Screen name="approval" alt={ALT} sizes="100vw" className="rounded" />);
    expect(container.querySelector("[data-rmiz]")).not.toBeNull();
    const img = screen.getByRole("img", { name: ALT });
    expect(img.getAttribute("sizes")).toBe("100vw");
    expect(img.className).toContain("rounded");
  });

  it("refuses a screen the visual suite does not show", () => {
    expect(() => render(<Screen name="dashboard" alt={ALT} />)).toThrow(/no screen named "dashboard"/);
  });

  it("refuses blank or missing alt text", () => {
    expect(() => render(<Screen name="approval" alt="  " />)).toThrow(/alt text is required/);
    // An MDX page is not typechecked, so it can leave `alt` out entirely.
    const props: Record<string, string> = { name: "approval" };
    expect(() => render(<Screen {...(props as { name: string; alt: string })} />)).toThrow(/alt text is required/);
  });
});
