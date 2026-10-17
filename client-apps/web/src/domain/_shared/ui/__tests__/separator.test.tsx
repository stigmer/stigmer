// ---------------------------------------------------------------------------
// The console's Separator wrapper over Base UI's separator
//
// Pins what callers rely on: the `separator` data slot, a horizontal
// orientation by default and a vertical one when asked, the default line
// classes, and a caller's className merged through the design tokens' `cn`
// so a conflicting utility displaces the default.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { Separator } from "../separator";

describe("Separator", () => {
  it("renders a horizontal separator in its slot with the default classes", () => {
    render(<Separator />);
    const separator = screen.getByRole("separator");
    expect(separator.getAttribute("data-slot")).toBe("separator");
    expect(separator.getAttribute("aria-orientation")).toBe("horizontal");
    expect(separator.classList.contains("bg-border")).toBe(true);
    expect(separator.classList.contains("data-horizontal:h-px")).toBe(true);
  });

  it("carries a vertical orientation and lets a caller's className displace the default", () => {
    render(<Separator orientation="vertical" className="bg-primary mx-2" />);
    const separator = screen.getByRole("separator");
    expect(separator.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator.classList.contains("bg-primary")).toBe(true);
    expect(separator.classList.contains("bg-border")).toBe(false);
    expect(separator.classList.contains("mx-2")).toBe(true);
  });
});
