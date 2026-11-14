// Tests for the load test's report (report.ts): each run's start and ending
// read apart (a run stopped at its budget still started; a wait that ran out
// and any other ending before a start are named; a run the watch outlived is
// still waiting); "to start" from the server's two stamps, unclear when a
// stamp is coarse or the pair is out of order, and then left out of the
// figures; the largest reported wait shown "≥"; "No run reported waiting"
// said in its own line; refusals grouped by code and sentence; the spend
// summed from the runs' estimates; the table, JSON and YAML.

import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { runOf } from "../../__test-utils__/load-test-server.js";
import { type BurstFrame, buildReport, outcomeOf, renderReport, type RunSighting, summaryLines, usd } from "../report.js";

const FRAME: BurstFrame = { server: "https://api.example.com", org: "acme", agent: "load-test-abc123", requested: 6, budgetUsd: 1, shareUsd: 1 / 6 };
const PLAN = "Your organization is at its plan's number of agents running at once.";

function sighting(index: number, extra: Partial<RunSighting>): RunSighting {
  return { index, runId: `run_${index}`, sessionId: `ses_${index}`, ...extra };
}

const STARTED = sighting(1, { run: runOf({ phase: RunPhase.RUN_COMPLETED, startedAt: "2026-11-14T10:00:05.250Z", cost: 0.0007 }) });
const WAITED = sighting(2, {
  run: runOf({ phase: RunPhase.RUN_COMPLETED, startedAt: "2026-11-14T10:01:43.000Z", cost: 0.0007 }),
  waitedMs: 92_000,
});
const AT_BUDGET = sighting(3, {
  run: runOf({ phase: RunPhase.RUN_FAILED, startedAt: "2026-11-14T10:00:06.000Z", cost: 0.17, stopCause: "budget_reached", stopKind: "cost_cap" }),
});
const REFUSED = sighting(4, { runId: "", sessionId: "", refusal: { code: "resource-exhausted", message: PLAN } });
const RAN_OUT = sighting(5, { run: runOf({ phase: RunPhase.RUN_FAILED, stopCause: "infrastructure", stopKind: "no_sandbox_room" }), waitedMs: 895_000 });
const STILL = sighting(6, { run: runOf({ phase: RunPhase.RUN_PENDING }), waitedMs: 1_190_000 });

describe("outcomeOf", () => {
  it("times a started run from the server's two stamps and names how it ended", () => {
    expect(outcomeOf(STARTED)).toEqual({
      index: 1,
      runId: "run_1",
      sessionId: "ses_1",
      start: "started",
      toStartMs: 3250,
      toStartUnclear: false,
      waitedForRoomMs: null,
      ending: "completed",
      stopCause: "",
      stopKind: "",
      costUsd: 0.0007,
      refusal: null,
    });
  });

  it("counts a run stopped at its budget as started", () => {
    expect(outcomeOf(AT_BUDGET)).toMatchObject({ start: "started", ending: "stopped at its budget", stopCause: "budget_reached" });
  });

  it("names any other ending by its cause and kind, or its phase", () => {
    const failed = sighting(1, { run: runOf({ phase: RunPhase.RUN_FAILED, startedAt: "2026-11-14T10:00:05.250Z", stopCause: "model_error", stopKind: "provider_key_missing" }) });
    expect(outcomeOf(failed).ending).toBe("model_error (provider_key_missing)");
    const cancelled = sighting(1, { run: runOf({ phase: RunPhase.RUN_CANCELLED, startedAt: "2026-11-14T10:00:05.250Z", stopCause: "user" }) });
    expect(outcomeOf(cancelled).ending).toBe("user");
    const failedQuietly = sighting(1, { run: runOf({ phase: RunPhase.RUN_FAILED, startedAt: "2026-11-14T10:00:05.250Z" }) });
    expect(outcomeOf(failedQuietly).ending).toBe("failed");
    const working = sighting(1, { run: runOf({ phase: RunPhase.RUN_IN_PROGRESS, startedAt: "2026-11-14T10:00:05.250Z" }) });
    expect(outcomeOf(working)).toMatchObject({ start: "started", ending: "" });
  });

  it("reads a refusal, a wait that ran out, another ending before a start, and a run still waiting", () => {
    expect(outcomeOf(REFUSED)).toMatchObject({ start: "refused", refusal: { code: "resource-exhausted", message: PLAN }, costUsd: null });
    expect(outcomeOf(RAN_OUT)).toMatchObject({ start: "wait ran out", waitedForRoomMs: 895_000, ending: "" });
    const lost = sighting(1, { run: runOf({ phase: RunPhase.RUN_FAILED, stopCause: "infrastructure", stopKind: "runner_lost" }) });
    expect(outcomeOf(lost)).toMatchObject({ start: "never started", ending: "infrastructure (runner_lost)" });
    expect(outcomeOf(STILL)).toMatchObject({ start: "still waiting", toStartMs: null, toStartUnclear: false });
    expect(outcomeOf(sighting(1, {}))).toMatchObject({ start: "still waiting" });
  });

  it("calls a coarse stamp, a missing one or an out-of-order pair unclear", () => {
    const coarse = sighting(1, { run: runOf({ phase: RunPhase.RUN_COMPLETED, startedAt: "2026-11-14T10:00:05Z" }) });
    expect(outcomeOf(coarse)).toMatchObject({ start: "started", toStartMs: null, toStartUnclear: true });
    const noCreate = sighting(1, { run: { ...STARTED.run!, status: { ...STARTED.run!.status!, audit: undefined } } });
    expect(outcomeOf(noCreate).toStartUnclear).toBe(true);
    const backwards = sighting(1, { run: runOf({ phase: RunPhase.RUN_COMPLETED, startedAt: "2026-11-14T10:00:01.000Z", createdAt: new Date("2026-11-14T10:00:02.500Z") }) });
    expect(outcomeOf(backwards).toStartUnclear).toBe(true);
  });
});

describe("buildReport", () => {
  const report = buildReport(FRAME, [STARTED, WAITED, AT_BUDGET, REFUSED, RAN_OUT, STILL], []);

  it("counts each start, gives the figures and sums the spend", () => {
    expect(report.counts).toEqual({ started: 3, refused: 1, waitRanOut: 1, neverStarted: 0, stillWaiting: 1 });
    expect(report.toStartMs).toEqual({ median: 4000, p90: 101_000, longest: 101_000, unclear: 0 });
    expect(report.waitedForRoomMs).toEqual({ median: 895_000, p90: 1_190_000, longest: 1_190_000, runs: 3 });
    expect(report.anyWaitReported).toBe(true);
    expect(report.refusals).toEqual([{ code: "resource-exhausted", message: PLAN, count: 1 }]);
    expect(report.spentUsd).toBeCloseTo(0.1714, 6);
  });

  it("groups refusals by code and sentence", () => {
    const other = sighting(7, { runId: "", sessionId: "", refusal: { code: "unavailable", message: "down" } });
    const grouped = buildReport(FRAME, [REFUSED, { ...REFUSED, index: 5 }, other], []);
    expect(grouped.refusals).toEqual([
      { code: "resource-exhausted", message: PLAN, count: 2 },
      { code: "unavailable", message: "down", count: 1 },
    ]);
  });

  it("prints the table and the summary", () => {
    const text = renderReport(report, "table");
    const [table, summary] = text.split("\n\n");
    expect(table?.split("\n")[0]).toBe("#   START           TO START   WAITED FOR A SANDBOX   ENDING                  COST");
    expect(table).toContain("2   started         1m 41s     ≥ 1m 32s               completed               $0.0007");
    expect(table).toContain("3   started         4s         -                      stopped at its budget   $0.17");
    expect(table).toContain("4   refused         -          -                      -                       -");
    expect(table).toContain("5   wait ran out    -          ≥ 14m 55s");
    expect(summary).toBe(
      [
        "6 agents: 3 started, 1 refused, 1 wait ran out, 1 still waiting.",
        "To start: median 4s, 90th percentile 1m 41s, longest 1m 41s.",
        "Waited for a sandbox, 3 runs: median 14m 55s, 90th percentile 19m 50s, longest 19m 50s (at least).",
        `Refused 1: resource-exhausted, "${PLAN}"`,
        "Spent about $0.17, by the runs' own estimates.",
        "",
      ].join("\n"),
    );
  });

  it("says no run reported a wait, and names unclear starts and runs that never started", () => {
    const coarse = sighting(2, { run: runOf({ phase: RunPhase.RUN_COMPLETED, startedAt: "2026-11-14T10:00:05Z" }) });
    const lost = sighting(3, { run: runOf({ phase: RunPhase.RUN_FAILED, stopCause: "infrastructure", stopKind: "runner_lost" }) });
    const quiet = buildReport({ ...FRAME, requested: 3 }, [STARTED, coarse, lost], []);
    expect(quiet.anyWaitReported).toBe(false);
    expect(summaryLines(quiet)).toEqual([
      "3 agents: 2 started, 1 never started.",
      "To start: median 3s, 90th percentile 3s, longest 3s.",
      "To start was unclear for 1 run: a stamp was too coarse to time it.",
      "No run reported waiting for a sandbox during the burst.",
      "Spent about $0.0007, by the runs' own estimates.",
    ]);
    const one = buildReport({ ...FRAME, requested: 1 }, [REFUSED], []);
    expect(summaryLines(one)[0]).toBe("1 agent: 0 started, 1 refused.");
    expect(one.toStartMs).toEqual({ median: null, p90: null, longest: null, unclear: 0 });
  });

  it("prints clean JSON and YAML documents", () => {
    const json = JSON.parse(renderReport(report, "json")) as Record<string, unknown>;
    expect(Object.keys(json)).toEqual([
      "server", "org", "agent", "requested", "budgetUsd", "shareUsd", "counts", "toStartMs", "waitedForRoomMs",
      "anyWaitReported", "refusals", "spentUsd", "runs", "leftBehind",
    ]);
    expect(parse(renderReport(report, "yaml"))).toEqual(json);
  });
});

describe("usd", () => {
  it("prints cents, four places below a cent, and zero as cents", () => {
    expect([usd(1), usd(0.1666), usd(0.0007), usd(0)]).toEqual(["$1.00", "$0.17", "$0.0007", "$0.00"]);
  });
});
