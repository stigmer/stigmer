import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// happy-dom does not compute layout, so the real overflow measurement always
// reports false there (scrollHeight === clientHeight === 0). We mock the hook so
// the overflow-driven branches (fade + reveal control) are deterministically
// testable here; the *rendered* clamp/fade is exercised against a real browser
// in test/e2e/tests/interactive-approval/tool-card-ux.spec.ts.
let mockOverflowing = false;
vi.mock("../useIsOverflowing", () => ({
  useIsOverflowing: () => ({ ref: { current: null }, isOverflowing: mockOverflowing }),
}));

const { BoundedContent, PREVIEW_MAX_HEIGHT } = await import("../BoundedContent");

beforeEach(() => {
  mockOverflowing = false;
});
afterEach(cleanup);

/** The collapsed clamp element: `overflow-hidden` + the shared budget. */
function clampEl(container: HTMLElement): Element | null {
  return container.querySelector(`.overflow-hidden.${PREVIEW_MAX_HEIGHT}`);
}

describe("BoundedContent", () => {
  it("renders its children", () => {
    render(
      <BoundedContent>
        <p>diff body</p>
      </BoundedContent>,
    );
    expect(screen.getByText("diff body")).toBeTruthy();
  });

  it("clamps the body to the single shared budget while collapsed", () => {
    const { container } = render(
      <BoundedContent>
        <p>diff body</p>
      </BoundedContent>,
    );
    expect(clampEl(container)).not.toBeNull();
  });

  it("shows no reveal control when the content fits the budget", () => {
    mockOverflowing = false;
    render(
      <BoundedContent>
        <p>short</p>
      </BoundedContent>,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows 'Show more' when the content overflows and expands it in place to 'Show less', dropping the clamp", () => {
    mockOverflowing = true;
    const { container } = render(
      <BoundedContent>
        <p>long body</p>
      </BoundedContent>,
    );

    // Collapsed: clamped, with a "Show more" reveal that owns the disclosure.
    const control = screen.getByRole("button", { name: /Show more/ });
    expect(control.getAttribute("aria-expanded")).toBe("false");
    expect(clampEl(container)).not.toBeNull();

    // Expanding removes the clamp (natural height) and flips the control.
    fireEvent.click(control);
    expect(
      screen.getByRole("button", { name: /Show less/ }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(clampEl(container)).toBeNull();

    // Collapsing restores the clamp.
    fireEvent.click(screen.getByRole("button", { name: /Show less/ }));
    expect(screen.getByRole("button", { name: /Show more/ })).toBeTruthy();
    expect(clampEl(container)).not.toBeNull();
  });

  it("forwards the e2e cursor-target hook onto the control", () => {
    mockOverflowing = true;
    render(
      <BoundedContent cursorTarget="file-diff-expand">
        <p>body</p>
      </BoundedContent>,
    );
    expect(
      screen.getByRole("button").getAttribute("data-cursor-target"),
    ).toBe("file-diff-expand");
  });
});
