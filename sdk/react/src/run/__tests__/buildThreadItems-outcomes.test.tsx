/**
 * Proves how a thread closes its turns and folds settled work for a host
 * that shows the turn's activity itself (the session view): with outcomes
 * on, every ended turn closes with one `outcome` item, after its failure
 * notice for the last, in place of the ended-turn phase badge; a working
 * turn gets none; with the tail's liveness off, no working dots compete
 * with the host's activity line. MessageThread hands its rows the outcome
 * renderer and, for every reader, folds a finished turn's working under one
 * "How it got there" line after its answer and outcome, and a working
 * turn's settled stretch of calls into one step row; both open to the rows
 * on a click, and a stretch with a call still running never folds.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { conversationOf, samples, scenarios, upTo, type Scenario } from "../../test";
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

    // A host that passes no outcome: the notice says how it ended, so no pill beside it.
    expect(kinds(buildThreadItems(fold.turns, runs))).not.toContain("phase-badge");
    expect(kinds(buildThreadItems(fold.turns, runs))).toContain("execution-error");
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
  function thread(scenario: Scenario) {
    const conversation = conversationOf(scenario);
    return <MessageThread turns={conversation.turns} runs={conversation.runs} turnOutcome={(turn) => <p>closed {turn.runId}</p>} />;
  }

  it("renders the host's outcome where a turn closes", () => {
    render(thread(scenarios.finished));
    expect(screen.getByText(`closed ${scenarios.finished.fold.turns[0]!.runId}`)).toBeTruthy();
  });

  it("folds a finished turn's working under one line after its answer and outcome, opening to the rows", () => {
    render(thread(scenarios.finished));
    const row = screen.getByRole("button", { name: /^How it got there: read 1 file, edited invoice\.ts, wrote 2 files/ });
    const answer = screen.getByText(/Fourteen invoices were a cent off/);
    const outcome = screen.getByText(`closed ${scenarios.finished.fold.turns[0]!.runId}`);
    expect(answer.compareDocumentPosition(outcome) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(outcome.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("rounding-cases.csv")).toBeNull();

    fireEvent.click(row);
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getAllByText("rounding-cases.csv").length).toBeGreaterThan(0);
  });

  it("folds a working turn's settled stretch into one step row for every reader", () => {
    // The finished scenario before its turn ended: every call returned, the answer written.
    const working = upTo(scenarios.finished, scenarios.finished.events.length - 1);
    render(thread(working));
    const row = screen.getByRole("button", { name: /^Read 1 file, edited invoice\.ts, wrote 2 files/ });
    expect(row.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("rounding-cases.csv")).toBeNull();
    expect(screen.queryByRole("button", { name: /^How it got there/ })).toBeNull();

    fireEvent.click(row);
    expect(screen.getAllByText("rounding-cases.csv").length).toBeGreaterThan(0);
  });

  it("never folds a run of calls while one still runs", () => {
    render(thread(scenarios.tools));
    expect(screen.queryByRole("button", { name: /^Read 1 file/ })).toBeNull();
  });
});
