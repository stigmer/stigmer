import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PlanStreamingCard } from "../PlanStreamingCard";

afterEach(cleanup);

describe("PlanStreamingCard — live plan stand-in", () => {
  it("is a busy region with the streaming title, filename, and live size", () => {
    render(
      <PlanStreamingCard
        title="Refactor the auth flow"
        sizeBytes={2048}
        onOpenPlan={vi.fn()}
      />,
    );

    const region = screen.getByRole("region", { name: "Plan being written" });
    expect(region.getAttribute("aria-busy")).toBe("true");
    expect(region.textContent).toContain("Refactor the auth flow");
    expect(region.textContent).toContain("plan.md");
    expect(region.textContent).toContain("Writing…");
    expect(region.textContent).toContain("2.0 KB");
  });

  it("falls back to 'Writing plan…' until the title has streamed in", () => {
    render(<PlanStreamingCard sizeBytes={12} onOpenPlan={vi.fn()} />);
    expect(screen.getByText("Writing plan…")).toBeTruthy();
  });

  it("routes 'Open plan' to onOpenPlan", () => {
    const onOpenPlan = vi.fn();
    render(<PlanStreamingCard sizeBytes={64} onOpenPlan={onOpenPlan} />);

    fireEvent.click(screen.getByText("Open plan"));
    expect(onOpenPlan).toHaveBeenCalledTimes(1);
  });

  it("offers no Download or Build actions — nothing final exists yet", () => {
    render(<PlanStreamingCard sizeBytes={64} onOpenPlan={vi.fn()} />);
    expect(screen.queryByText("Download")).toBeNull();
    expect(screen.queryByText("Build from plan")).toBeNull();
  });

  it("renders without an action when onOpenPlan is absent", () => {
    render(<PlanStreamingCard sizeBytes={64} />);
    expect(screen.queryByText("Open plan")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
