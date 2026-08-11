import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { DecisionButton } from "../DecisionButton";

afterEach(cleanup);

// happy-dom cannot resolve `@layer`/the cascade, so these assert the class
// CONTRACT (the quiet, token-only treatment), not rendered pixels. The rendered
// outcome is covered by the e2e computed-style guard in tool-card-ux.spec.ts.
describe("DecisionButton", () => {
  it("renders the label as the accessible name and invokes onClick", () => {
    const onClick = vi.fn();
    render(<DecisionButton label="Approve" variant="primary" onClick={onClick} />);
    const btn = screen.getByRole("button", { name: "Approve" });
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("primary is a neutral chip (bordered fill), never the loud success green", () => {
    render(<DecisionButton label="Approve" variant="primary" onClick={() => {}} />);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("border");
    expect(cls).toContain("stg:bg-accent");
    expect(cls).toContain("stg:text-accent-foreground");
    expect(cls).not.toContain("stg:bg-success");
  });

  it("ghost carries no fill at rest (lowest weight)", () => {
    render(<DecisionButton label="Skip" variant="ghost" onClick={() => {}} />);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("stg:text-muted-foreground");
    // No resting background — only a neutral hover wash.
    expect(cls).not.toMatch(/(?:^|\s)bg-/);
    expect(cls).toContain("stg:hover:bg-accent-hover");
  });

  it("danger is a quiet ghost that reveals the destructive cue on hover AND focus, never the loud red fill", () => {
    render(<DecisionButton label="Reject" variant="danger" onClick={() => {}} />);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("stg:text-muted-foreground");
    expect(cls).not.toMatch(/(?:^|\s)bg-/); // transparent at rest
    expect(cls).toContain("stg:hover:text-destructive");
    expect(cls).toContain("stg:hover:bg-destructive-subtle");
    // Keyboard parity: the cue is not hover-only.
    expect(cls).toContain("stg:focus-visible:text-destructive");
    expect(cls).not.toContain("stg:bg-destructive stg:text-destructive-foreground");
  });

  it("uses NO `bg-token/NN` opacity modifiers in any variant", () => {
    for (const variant of ["primary", "ghost", "danger"] as const) {
      const { unmount } = render(
        <DecisionButton label="x" variant={variant} onClick={() => {}} />,
      );
      const cls = screen.getByRole("button").className;
      // No utility ends in `/<digits>` (e.g. bg-success/90, hover:bg-destructive/10).
      expect(cls).not.toMatch(/\/\d+(?:\s|$)/);
      unmount();
    }
  });

  it("disables every button while a submission is in flight", () => {
    render(
      <DecisionButton label="Approve" variant="primary" onClick={() => {}} isSubmitting />,
    );
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows the spinner only on the active button that is submitting", () => {
    const { rerender } = render(
      <DecisionButton
        label="Approve"
        variant="primary"
        onClick={() => {}}
        isSubmitting
        isActive
      />,
    );
    expect(screen.getByRole("button").querySelector("svg.stg\\:animate-spin")).toBeTruthy();

    // In-flight, but a DIFFERENT button is the active one — no spinner here.
    rerender(
      <DecisionButton
        label="Approve"
        variant="primary"
        onClick={() => {}}
        isSubmitting
        isActive={false}
      />,
    );
    expect(screen.getByRole("button").querySelector("svg.stg\\:animate-spin")).toBeNull();
  });

  it("forwards className and the data-cursor-target hook", () => {
    render(
      <DecisionButton
        label="Approve all"
        variant="ghost"
        onClick={() => {}}
        className="stg:ml-auto"
        cursorTarget="approve-all-button"
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("stg:ml-auto");
    expect(btn.getAttribute("data-cursor-target")).toBe("approve-all-button");
  });
});
