/**
 * The live plan card while a Plan turn writes its plan: the plan card's
 * writing state, a busy region with the streaming title (else "Plan") over
 * "Writing the plan…", no File's name and no size, and one act, Open, that
 * opens the plan tab. Nothing final exists yet, so no Download or Build.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { PlanStreamingCard } from "../PlanStreamingCard";

afterEach(cleanup);

describe("PlanStreamingCard — live plan stand-in", () => {
  it("is a busy region with the streaming title over a live 'Writing the plan…' status", () => {
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
    expect(screen.getByRole("status").textContent).toBe("Writing the plan…");
    expect(region.textContent).toBe("Refactor the auth flowWriting the plan…Open");
  });

  it("shows no filename mid-stream (the final name is not known yet)", () => {
    render(
      <PlanStreamingCard title="Refactor the auth flow" sizeBytes={2048} onOpenPlan={vi.fn()} />,
    );
    const region = screen.getByRole("region", { name: "Plan being written" });
    expect(region.textContent).not.toContain("plan.md");
  });

  it("falls back to 'Plan' until the title has streamed in", () => {
    render(<PlanStreamingCard sizeBytes={12} onOpenPlan={vi.fn()} />);
    expect(screen.getByText("Plan")).toBeTruthy();
    expect(screen.getByText("Writing the plan…")).toBeTruthy();
  });

  it("routes Open to onOpenPlan", () => {
    const onOpenPlan = vi.fn();
    render(<PlanStreamingCard sizeBytes={64} onOpenPlan={onOpenPlan} />);

    fireEvent.click(screen.getByRole("button", { name: "Open plan" }));
    expect(onOpenPlan).toHaveBeenCalledTimes(1);
  });

  it("offers no Download or Build actions — nothing final exists yet", () => {
    render(<PlanStreamingCard sizeBytes={64} onOpenPlan={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /download/i })).toBeNull();
    expect(screen.queryByText("Build")).toBeNull();
  });

  it("renders without an action when onOpenPlan is absent", () => {
    render(<PlanStreamingCard sizeBytes={64} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
