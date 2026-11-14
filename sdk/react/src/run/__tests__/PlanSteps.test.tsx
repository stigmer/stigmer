/**
 * Proves the plan card a to-do turn draws (PlanSteps): its head counts the
 * items done, a dropped item not counted; each item's mark says done, in
 * progress, not finished, dropped or to do; the item in progress is open
 * to its steps while the turn works, a finished item opens on a click, and
 * an item with no steps is a plain line; an item whose step waits for a
 * person says who it waits on, in the viewer's words ("Waiting for you"
 * for whoever answers, else "Waiting for {owner} to approve", or "Waiting
 * for the owner" unnamed) and leaves that step to the bottom card;
 * an item left in progress by an ended turn says where it stopped, in its
 * ending's words ("Stopped here" unless told otherwise); and the
 * steps outside any item draw at the foot, the settled ones folded under
 * "Steps so far" and the open ones as rows, a waiting one left out.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { JsonObject } from "@bufbuild/protobuf";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { turnSteps, type TurnSteps } from "@stigmer/client";
import { PlanSteps } from "../PlanSteps";
import { ApprovalContext } from "../ApprovalContext";
import { asked, result, status, turnsOf, use, user } from "./__fixtures__/thread-events";

afterEach(cleanup);

const R = "run_a";

/** A to-do write that returned. */
function todos(id: string, items: readonly { content: string; status: string }[]): SessionEvent[] {
  return [use(R, id, "write_todos", { todos: items.map((t) => ({ ...t })) }), result(R, id, "ok")];
}

/** A call that returned. */
function call(id: string, name: string, input: JsonObject = {}): SessionEvent[] {
  return [use(R, id, name, input), result(R, id, "ok")];
}

/** The steps of one turn of `events`. */
function stepsOf(...events: ReadonlyArray<SessionEvent | readonly SessionEvent[]>): TurnSteps {
  return turnSteps(turnsOf(user(R, "go"), status(R, "running"), ...events)[0]!);
}

/** An item's line, by its words. */
function itemLine(words: string): HTMLElement {
  return screen.getByText(words).closest("li")!;
}

/** The control that opens an item to its steps. */
function itemToggle(words: string): HTMLButtonElement {
  return itemLine(words).querySelector<HTMLButtonElement>(":scope > button")!;
}

/** A plan whose item in progress has a step waiting on a person's answer. */
function waitingSteps(): TurnSteps {
  return stepsOf(
    todos("t", [{ content: "Push the fix", status: "in_progress" }]),
    call("c1", "execute", { command: "git status" }),
    use(R, "c2", "execute", { command: "git push" }, { ask: true }),
    asked(R, "c2"),
    status(R, "waiting"),
  );
}

describe("PlanSteps", () => {
  it("heads the plan with how many of its items are done, a dropped item not counted, and marks each", () => {
    render(
      <PlanSteps
        working
        steps={stepsOf(
          todos("t", [
            { content: "Read the code", status: "completed" },
            { content: "Try the old way", status: "cancelled" },
            { content: "Fix it", status: "in_progress" },
            { content: "Test it", status: "pending" },
          ]),
        )}
      />,
    );
    const plan = screen.getByRole("region", { name: "Plan" });

    expect(within(plan).getByText("Plan")).toBeTruthy();
    expect(within(plan).getByText("1 of 3 done")).toBeTruthy();
    expect(within(itemLine("Read the code")).getByRole("img", { name: "Done" })).toBeTruthy();
    expect(within(itemLine("Try the old way")).getByRole("img", { name: "Dropped" })).toBeTruthy();
    expect(within(itemLine("Test it")).getByRole("img", { name: "To do" })).toBeTruthy();
    // An item with no steps is a plain line, not a control.
    expect(within(itemLine("Fix it")).queryByRole("button")).toBeNull();
    expect(within(itemLine("Fix it")).getByRole("img", { name: "In progress" })).toBeTruthy();
  });

  it("marks the item an ended turn stopped on by the ending's tone: failed, paused or stopped", () => {
    const steps = stepsOf(todos("t", [{ content: "Fix it", status: "in_progress" }]));
    const { rerender } = render(<PlanSteps working={false} steps={steps} stoppedTone="failed" />);
    const failed = within(itemLine("Fix it")).getByRole("img", { name: "Failed here" });
    expect(failed.className).toContain("stg:text-status-failed");

    rerender(<PlanSteps working={false} steps={steps} stoppedTone="paused" />);
    expect(within(itemLine("Fix it")).getByRole("img", { name: "Paused" }).className).toContain("stg:border-status-degraded");

    rerender(<PlanSteps working={false} steps={steps} />);
    expect(within(itemLine("Fix it")).getByRole("img", { name: "Stopped" }).className).toContain("stg:border-muted-foreground");
  });

  it("sets the item in hand's own line on the running band, not its steps, and done items in the foreground", () => {
    render(
      <PlanSteps
        working
        steps={stepsOf(
          todos("t", [
            { content: "Read the code", status: "completed" },
            { content: "Fix it", status: "in_progress" },
            { content: "Test it", status: "pending" },
          ]),
        )}
      />,
    );
    expect(screen.getByText("Fix it").closest("div")!.className).toContain("stg:bg-status-running-subtle");
    expect(itemLine("Fix it").className).not.toContain("stg:bg-status-running-subtle");
    expect(itemLine("Read the code").innerHTML).not.toContain("stg:bg-status-running-subtle");
    expect(screen.getByText("Read the code").className).toContain("stg:text-foreground");
    // To do stays at the readable muted tone, never the faint one.
    expect(screen.getByText("Test it").className).toContain("stg:text-muted-foreground");
  });

  it("opens the item in progress while the turn works, to the steps it takes", () => {
    render(
      <PlanSteps
        working
        steps={stepsOf(todos("t", [{ content: "Fix it", status: "in_progress" }]), call("c1", "read_file", { path: "a.ts" }), use(R, "c2", "execute", { command: "npm test" }))}
      />,
    );
    const toggle = itemToggle("Fix it");

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    // No count on the item: its steps are right below it.
    expect(toggle.textContent).not.toMatch(/\d+ steps?/);
    expect(within(toggle).getByRole("img", { name: "In progress" })).toBeTruthy();
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)?.querySelector('[role="group"]')?.getAttribute("aria-label")).toBe("2 tool calls");
  });

  it("opens a finished item on a click to its steps", () => {
    render(
      <PlanSteps
        working
        steps={stepsOf(
          todos("t1", [{ content: "Read the code", status: "in_progress" }]),
          call("c1", "read_file", { path: "a.ts" }),
          todos("t2", [{ content: "Read the code", status: "completed" }]),
        )}
      />,
    );
    const toggle = itemToggle("Read the code");

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("group", { name: "1 tool call" })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("group", { name: "1 tool call" })).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.queryByRole("group", { name: "1 tool call" })).toBeNull();
  });

  it("says an item waits for you, and leaves its waiting step to the bottom card", () => {
    render(
      <ApprovalContext.Provider value={{ onAnswer: () => undefined, submittingIds: new Set(), errorsByToolUseId: new Map() }}>
        <PlanSteps working steps={waitingSteps()} />
      </ApprovalContext.Provider>,
    );
    const line = itemLine("Push the fix");

    expect(within(line).getByText("Waiting for you")).toBeTruthy();
    expect(within(line).getByRole("group", { name: "1 tool call" })).toBeTruthy();
  });

  it("tells a viewer who cannot answer whom the item waits on, by name or as the owner", () => {
    const { unmount } = render(
      <ApprovalContext.Provider value={{ submittingIds: new Set(), errorsByToolUseId: new Map(), approverName: "Maya Okafor" }}>
        <PlanSteps working steps={waitingSteps()} />
      </ApprovalContext.Provider>,
    );
    expect(within(itemLine("Push the fix")).getByText("Waiting for Maya Okafor to approve")).toBeTruthy();
    expect(screen.queryByText("Waiting for you")).toBeNull();
    unmount();

    render(<PlanSteps working steps={waitingSteps()} />);
    expect(within(itemLine("Push the fix")).getByText("Waiting for the owner")).toBeTruthy();
  });

  it("says where its ended turn stopped on an item left in progress, closed", () => {
    render(<PlanSteps working={false} steps={stepsOf(todos("t", [{ content: "Fix it", status: "in_progress" }]), call("c1", "read_file", { path: "a.ts" }))} />);
    const line = itemLine("Fix it");
    const toggle = itemToggle("Fix it");

    expect(within(line).getAllByText("Stopped here").length).toBe(1);
    expect(within(line).getByRole("img", { name: "Stopped" })).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("says the ending's own note: paused at a limit, stalled", () => {
    const steps = stepsOf(todos("t", [{ content: "Fix it", status: "in_progress" }]));
    render(<PlanSteps working={false} steps={steps} stoppedNote="Paused here" />);
    expect(within(itemLine("Fix it")).getByText("Paused here")).toBeTruthy();
  });

  it("folds the settled steps outside any item under 'Steps so far' and keeps the open ones as rows", () => {
    render(
      <PlanSteps
        working
        steps={stepsOf(
          call("c0", "edit_file", { path: "a.ts" }),
          use(R, "c1", "execute", { command: "npm run build" }),
          use(R, "c2", "delete_file", { path: "b.ts" }, { ask: true }),
          asked(R, "c2"),
          todos("t", [{ content: "Test it", status: "pending" }]),
        )}
      />,
    );
    const fold = screen.getByRole("button", { name: /^Steps so far: edited a\.ts/ });

    expect(fold.getAttribute("aria-expanded")).toBe("false");
    // The open step draws as a row; the waiting one is the bottom card's.
    expect(screen.getAllByRole("group", { name: "1 tool call" })).toHaveLength(1);
    expect(screen.queryByText(/b\.ts/)).toBeNull();

    fireEvent.click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByRole("group", { name: "1 tool call" })).toHaveLength(2);
  });

  it("draws no foot when every step sits under an item", () => {
    render(<PlanSteps working steps={stepsOf(todos("t", [{ content: "Fix it", status: "in_progress" }]), call("c1", "read_file", { path: "a.ts" }))} />);
    expect(screen.queryByRole("button", { name: /^Steps so far/ })).toBeNull();
    expect(screen.getAllByRole("group")).toHaveLength(1);
  });

  it("KIT-05 names what the agent is doing now: the item in progress, open to the step running", () => {
    render(
      <PlanSteps
        working
        steps={stepsOf(
          todos("t", [{ content: "Check the build", status: "in_progress" }]),
          use(R, "c1", "execute", { command: "npm test" }),
        )}
      />,
    );
    expect(itemLine("Check the build").querySelector('[aria-label="In progress"]')).not.toBeNull();
    expect(itemToggle("Check the build").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Running a command")).toBeTruthy();
  });

  it("keeps a failed step and a command running in the background out of the 'Steps so far' fold", () => {
    render(
      <PlanSteps
        working
        steps={stepsOf(
          use(R, "c1", "execute", { command: "npm test" }),
          result(R, "c1", "1 failed\n[Command failed with exit code 1]"),
          call("c2", "read_file", { path: "a.ts" }),
          todos("t", [{ content: "Test it", status: "pending" }]),
        )}
      />,
    );
    const fold = screen.getByRole("button", { name: /^Steps so far: read 1 file/ });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Command failed")).toBeTruthy();
  });
});
