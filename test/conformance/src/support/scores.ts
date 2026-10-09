// Canonical Score fixtures, the run-health read, and the score lanes'
// contract copy for the conformance suites.
// Domain: conformance support.
//
// A Score grades a finished run: a person's thumbs (`feedback`, source
// human) or the platform's free checks (`run-health`, source check, written
// by the server alone when a run completes). The copy constants are
// cross-edition contract strings, byte-pinned in the server
// (domain/score/constants.ts) and asserted here over the wire.
import { create } from "@bufbuild/protobuf";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreSource } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import type { ConformanceClients } from "../harness/clients";
import type { InitShape } from "./init-shape";

export const SCORE_API_VERSION = "agentic.stigmer.ai/v1";
export const SCORE_KIND = "Score";

export const FEEDBACK = "feedback";
export const RUN_HEALTH = "run-health";

export const NO_REPEATED_CALLS = "no-repeated-calls";
export const LAST_ACTION_SUCCEEDED = "last-action-succeeded";
export const STRUCTURED_OUTPUT_DELIVERED = "structured-output-delivered";

// ─── Contract copy (byte-pinned in the server) ─────────────────────────────

export const CHECK_SOURCE_REFUSED_MESSAGE =
  "run-health scores are written by the platform's checks, never through the API";
export const SCORE_CREATE_DENIED_MESSAGE = "unauthorized to score run";
export const SCORE_UPDATE_HUMAN_ONLY_MESSAGE =
  "only a person's feedback can be changed; a check's verdict is final";
export const SCORE_EXISTS_REASON = "SCORE_EXISTS";

export function runNotCompletedMessage(runId: string): string {
  return `run ${runId} has not completed; only a completed run is scored`;
}

export function scoreOrgMismatchMessage(runOrg: string): string {
  return `metadata.org must be the run's organization (${runOrg})`;
}

// A person's thumbs on a run.
export function makeFeedback(
  org: string,
  runId: string,
  passed: boolean,
  comment = "",
): InitShape<typeof ScoreSchema> {
  return {
    apiVersion: SCORE_API_VERSION,
    kind: SCORE_KIND,
    metadata: { org },
    spec: {
      runId,
      name: FEEDBACK,
      source: ScoreSource.human,
      value: { case: "passed", value: passed },
      comment,
    },
  };
}

// A run-health score as a caller would forge it; only the server may give
// one.
export function makeForgedCheck(org: string, runId: string): InitShape<typeof ScoreSchema> {
  return {
    apiVersion: SCORE_API_VERSION,
    kind: SCORE_KIND,
    metadata: { org },
    spec: {
      runId,
      name: RUN_HEALTH,
      source: ScoreSource.check,
      value: { case: "passed", value: true },
    },
  };
}

// The update input for a stored feedback score with a new value and comment.
export function editedFeedback(stored: Score, passed: boolean, comment: string): Score {
  const edited = create(ScoreSchema, stored);
  if (edited.spec !== undefined) {
    edited.spec.value = { case: "passed", value: passed };
    edited.spec.comment = comment;
  }
  return edited;
}

// The run's run-health score, polled until the grading workflow has written
// it: grading starts when the run completes and runs on its own queue.
export async function awaitRunHealth(
  clients: ConformanceClients,
  runId: string,
  timeoutMs = 30_000,
): Promise<Score> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const list = await clients.scoreQuery.listByRun({ runId });
    const health = list.items.find((score) => score.spec?.name === RUN_HEALTH);
    if (health !== undefined) {
      return health;
    }
    if (Date.now() > deadline) {
      throw new Error(`run ${runId} carries no run-health score after ${timeoutMs} ms`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
}
