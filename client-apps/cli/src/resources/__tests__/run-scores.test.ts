// Pins the `runs scores` view: one row per score with who gave it and its
// value in words (up/down for a person, pass/fail for the checks, "not
// graded" with its reason, never a failing value), the failed checks'
// reasons as flags, the list asked for by run id, and -o json carrying the
// scores' own envelopes.

import { create } from "@bufbuild/protobuf";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import {
  CriterionResult,
  ScoreSource,
  ScoreState,
} from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { ScoreListSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import type { ListScoresByRunRequest } from "@stigmer/protos/ai/stigmer/agentic/score/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { describe, expect, it } from "vitest";

import { renderScoresTable, showRunScores } from "../run-scores.js";

const thumbsDown: Score = create(ScoreSchema, {
  metadata: { id: "scr_1", org: "acme" },
  spec: {
    runId: "run_1",
    metric: "feedback",
    source: ScoreSource.human,
    value: { case: "passed", value: false },
    comment: "picked the wrong label",
  },
  status: {
    state: ScoreState.graded,
    audit: { specAudit: { createdBy: { id: "ida_1", email: "priya@example.com" } } },
  },
});

const health: Score = create(ScoreSchema, {
  metadata: { id: "scr_2", org: "acme" },
  spec: {
    runId: "run_1",
    metric: "run-health",
    source: ScoreSource.check,
    value: { case: "passed", value: false },
    criteria: [
      { name: "no-repeated-calls", result: CriterionResult.passed },
      {
        name: "last-action-succeeded",
        result: CriterionResult.failed,
        reason: "ended on a failed action: create_ticket (step 7)",
      },
    ],
  },
  status: { state: ScoreState.graded },
});

const notGraded: Score = create(ScoreSchema, {
  metadata: { id: "scr_3", org: "acme" },
  spec: { runId: "run_2", metric: "run-health", source: ScoreSource.check },
  status: { state: ScoreState.not_graded, notGradedReason: "grading could not start" },
});

describe("renderScoresTable", () => {
  it("shows a person's thumbs and comment, and who gave them", () => {
    const out = renderScoresTable([thumbsDown]);
    expect(out).toContain("feedback");
    expect(out).toContain("person");
    expect(out).toMatch(/\bdown\b/);
    expect(out).toContain("picked the wrong label");
    expect(out).toContain("priya@example.com");
  });

  it("shows a check's verdict with each failed check's reason as a flag", () => {
    const out = renderScoresTable([health]);
    expect(out).toMatch(/\bfail\b/);
    expect(out).toContain("last-action-succeeded: ended on a failed action: create_ticket (step 7)");
    expect(out).not.toContain("no-repeated-calls");
    expect(out).toContain("platform");
  });

  it("shows a run that could not be graded as not graded, with the reason", () => {
    const out = renderScoresTable([notGraded]);
    expect(out).toContain("not graded: grading could not start");
    expect(out).not.toMatch(/\bfail\b/);
  });

  it("says so when the run has no scores", () => {
    expect(renderScoresTable([])).toContain("No scores found");
  });
});

describe("showRunScores", () => {
  function clientReturning(items: Score[], asked: string[]): Stigmer {
    return {
      score: {
        listByRun: async (input: ListScoresByRunRequest) => {
          asked.push(input.runId);
          return create(ScoreListSchema, { totalCount: items.length, items });
        },
      },
    } as unknown as Stigmer;
  }

  it("lists the run's scores by its id and renders json as the scores' envelopes", async () => {
    const asked: string[] = [];
    let written = "";
    await showRunScores(clientReturning([thumbsDown], asked), "run_1", "json", {
      write: (text) => {
        written += text;
      },
    });
    expect(asked).toEqual(["run_1"]);
    const parsed = JSON.parse(written) as Array<{ spec: { metric: string } }>;
    expect(parsed.map((score) => score.spec.metric)).toEqual(["feedback"]);
  });
});
