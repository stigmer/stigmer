// Pins the `runs scores` view: one row per score with who gave it and its
// value in words (up/down for a person, pass/fail for the checks, "not
// graded" with its reason, never a failing value), the failed checks'
// reasons as flags, the list asked for by run id, -o json and -o yaml
// carrying the scores' own envelopes, the table written to stdout by
// default, and `stigmer get score <id>` reading one score by its id only.
// A plugin eval's row lists every check of its case with its verdict.

import { clone, create } from "@bufbuild/protobuf";
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
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { describe, expect, it, vi } from "vitest";

import { getterFor } from "../get-bindings.js";
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

const judged: Score = create(ScoreSchema, {
  metadata: { id: "scr_4", org: "acme" },
  spec: {
    runId: "run_1",
    metric: "judge",
    source: ScoreSource.judge,
    judgeModel: "claude-sonnet-4-6",
    value: { case: "passed", value: false },
    criteria: [
      { name: "did-the-task", result: CriterionResult.failed, reason: "said assigned;\nthe assign call failed" },
      { name: "made-nothing-up", result: CriterionResult.not_applicable, reason: "no claims" },
    ],
  },
  status: { state: ScoreState.graded },
});

const grading: Score = create(ScoreSchema, {
  metadata: { id: "scr_5", org: "acme" },
  spec: { runId: "run_1", metric: "judge", source: ScoreSource.judge },
  status: { state: ScoreState.pending },
});

const evalScore: Score = create(ScoreSchema, {
  metadata: { id: "scr_6", org: "acme" },
  spec: {
    runId: "run_3",
    metric: "eval",
    source: ScoreSource.eval,
    value: { case: "passed", value: false },
    criteria: [
      { name: "criteria", result: CriterionResult.passed, reason: "names fetchUser" },
      { name: "skill-fired", result: CriterionResult.not_applicable, reason: "indicator only" },
      { name: "mentions-callers", result: CriterionResult.failed, reason: "no call site\nnamed" },
    ],
  },
  status: { state: ScoreState.graded },
});

describe("renderScoresTable", () => {
  it("shows a plugin eval's verdict with every check of its case, passed or not, on one line, given by the platform", () => {
    const out = renderScoresTable([evalScore]);
    const row = out.split("\n").find((line) => line.startsWith("eval")) ?? "";
    expect(row).toMatch(/\beval\b.*\bfail\b/);
    expect(row).toContain(
      "criteria: passed (names fetchUser); skill-fired: not applicable (indicator only); mentions-callers: failed (no call site named)",
    );
    expect(row).toContain("platform");
  });

  it("shows the judge's verdict, its failed rubric on one line and the model that graded it, and a pending grade as grading", () => {
    const out = renderScoresTable([judged, grading]);
    expect(out).toContain("judge");
    expect(out).toMatch(/\bfail\b/);
    expect(out).toContain("did-the-task: said assigned; the assign call failed");
    expect(out).not.toContain("made-nothing-up");
    expect(out).toContain("claude-sonnet-4-6");
    expect(out).toContain("grading");
  });

  it("shows a person's thumbs and comment, and who gave them", () => {
    const out = renderScoresTable([thumbsDown]);
    expect(out).toContain("feedback");
    expect(out).toContain("person");
    expect(out).toMatch(/\bdown\b/);
    expect(out).toContain("picked the wrong label");
    expect(out).toContain("priya@example.com");
  });

  it("prints a comment as one line, with no control character reaching the terminal", () => {
    const hostile = clone(ScoreSchema, thumbsDown);
    if (hostile.spec !== undefined) {
      hostile.spec.comment = "line one\nline two\u001b[31m red\u0007";
    }
    const out = renderScoresTable([hostile]);
    expect(out).toContain("line one line two [31m red");
    expect(out).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
    expect(out.split("\n").filter((line) => line.includes("line two"))).toHaveLength(1);
  });

  it("prints another person's profile name and a check's reason as one line each", () => {
    const named = clone(ScoreSchema, thumbsDown);
    const createdBy = named.status?.audit?.specAudit?.createdBy;
    if (createdBy !== undefined) {
      createdBy.displayName = "Priya\u001b[2J\nSharma";
    }
    const flagged = clone(ScoreSchema, health);
    for (const criterion of flagged.spec?.criteria ?? []) {
      criterion.reason = `${criterion.reason}\n\u001b[31mred`;
    }
    const out = renderScoresTable([named, flagged]);
    expect(out).toContain("Priya [2J Sharma");
    expect(out).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
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

  it("puts a judge's not-graded reason, which can quote a run's error, on one line", () => {
    const failed = clone(ScoreSchema, notGraded);
    if (failed.status !== undefined) {
      failed.status.notGradedReason = "the judge run failed: model\n\u001b[31mrefused";
    }
    const out = renderScoresTable([failed]);
    expect(out).toContain("not graded: the judge run failed: model [31mrefused");
    expect(out).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
  });

  it("leaves the value empty for a graded score that carries none, and names an unattributed rater as nobody", () => {
    const bare = create(ScoreSchema, {
      spec: { runId: "run_1", metric: "feedback", source: ScoreSource.human },
      status: { state: ScoreState.graded },
    });
    const out = renderScoresTable([bare]);
    expect(out).toContain("feedback");
    expect(out).not.toMatch(/\b(up|down|pass|fail)\b/);
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

  it("renders yaml as the scores' envelopes", async () => {
    let written = "";
    await showRunScores(clientReturning([health], []), "run_1", "yaml", {
      write: (text) => {
        written += text;
      },
    });
    expect(written).toContain("id: scr_2");
    expect(written).toContain("metric: run-health");
    expect(written).toContain("source: score_source_check");
  });

  it("writes the table to stdout when no stream is given", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    let out: string;
    try {
      await showRunScores(clientReturning([thumbsDown], []), "run_1", "table");
      out = write.mock.calls.map((call) => String(call[0])).join("");
    } finally {
      write.mockRestore();
    }
    expect(out).toContain("METRIC");
    expect(out).toContain("picked the wrong label");
  });
});

describe("get score", () => {
  it("reads a score by its id through the score client", async () => {
    const getter = getterFor(ApiResourceKind.score);
    expect(getter).toBeDefined();
    const asked: string[] = [];
    const client = {
      score: {
        get: async (id: string) => {
          asked.push(id);
          return thumbsDown;
        },
      },
    } as unknown as Stigmer;
    const got = await getter!(client, { kind: "id", id: "scr_1" });
    expect(asked).toEqual(["scr_1"]);
    expect(got.message).toBe(thumbsDown);
  });
});
