import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import React from "react";
import { ThreadItemWrapper } from "../ThreadItemWrapper";
import { JumpToLatestButton } from "../JumpToLatestButton";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// ThreadItemWrapper
// ---------------------------------------------------------------------------

describe("ThreadItemWrapper", () => {
  it("applies stgm-thread-item-enter class on mount when animate=true", () => {
    const { container } = render(
      <ThreadItemWrapper animate>
        <span>content</span>
      </ThreadItemWrapper>,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.classList.contains("stgm-thread-item-enter")).toBe(true);
    expect(screen.getByText("content")).toBeTruthy();
  });

  it("removes animation class after animationend", () => {
    const { container } = render(
      <ThreadItemWrapper animate>
        <span>content</span>
      </ThreadItemWrapper>,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.classList.contains("stgm-thread-item-enter")).toBe(true);

    fireEvent.animationEnd(wrapper);

    expect(container.querySelector(".stgm-thread-item-enter")).toBeNull();
    expect(screen.getByText("content")).toBeTruthy();
  });

  it("renders the same plain wrapper when animate=false, so an item's shape never depends on whether it animated", () => {
    const { container } = render(
      <ThreadItemWrapper animate={false}>
        <span data-testid="child">no-animation</span>
      </ThreadItemWrapper>,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.tagName).toBe("DIV");
    expect(wrapper.classList.contains("stgm-thread-item-enter")).toBe(false);
    expect(wrapper.firstElementChild).toBe(screen.getByTestId("child"));
  });

  // An item that renders nothing (a turn with no outcome to show) must take
  // no gap in the thread's column, as it did when the settled wrapper was no
  // element at all.
  it("hides the wrapper of an item that renders nothing", () => {
    const { container } = render(<ThreadItemWrapper animate={false}>{null}</ThreadItemWrapper>);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.matches(":empty")).toBe(true);
    expect(wrapper.classList.contains("stg:empty:hidden")).toBe(true);
  });

  // The wrapper keeps one element for its whole life: a root that changed
  // from the wrapper div to the bare child when the animation ended made
  // React replace the whole item, and with it a focused control inside it
  // (stigmer/stigmer#1570).
  it("keeps its element and the child's after animationend, focus included", () => {
    const { container, rerender } = render(
      <ThreadItemWrapper animate>
        <button type="button">Approve</button>
      </ThreadItemWrapper>,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    const button = screen.getByRole("button", { name: "Approve" });
    button.focus();

    fireEvent.animationEnd(wrapper);
    rerender(
      <ThreadItemWrapper animate>
        <button type="button">Approve</button>
      </ThreadItemWrapper>,
    );

    expect(container.firstElementChild).toBe(wrapper);
    expect(wrapper.classList.contains("stgm-thread-item-enter")).toBe(false);
    expect(screen.getByRole("button", { name: "Approve" })).toBe(button);
    expect(document.activeElement).toBe(button);
  });

  it("keeps its element and the child's when the fallback timer ends the entrance", () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <ThreadItemWrapper animate>
          <button type="button">Approve</button>
        </ThreadItemWrapper>,
      );

      const wrapper = container.firstElementChild as HTMLElement;
      const button = screen.getByRole("button", { name: "Approve" });
      button.focus();

      act(() => {
        vi.advanceTimersByTime(300);
      });

      expect(container.firstElementChild).toBe(wrapper);
      expect(wrapper.classList.contains("stgm-thread-item-enter")).toBe(false);
      expect(screen.getByRole("button", { name: "Approve" })).toBe(button);
      expect(document.activeElement).toBe(button);
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// JumpToLatestButton
// ---------------------------------------------------------------------------

describe("JumpToLatestButton", () => {
  it("renders visible state with correct attributes", () => {
    const onClick = vi.fn();
    render(<JumpToLatestButton onClick={onClick} visible />);

    const button = screen.getByRole("button", { name: "Jump to latest" });
    expect(button.getAttribute("aria-hidden")).toBe("false");
    expect(button.getAttribute("tabindex")).toBe("0");
    expect(button.className).toContain("stg:opacity-100");
    expect(button.className).toContain("stg:pointer-events-auto");
  });

  it("renders hidden state with correct attributes", () => {
    const onClick = vi.fn();
    render(<JumpToLatestButton onClick={onClick} visible={false} />);

    const button = screen.getByLabelText("Jump to latest");
    expect(button.getAttribute("aria-hidden")).toBe("true");
    expect(button.getAttribute("tabindex")).toBe("-1");
    expect(button.className).toContain("stg:opacity-0");
    expect(button.className).toContain("stg:pointer-events-none");
    expect(button.className).toContain("stg:translate-y-2");
  });

  it("calls onClick when clicked in visible state", () => {
    const onClick = vi.fn();
    render(<JumpToLatestButton onClick={onClick} visible />);

    fireEvent.click(screen.getByRole("button", { name: "Jump to latest" }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("has transition classes for smooth enter/exit", () => {
    const onClick = vi.fn();
    render(<JumpToLatestButton onClick={onClick} visible />);

    const button = screen.getByRole("button", { name: "Jump to latest" });
    expect(button.className).toContain("stg:transition-[opacity,transform]");
  });
});
