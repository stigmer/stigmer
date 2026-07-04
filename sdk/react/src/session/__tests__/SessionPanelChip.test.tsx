import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { SessionPanelChip } from "../SessionPanelChip";

// ---------------------------------------------------------------------------
// The chip is the panel's always-mounted toggle. Collapsed, it carries the
// pending-item count (arrivals never auto-open the panel); open, it is a bare
// hide affordance. Execution status deliberately never appears here (or in
// any other viewer chrome) — the thread itself communicates run state.
// ---------------------------------------------------------------------------

afterEach(cleanup);

describe("SessionPanelChip", () => {
  it("collapsed: offers Show panel and carries the pending count", () => {
    render(
      <SessionPanelChip isOpen={false} onToggle={vi.fn()} badgeCount={3} />,
    );
    const button = screen.getByRole("button", { name: "Show panel" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.textContent).toContain("3");
  });

  it("open: offers Hide panel without the count (the panel carries it)", () => {
    render(<SessionPanelChip isOpen onToggle={vi.fn()} badgeCount={3} />);
    const button = screen.getByRole("button", { name: "Hide panel" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.textContent).not.toContain("3");
  });

  it("renders as a bare toggle when nothing is pending", () => {
    render(<SessionPanelChip isOpen={false} onToggle={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Show panel" }).textContent).toBe("");
  });

  it("invokes onToggle on click", () => {
    const onToggle = vi.fn();
    render(<SessionPanelChip isOpen={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button", { name: "Show panel" }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
