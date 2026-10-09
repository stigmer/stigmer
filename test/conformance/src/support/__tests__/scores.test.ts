// Pins the score suites' fixtures and their run-health read (support/scores.ts):
// a rating carries the feedback metric, a person's source and its thumbs as a
// set value (false included); a forged check carries the check's source; an
// edit changes only the thumbs and the comment; and the run-health read polls
// a run's scores until the grading workflow has written one, failing loudly
// once its budget is spent. The clients are stubbed; nothing here starts a
// server.
import { create } from "@bufbuild/protobuf";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreSource } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import { describe, expect, it } from "vitest";
import type { ConformanceClients } from "../../harness/clients";
import {
  FEEDBACK,
  RUN_HEALTH,
  awaitRunHealth,
  editedFeedback,
  makeFeedback,
  makeForgedCheck,
  runNotCompletedMessage,
  scoreOrgMismatchMessage,
} from "../scores";

function clientsListing(pages: Score[][]): { clients: ConformanceClients; asked: () => number } {
  let calls = 0;
  const clients = {
    scoreQuery: {
      listByRun: async () => {
        const items = pages[Math.min(calls, pages.length - 1)] ?? [];
        calls += 1;
        return { items };
      },
    },
  } as unknown as ConformanceClients;
  return { clients, asked: () => calls };
}

function scoreWith(metric: string): Score {
  return create(ScoreSchema, { metadata: { id: `scr_${metric}` }, spec: { runId: "run_1", metric } });
}

describe("score fixtures", () => {
  it("a rating carries the feedback metric, a person's source and a set false", () => {
    const rating = makeFeedback("org_1", "run_1", false, "wrong label");
    expect(rating.metadata).toEqual({ org: "org_1" });
    expect(rating.spec).toMatchObject({
      runId: "run_1",
      metric: FEEDBACK,
      source: ScoreSource.human,
      value: { case: "passed", value: false },
      comment: "wrong label",
    });
  });

  it("a forged check carries the check's source and metric", () => {
    expect(makeForgedCheck("org_1", "run_1").spec).toMatchObject({
      metric: RUN_HEALTH,
      source: ScoreSource.check,
    });
  });

  it("an edit changes only the thumbs and the comment", () => {
    const stored = create(ScoreSchema, {
      metadata: { id: "scr_1", org: "org_1" },
      spec: { runId: "run_1", metric: FEEDBACK, value: { case: "passed", value: false }, comment: "before" },
    });
    const edited = editedFeedback(stored, true, "after");
    expect(edited.metadata?.id).toBe("scr_1");
    expect(edited.spec?.metric).toBe(FEEDBACK);
    expect(edited.spec?.value).toEqual({ case: "passed", value: true });
    expect(edited.spec?.comment).toBe("after");
    expect(stored.spec?.comment, "the stored score is left as it was").toBe("before");
  });

  it("the refusal copy names the run and the run's organization", () => {
    expect(runNotCompletedMessage("run_9")).toBe("run run_9 has not completed; only a completed run is scored");
    expect(scoreOrgMismatchMessage("org_9")).toBe("metadata.org must be the run's organization (org_9)");
  });
});

describe("awaitRunHealth", () => {
  it("polls until the run-health score is written, then returns it", async () => {
    const health = scoreWith(RUN_HEALTH);
    const { clients, asked } = clientsListing([[], [scoreWith(FEEDBACK)], [scoreWith(FEEDBACK), health]]);
    await expect(awaitRunHealth(clients, "run_1", 5_000)).resolves.toBe(health);
    expect(asked()).toBe(3);
  });

  it("fails naming the run once its budget is spent", async () => {
    const { clients } = clientsListing([[]]);
    await expect(awaitRunHealth(clients, "run_7", 0)).rejects.toThrow(
      "run run_7 carries no run-health score after 0 ms",
    );
  });
});
