/**
 * Proves how a thread closes its turns and folds settled work for a host
 * that shows the turn's activity itself (the session view): with outcomes
 * on, every ended turn closes with one `outcome` item, after its failure
 * notice for the last, in place of the ended-turn phase badge; a working
 * turn gets none; with the tail's liveness off, no working dots compete
 * with the host's activity line. MessageThread hands its rows the outcome
 * renderer and, for the people who want the result, folds a settled run of
 * tool calls into one step row that opens to them, never one still running.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { conversationOf, samples, scenarios } from "../../test";
import { buildThreadItems, MessageThread } from "../MessageThread";

afterEach(cleanup);

function kinds(items: ReturnType<typeof buildThreadItems>) {
  return items.map((item) => item.kind);
}

describe("buildThreadItems outcomes", () => {
  it("closes every ended turn with one outcome, the last after its failure notice, with no phase badge", () => {
    const first = samples.turnEvents({ runId: "run_a", message: "One" });
    const second = samples.turnEvents({ runId: "run_b", message: "Two", phase: "running", reply: "" });
    const failed = [...second, samples.runStatusEvent("failed", { runId: "run_b", error: "the provider refused" })];
    const fold = samples.fold([...first, ...failed]);
    const runs = fold.turns.map((turn) => samples.run({ id: turn.runId }));

    const items = buildThreadItems(fold.turns, runs, { includeOutcomes: true });
    expect(items.filter((item) => item.kind === "outcome").map((item) => (item.kind === "outcome" ? item.turn.runId : ""))).toEqual([
      "run_a",
      "run_b",
    ]);
    expect(kinds(items)).not.toContain("phase-badge");
    expect(kinds(items).slice(-2)).toEqual(["execution-error", "outcome"]);

    expect(kinds(buildThreadItems(fold.turns, runs))).toContain("phase-badge");
    expect(kinds(buildThreadItems(fold.turns, runs))).not.toContain("outcome");
  });

  it("closes no working turn", () => {
    const busy = scenarios.busy;
    expect(kinds(buildThreadItems(busy.fold.turns, busy.runs, { includeOutcomes: true }))).not.toContain("outcome");
  });

  it("leaves the tail's working dots to the host's activity line when asked", () => {
    const streaming = scenarios.streaming;
    expect(kinds(buildThreadItems(streaming.fold.turns, streaming.runs))).toContain("liveness");
    expect(kinds(buildThreadItems(streaming.fold.turns, streaming.runs, { includeLiveness: false }))).not.toContain("liveness");
  });
});

describe("MessageThread presentation", () => {
  function thread(scenario: (typeof scenarios)[keyof typeof scenarios], fold: boolean) {
    const conversation = conversationOf(scenario);
    return (
      <MessageThread
        turns={conversation.turns}
        runs={conversation.runs}
        turnOutcome={(turn) => <p>closed {turn.runId}</p>}
        foldSettledSteps={fold}
      />
    );
  }

  it("renders the host's outcome where a turn closes", () => {
    render(thread(scenarios.finished, false));
    expect(screen.getByText(`closed ${scenarios.finished.fold.turns[0]!.runId}`)).toBeTruthy();
  });

  it("folds a settled run of calls into one step row that opens to them", () => {
    render(thread(scenarios.finished, true));
    const row = screen.getByRole("button", { name: /Read 1 file, edited invoice\.ts, wrote 2 files/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("rounding-cases.csv")).toBeNull();

    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByText("rounding-cases.csv").length).toBeGreaterThan(0);
  });

  it("keeps every row for a builder", () => {
    render(thread(scenarios.finished, false));
    expect(screen.queryByRole("button", { name: /Read 1 file, edited invoice\.ts/ })).toBeNull();
    expect(screen.getAllByText("rounding-cases.csv").length).toBeGreaterThan(0);
  });

  it("never folds a run of calls while one still runs", () => {
    render(thread(scenarios.tools, true));
    expect(screen.queryByRole("button", { name: /^Read 1 file/ })).toBeNull();
  });
});
