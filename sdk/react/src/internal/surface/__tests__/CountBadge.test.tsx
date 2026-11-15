// Proves the count badge (../CountBadge.tsx): its type is the scale's
// smallest step on its paired 16px line, never collapsed to the font's own
// height, at both sizes, and its tone picks its fill.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { CountBadge } from "../CountBadge";

afterEach(cleanup);

describe("CountBadge", () => {
  it("draws 16px tall at 11px on its paired line by default", () => {
    render(<CountBadge>3</CountBadge>);
    const badge = screen.getByText("3");
    expect(badge.className).toContain("stg:h-4");
    expect(badge.className).toContain("stg:text-2xs");
    expect(badge.className).not.toContain("stg:leading-none");
  });

  it("draws 14px tall at sm, on the same type", () => {
    render(<CountBadge size="sm">2</CountBadge>);
    const badge = screen.getByText("2");
    expect(badge.className).toContain("stg:h-3.5");
    expect(badge.className).toContain("stg:text-2xs");
    expect(badge.className).not.toContain("stg:leading-none");
  });

  it("takes its fill from its tone", () => {
    render(<CountBadge tone="sidebar">9</CountBadge>);
    expect(screen.getByText("9").className).toContain("stg:bg-sidebar-primary");
  });
});
