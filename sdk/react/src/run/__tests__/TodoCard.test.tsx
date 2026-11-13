// Pins TodoCard over a turn's folded to-do list, drawn in the plan card's
// (PlanSteps) look: its region, the 12/16 muted header ("Plan" and "N of M
// done", dropped items not counted), nothing for an empty list, open while
// an item is in progress and collapsed once every item is resolved
// (completed or cancelled), the header toggle, its by-reference memo
// comparator, and TodoList's rows in the plan's marks (a ready tick, a
// running spinner, an empty ring) at 14/20 with 8px padding, with no
// opacity modifier anywhere.
import { describe, it, expect, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import type { Todo } from "@stigmer/client";
import { TodoCard, todoCardPropsEqual } from "../TodoCard";
import { TodoList } from "../TodoList";

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
  it("renders an 'Agent to-dos' region with the plan card's header: Plan and how many are done", () => {
    const { container } = render(<TodoCard todos={ACTIVE} />);

    const region = container.querySelector("[role='region']") as HTMLElement;
    expect(region).toBeTruthy();
    expect(region.getAttribute("aria-label")).toBe("Agent to-dos");
    const header = container.querySelector("button")!;
    expect(header.textContent).toBe("Plan1 of 3 done");
    for (const cls of ["stg:text-xs", "stg:text-muted-foreground", "stg:px-3", "stg:py-2"]) {
      expect(header.className.split(" ")).toContain(cls);
    }
  });

  it("leaves a dropped item out of the count, as the plan card does", () => {
    const { container } = render(<TodoCard todos={DONE} />);
    expect(container.querySelector("button")!.textContent).toContain("1 of 1 done");
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

describe("TodoList rows in the plan's marks", () => {
  const ALL: readonly Todo[] = [
    todo("t1", "Design the card", "completed"),
    todo("t2", "Wire the thread", "in_progress"),
    todo("t3", "Write tests", "pending"),
    todo("t4", "Ship a banner", "cancelled"),
  ];

  it("marks a done row with the ready tick, the live row with the running spinner, a due or dropped row with an empty ring", () => {
    render(<TodoList todos={ALL} />);
    const mark = (content: string) => screen.getByText(content).closest("li")!.querySelector("[role='img']")!;

    expect(mark("Design the card").getAttribute("aria-label")).toBe("Done");
    expect(mark("Design the card").className.split(" ")).toContain("stg:bg-status-ready");
    expect(mark("Wire the thread").getAttribute("aria-label")).toBe("In progress");
    expect(mark("Wire the thread").className.split(" ")).toContain("stg:text-status-running");
    expect(mark("Wire the thread").querySelector("svg.stg\\:animate-spin")).toBeTruthy();
    expect(mark("Write tests").getAttribute("aria-label")).toBe("To do");
    expect(mark("Ship a banner").getAttribute("aria-label")).toBe("Dropped");
    expect(screen.getByText("Ship a banner").className.split(" ")).toContain("stg:line-through");
  });

  it("draws 14/20 rows with 8px padding, the live one in the foreground's weight", () => {
    render(<TodoList todos={ALL} />);
    const row = screen.getByText("Write tests").closest("li")!;
    for (const cls of ["stg:text-sm", "stg:px-3", "stg:py-2"]) expect(row.className.split(" ")).toContain(cls);
    expect(screen.getByText("Wire the thread").className.split(" ")).toContain("stg:font-medium");
  });

  it("uses no opacity modifier in the card or its rows", () => {
    const { container } = render(<TodoCard todos={ACTIVE} />);
    for (const element of container.querySelectorAll("*")) {
      const classes = element.getAttribute("class") ?? "";
      expect(classes).not.toMatch(/opacity|\/\d+/);
    }
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
