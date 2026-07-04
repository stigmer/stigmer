import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { SessionPanelChip } from "../SessionPanelChip";

// ---------------------------------------------------------------------------
// The chip is the panel's always-mounted toggle and, while collapsed, the
// session's status surface: phase badge + pending-item count. Open, it is a
// bare hide affordance (the panel's own strip carries the badge then).
// ---------------------------------------------------------------------------

afterEach(cleanup);

describe("SessionPanelChip", () => {
  it("collapsed: offers Show panel and carries the phase badge and count", () => {
    render(
      <SessionPanelChip
        isOpen={false}
        onToggle={vi.fn()}
        phase={ExecutionPhase.EXECUTION_COMPLETED}
        badgeCount={3}
      />,
    );
    const button = screen.getByRole("button", { name: "Show panel" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.textContent).toContain("Completed");
    expect(button.textContent).toContain("3");
  });

  it("open: offers Hide panel without badges (the panel strip carries them)", () => {
    render(
      <SessionPanelChip
        isOpen
        onToggle={vi.fn()}
        phase={ExecutionPhase.EXECUTION_COMPLETED}
        badgeCount={3}
      />,
    );
    const button = screen.getByRole("button", { name: "Hide panel" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.textContent).not.toContain("Completed");
    expect(button.textContent).not.toContain("3");
  });

  it("renders without status in execution-less hosts (launcher)", () => {
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
