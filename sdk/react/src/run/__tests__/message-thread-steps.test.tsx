/**
 * Proves how MessageThread draws a turn's steps: a turn that keeps a to-do
 * list draws one plan card (its count, the item in progress open to its
 * steps while the turn works) and no rows of its own beside it; a step
 * that waits for a person leaves its item saying "Waiting for you" and is
 * answered on the bottom card, Allow routed with its id; and a finished
 * turn's working, its plan included, waits closed under one "How it got
 * there" line after the answer, opening to the plan and its rows, an item
 * the turn left in progress saying it is not finished.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import type { Turn } from "@stigmer/client";
import { conversationOf, scenarios, stepStories, type Scenario } from "../../test";
import { MessageThread, type MessageThreadProps } from "../MessageThread";
import { conversation, result, use } from "./__fixtures__/thread-events";

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    vi.fn(() => ({
      observe: vi.fn(),
      unobserve: vi.fn(),
      disconnect: vi.fn(),
      takeRecords: vi.fn(() => []),
      root: null,
      rootMargin: "",
      thresholds: [0],
    })),
  );
  vi.stubGlobal("ResizeObserver", vi.fn(() => ({ observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() })));
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((cb: FrameRequestCallback) => {
      cb(performance.now());
      return 1;
    }),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderThread(conv: { turns: readonly Turn[]; runs: readonly Run[] }, props: Partial<MessageThreadProps> = {}) {
  return render(<MessageThread turns={conv.turns} runs={conv.runs} {...props} />);
}

function renderScenario(scenario: Scenario, props: Partial<MessageThreadProps> = {}) {
  const conv = conversationOf(scenario);
  return renderThread({ turns: conv.turns, runs: conv.runs }, props);
}

/** The control that opens a plan item, by its words. */
function itemToggle(words: string): HTMLButtonElement | null {
  return screen.getByText(words).closest("li")!.querySelector<HTMLButtonElement>(":scope > button");
}

describe("MessageThread steps", () => {
  it("draws a working to-do turn as its plan, the item in progress open to its steps and each done item closed over its own", () => {
    renderScenario(scenarios.busy);
    const plan = screen.getByRole("region", { name: "Plan" });

    expect(within(plan).getByText("2 of 5 done")).toBeTruthy();
    expect(itemToggle("Apply the same rule to credit notes")?.getAttribute("aria-expanded")).toBe("true");
    expect(itemToggle("Find every place invoices round")?.getAttribute("aria-expanded")).toBe("false");
    expect(itemToggle("Add tests for the half-cent cases")).toBeNull();
    // Every step sits in the plan: no group of rows is drawn beside it.
    const groups = screen.getAllByRole("group", { name: /tool call/ });
    expect(groups.length).toBeGreaterThan(0);
    expect(groups.every((group) => plan.contains(group))).toBe(true);
  });

  it("says the item waits for you and answers the waiting step on the bottom card", () => {
    const onAnswer = vi.fn();
    const story = stepStories["shell-steps"];
    renderScenario(story, { onAnswerToolUse: onAnswer });
    const plan = screen.getByRole("region", { name: "Plan" });
    const card = screen.getByRole("alert", { name: "Approval required for execute" });

    expect(within(plan).getByText("Waiting for you")).toBeTruthy();
    expect(plan.contains(card)).toBe(false);
    fireEvent.click(within(card).getByRole("button", { name: "Allow" }));
    expect(onAnswer).toHaveBeenCalledWith(`${story.fold.turns[0]!.runId}.tc-execute-push`, "allow", undefined);
  });

  it("folds a finished turn's plan under 'How it got there', after its answer, opening to it", () => {
    renderThread(
      conversation({
        id: "f",
        reply: "Fixed what I could.",
        extra: [
          use("f", "t", "write_todos", { todos: [{ content: "Fix it", status: "in_progress" }] }),
          result("f", "t", "ok"),
          use("f", "c1", "read_file", { path: "a.ts" }),
          result("f", "c1", "ok"),
        ],
      }),
    );
    const line = screen.getByRole("button", { name: /^How it got there: read 1 file/ });

    expect(screen.getByText("Fixed what I could.").compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("region", { name: "Plan" })).toBeNull();

    fireEvent.click(line);
    const plan = screen.getByRole("region", { name: "Plan" });
    expect(within(plan).getByText("0 of 1 done")).toBeTruthy();
    expect(within(plan).getAllByText("Stopped here")).toHaveLength(1);
    expect(itemToggle("Fix it")?.getAttribute("aria-expanded")).toBe("false");
  });
});
