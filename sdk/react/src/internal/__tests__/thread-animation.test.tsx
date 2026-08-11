import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
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

  it("renders children directly when animate=false (no wrapper div)", () => {
    const { container } = render(
      <ThreadItemWrapper animate={false}>
        <span data-testid="child">no-animation</span>
      </ThreadItemWrapper>,
    );

    expect(container.querySelector(".stgm-thread-item-enter")).toBeNull();
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("renders children directly after animation completes (no residual wrapper)", () => {
    const { container, rerender } = render(
      <ThreadItemWrapper animate>
        <span>content</span>
      </ThreadItemWrapper>,
    );

    const wrapper = container.firstElementChild as HTMLElement;
    fireEvent.animationEnd(wrapper);

    rerender(
      <ThreadItemWrapper animate>
        <span>content</span>
      </ThreadItemWrapper>,
    );

    const span = screen.getByText("content");
    expect(span.tagName).toBe("SPAN");
    expect(container.querySelector(".stgm-thread-item-enter")).toBeNull();
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
