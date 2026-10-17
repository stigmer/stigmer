// ---------------------------------------------------------------------------
// The console's ScrollArea wrapper — a scrolling div with the thin scrollbar
//
// Pins what callers rely on: the `scroll-area` data slot, the default
// classes (scrolling and the themed thumb), a caller's className merged
// through the design tokens' `cn` so a conflicting utility displaces the
// default, and every other prop and the children passed through.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { ScrollArea } from "../scroll-area";

describe("ScrollArea", () => {
  it("renders its children in a scroll-area slot with the default classes", () => {
    render(
      <ScrollArea data-testid="area" aria-label="Recent sessions">
        <p>row</p>
      </ScrollArea>,
    );
    const area = screen.getByTestId("area");
    expect(area.getAttribute("data-slot")).toBe("scroll-area");
    expect(area.getAttribute("aria-label")).toBe("Recent sessions");
    expect(area.classList.contains("relative")).toBe(true);
    expect(area.classList.contains("overflow-auto")).toBe(true);
    expect(area.classList.contains("[&::-webkit-scrollbar-thumb]:bg-border")).toBe(true);
    expect(screen.getByText("row").parentElement).toBe(area);
  });

  it("lets a caller's className displace a conflicting default", () => {
    render(<ScrollArea data-testid="area" className="overflow-hidden max-h-64" />);
    const area = screen.getByTestId("area");
    expect(area.classList.contains("overflow-hidden")).toBe(true);
    expect(area.classList.contains("overflow-auto")).toBe(false);
    expect(area.classList.contains("max-h-64")).toBe(true);
  });
});
