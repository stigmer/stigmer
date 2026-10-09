/**
 * The score kind's shared reads, all through the list index (list-index.ts
 * beside this file): one run's scores, for the run's list, the create
 * chain's one-per-person rule, the grading activity's skip and the
 * run-delete cascade; one session's scores, for the conversation's list.
 * Rows come newest created first, the index order.
 *
 * Every row is re-checked against the run or session it was asked for,
 * whatever the index returned. Undecodable rows are skipped: one bad
 * record must not take a run's scores down. A store fault is thrown as it
 * came; each caller maps it with its own copy.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";

import type { Store } from "../../store/interface.js";
import type { ListIndexRow } from "../../store/list-index.js";
import { scoreListIndex } from "./list-index.js";

/** Every score of one run. */
export async function listRunScores(
  store: Store,
  runId: string,
): Promise<Score[]> {
  const rows = await store.queryResources(scoreListIndex, {
    anyKey: [{ name: "run", value: runId }],
  });
  return decodeScores(rows).filter((score) => score.spec?.runId === runId);
}

/** Every score of every run in one session. */
export async function listSessionScores(
  store: Store,
  sessionId: string,
): Promise<Score[]> {
  const rows = await store.queryResources(scoreListIndex, {
    anyKey: [{ name: "session", value: sessionId }],
  });
  return decodeScores(rows).filter(
    (score) => score.spec?.sessionId === sessionId,
  );
}

function decodeScores(rows: ReadonlyArray<ListIndexRow>): Score[] {
  const scores: Score[] = [];
  for (const row of rows) {
    try {
      scores.push(fromBinary(ScoreSchema, row.data));
    } catch {
      continue;
    }
  }
  return scores;
}
