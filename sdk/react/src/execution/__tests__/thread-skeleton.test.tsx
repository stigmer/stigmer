import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThreadSkeleton } from "../ThreadSkeleton";

describe("ThreadSkeleton", () => {
  it("renders with aria-busy and loading label", () => {
    const { container } = render(<ThreadSkeleton />);

    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("aria-busy")).toBe("true");
    expect(root.getAttribute("aria-label")).toBe("Loading conversation");
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
