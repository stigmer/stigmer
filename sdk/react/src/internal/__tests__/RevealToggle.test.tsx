import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RevealToggle } from "../RevealToggle";

afterEach(cleanup);

describe("RevealToggle", () => {
  it("shows the default 'Show more' label and a collapsed aria-expanded when collapsed", () => {
    render(<RevealToggle expanded={false} onToggle={() => {}} />);
    const btn = screen.getByRole("button", { name: /Show more/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
  });

  it("shows the default 'Show less' label and an expanded aria-expanded when expanded", () => {
    render(<RevealToggle expanded onToggle={() => {}} />);
    const btn = screen.getByRole("button", { name: /Show less/ });
    expect(btn.getAttribute("aria-expanded")).toBe("true");
  });

  it("honours custom more/less labels (e.g. the line-count primitives)", () => {
    const { rerender } = render(
      <RevealToggle
        expanded={false}
        onToggle={() => {}}
        moreLabel="Show all 42 lines"
        lessLabel="Show less"
      />,
    );
    expect(screen.getByText("Show all 42 lines")).toBeTruthy();

    rerender(
      <RevealToggle
        expanded
        onToggle={() => {}}
        moreLabel="Show all 42 lines"
        lessLabel="Show less"
      />,
    );
    expect(screen.getByText("Show less")).toBeTruthy();
  });

  it("invokes onToggle on click", () => {
    const onToggle = vi.fn();
    render(<RevealToggle expanded={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("forwards the e2e cursor-target hook onto the control", () => {
    render(
      <RevealToggle
        expanded={false}
        onToggle={() => {}}
        cursorTarget="tool-detail-expand"
      />,
    );
    expect(
      screen.getByRole("button").getAttribute("data-cursor-target"),
    ).toBe("tool-detail-expand");
  });
});
