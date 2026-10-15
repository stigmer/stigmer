/**
 * The eval run kind's shared reads, through the list indexes: a subject's
 * eval runs, newest first (listByAgent, listByPlugin, the subject-delete
 * cascades), and an eval run's tries' sessions (its delete), found through
 * the session index's `eval_run` key. Every row is re-checked against what
 * it was asked for, whatever the index returned; undecodable rows are
 * skipped and logged, as the evaluator's reads do (domain/evaluator/
 * queries.ts); a store fault is thrown as it came.
 */
import { fromBinary } from "@bufbuild/protobuf";

import { EvalRunSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import type { EvalRun } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";

import type { Logger } from "../../boot/logger.js";
import type { Store } from "../../store/interface.js";
import { sessionListIndex } from "../session/list-index.js";
import { EVAL_RUN_LABEL } from "./constants.js";
import { evalRunListIndex } from "./list-index.js";
import type { EvalRunSubject } from "./subject.js";
import { subjectOf } from "./subject.js";

/** Every eval run about one subject, newest first. */
export async function listEvalRuns(
  store: Store,
  logger: Logger,
  subject: EvalRunSubject,
): Promise<EvalRun[]> {
  const rows = await store.queryResources(evalRunListIndex, {
    anyKey: [{ name: subject.kind, value: subject.id }],
  });
  const evalRuns: EvalRun[] = [];
  for (const row of rows) {
    try {
      evalRuns.push(fromBinary(EvalRunSchema, row.data));
    } catch (error) {
      logger.warn("skipped an eval run row that does not decode", {
        evalRunId: row.id,
        subject: `${subject.kind} ${subject.id}`,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return evalRuns.filter((evalRun) => {
    const about = subjectOf(evalRun.spec);
    return about?.kind === subject.kind && about.id === subject.id;
  });
}

/** The ids of an eval run's tries' sessions: the sessions carrying its label. */
export async function listTrySessionIds(
  store: Store,
  logger: Logger,
  evalId: string,
): Promise<string[]> {
  const rows = await store.queryResources(sessionListIndex, {
    anyKey: [{ name: "eval_run", value: evalId }],
  });
  const ids: string[] = [];
  for (const row of rows) {
    try {
      const session = fromBinary(SessionSchema, row.data);
      if (session.metadata?.labels[EVAL_RUN_LABEL] === evalId) {
        ids.push(row.id);
      }
    } catch (error) {
      logger.warn("skipped a session row that does not decode", {
        sessionId: row.id,
        evalId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return ids;
}
