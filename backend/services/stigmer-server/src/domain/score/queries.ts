/**
 * The score kind's shared reads, all through the list index (list-index.ts
 * beside this file): one run's scores, for the run's list, the create
 * chain's one-per-person rule, the grading activity's skip and the
 * run-delete cascade; one session's scores, for the conversation's list.
 * Rows come newest created first, the index order.
 *
 * Every row is re-checked against the run or session it was asked for,
 * whatever the index returned. Undecodable rows are skipped: one bad
 * record must not take a run's scores down, and each skipped row is logged
 * with its id and the run or session asked for, since a skipped row is one
 * the run-delete cascade and the one-per-person rule cannot see. A store
 * fault is thrown as it came; each caller maps it with its own copy.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { ScoreSchema } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import type { Store } from "../../store/interface.js";
import type { ListIndexRow } from "../../store/list-index.js";
import { scoreListIndex } from "./list-index.js";

/** Every score of one run. */
export async function listRunScores(
  store: Store,
  logger: Logger,
  runId: string,
): Promise<Score[]> {
  const rows = await store.queryResources(scoreListIndex, {
    anyKey: [{ name: "run", value: runId }],
  });
  return decodeScores(rows, logger, { runId }).filter(
    (score) => score.spec?.runId === runId,
  );
}

/** Every score of every run in one session. */
export async function listSessionScores(
  store: Store,
  logger: Logger,
  sessionId: string,
): Promise<Score[]> {
  const rows = await store.queryResources(scoreListIndex, {
    anyKey: [{ name: "session", value: sessionId }],
  });
  return decodeScores(rows, logger, { sessionId }).filter(
    (score) => score.spec?.sessionId === sessionId,
  );
}

function decodeScores(
  rows: ReadonlyArray<ListIndexRow>,
  logger: Logger,
  askedFor: Readonly<Record<string, string>>,
): Score[] {
  const scores: Score[] = [];
  for (const row of rows) {
    try {
      scores.push(fromBinary(ScoreSchema, row.data));
    } catch (error) {
      logger.warn("skipped a score row that does not decode", {
        scoreId: row.id,
        ...askedFor,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return scores;
}
