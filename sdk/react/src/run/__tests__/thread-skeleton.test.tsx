import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThreadSkeleton } from "../ThreadSkeleton";

describe("ThreadSkeleton", () => {
  it("renders as a busy region named by visually hidden text, with no role or aria-label", () => {
    const { container } = render(<ThreadSkeleton />);

    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-busy")).toBe("true");
    expect(root.getAttribute("aria-label")).toBeNull();
    expect(root.getAttribute("role")).toBeNull();
    const name = screen.getByText("Loading conversation");
    expect(name.className).toContain("stg:sr-only");
    expect(root.contains(name)).toBe(true);
  });

  it("renders human message bubble silhouettes", () => {
    const { container } = render(<ThreadSkeleton />);

    const humanBubbles = container.querySelectorAll("[class*='ms-']");
    expect(humanBubbles.length).toBe(2);
  });

  it("renders AI response line silhouettes", () => {
    const { container } = render(<ThreadSkeleton />);

    const pulseContainer = container.querySelector(".stg\\:animate-pulse");
    expect(pulseContainer).toBeTruthy();

    const lines = pulseContainer!.querySelectorAll("[style]");
    expect(lines.length).toBe(7);
  });

  it("applies custom className", () => {
    const { container } = render(<ThreadSkeleton className="my-custom-class" />);

    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("my-custom-class");
  });

  it("uses muted color tokens for skeleton bars", () => {
    const { container } = render(<ThreadSkeleton />);

    const bars = container.querySelectorAll("[class*='bg-muted']");
    expect(bars.length).toBeGreaterThan(0);
  });
});
