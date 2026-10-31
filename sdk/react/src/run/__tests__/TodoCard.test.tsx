// Pins TodoCard over a turn's folded to-do list: its region, header and
// progress, nothing for an empty list, open while an item is in progress and
// collapsed once every item is resolved (completed or cancelled), the
// header toggle, its by-reference memo comparator, and the done marks (the
// resolved plan's header icon and a completed row's icon) drawn in the ready
// colour the theme contract measures as text, never the badge-fill green.
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import type { Todo } from "@stigmer/client";
import { TodoCard, todoCardPropsEqual } from "../TodoCard";

afterEach(cleanup);

function todo(id: string, content: string, status: Todo["status"]): Todo {
  return { id, content, status, createdAt: "", updatedAt: "" };
}

const ACTIVE: readonly Todo[] = [
  todo("t1", "Design the card", "completed"),
  todo("t2", "Wire the thread", "in_progress"),
  todo("t3", "Write tests", "pending"),
];

const DONE: readonly Todo[] = [
  todo("t1", "Design the card", "completed"),
  todo("t2", "Wire the thread", "cancelled"),
];

describe("TodoCard", () => {
  it("renders an 'Agent to-dos' region with the To-dos header and progress", () => {
    const { container } = render(<TodoCard todos={ACTIVE} />);

    const region = container.querySelector("[role='region']") as HTMLElement;
    expect(region).toBeTruthy();
    expect(region.getAttribute("aria-label")).toBe("Agent to-dos");
    expect(region.textContent).toContain("To-dos");
    // 1 of 3 completed.
    expect(region.textContent).toContain("1/3 completed");
  });

  it("renders nothing when there are no todos", () => {
    const { container } = render(<TodoCard todos={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("is expanded while the plan is active (an item is in progress)", () => {
    const { container } = render(<TodoCard todos={ACTIVE} />);

    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-expanded")).toBe("true");
    // The task list is visible.
    expect(container.querySelector("[role='list']")).toBeTruthy();
    expect(container.textContent).toContain("Wire the thread");
  });

  it("is collapsed by default once the plan is fully resolved (history)", () => {
    const { container } = render(<TodoCard todos={DONE} />);

    const button = container.querySelector("button")!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    // The list is not rendered while collapsed.
    expect(container.querySelector("[role='list']")).toBeNull();
  });

  it("toggles the list open/closed on header click", () => {
    const { container } = render(<TodoCard todos={DONE} />);
    const button = container.querySelector("button")!;

    expect(container.querySelector("[role='list']")).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector("[role='list']")).toBeTruthy();

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector("[role='list']")).toBeNull();
  });
});

describe("TodoCard done marks", () => {
  it("draws a resolved plan's header icon in the measured ready colour", () => {
    const { container } = render(<TodoCard todos={DONE} />);
    const icon = container.querySelector("button > span[aria-hidden='true']") as HTMLElement;
    expect(icon.className.split(" ")).toContain("stg:text-status-ready");
  });

  it("draws a completed row's icon in the measured ready colour", () => {
    const { getByText } = render(<TodoCard todos={ACTIVE} />);
    const row = getByText("Design the card").closest("li") as HTMLElement;
    const icon = row.querySelector("span[aria-hidden='true']") as HTMLElement;
    expect(icon.className.split(" ")).toContain("stg:text-status-ready");
  });
});

describe("todoCardPropsEqual (React.memo comparator)", () => {
  it("treats the same todos reference as equal (skips re-render)", () => {
    expect(todoCardPropsEqual({ todos: ACTIVE }, { todos: ACTIVE })).toBe(true);
  });

  it("treats a different todos reference as not equal (re-renders)", () => {
    expect(todoCardPropsEqual({ todos: ACTIVE }, { todos: DONE })).toBe(false);
  });

  it("treats a className change as not equal", () => {
    expect(
      todoCardPropsEqual(
        { todos: ACTIVE, className: "a" },
        { todos: ACTIVE, className: "b" },
      ),
    ).toBe(false);
  });
});
