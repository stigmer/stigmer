/**
 * The home page's code samples, the app excerpt (DropItIn) and the closing
 * terminal (FinalCTA), scroll sideways when a line is longer than the box,
 * so each scroll area is a Tab stop a keyboard can scroll, as the docs' code
 * blocks are (lib/scroll-region.ts; stigmer#3384). The built-site audit
 * (test/site) holds the same on the built page.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DropItIn } from "../DropItIn";
import { FinalCTA } from "../FinalCTA";

afterEach(cleanup);

describe("the home page's code samples", () => {
  it.each([
    ["the app excerpt", DropItIn],
    ["the closing terminal", FinalCTA],
  ])("make %s's scroll area a Tab stop", (_name, Section) => {
    const { container } = render(<Section />);
    const areas = [...container.querySelectorAll("pre")];
    expect(areas).toHaveLength(1);
    expect(areas[0]?.getAttribute("tabindex")).toBe("0");
    expect(areas[0]?.className).toContain("overflow-x-auto");
    expect(areas[0]?.className).toContain("focus-visible:outline-offset-[-2px]");
  });
});
