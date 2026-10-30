/**
 * ResourceAvatar draws an icon-less resource's initial on the theme's avatar
 * colour, the same pair GranteeAvatar uses for a person's initial, so every
 * preset themes it and the theme contract keeps the letter readable; no fixed
 * colour depends on the slug (stigmer#1473). The slug is the initial only
 * when the name is empty.
 */
import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { ResourceAvatar } from "../ResourceAvatar";

afterEach(cleanup);

function circle(container: HTMLElement): HTMLElement {
  const el = container.firstElementChild;
  if (!(el instanceof HTMLElement)) throw new Error("ResourceAvatar rendered nothing");
  return el;
}

describe("ResourceAvatar", () => {
  it("draws the name's initial on the theme's avatar colour", () => {
    const { container } = render(<ResourceAvatar name="research bot" slug="research-bot" />);
    const el = circle(container);

    expect(el.textContent).toBe("R");
    expect(el.className).toContain("stg:bg-avatar");
    expect(el.className).toContain("stg:text-muted-foreground");
  });

  it("paints every slug the same, from tokens only", () => {
    const classes = ["alpha", "bravo", "charlie", "delta"].map(
      (slug) => circle(render(<ResourceAvatar name={slug} slug={slug} />).container).className,
    );

    expect(new Set(classes).size).toBe(1);
    expect(classes[0]).not.toMatch(/-\[#|text-white/);
  });

  it("falls back to the slug's initial when the name is empty", () => {
    const { container } = render(<ResourceAvatar name="" slug="planner" />);

    expect(circle(container).textContent).toBe("P");
  });
});
