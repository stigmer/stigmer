/**
 * The seam between the suite's activities (suite-activities.ts) and the
 * row they write: the status book reads the eval run's phase and threshold
 * and writes its status through the store's atomic read-modify-write,
 * handing the activity a view (run-status.ts). The scalar fields are
 * changed in place; the cases, found across the plugins' blocks, their
 * totals and the skeleton go through the view's methods.
 */
import type { EvalRunCase, EvalRunPhase, EvalRunStatus } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";

import type { Store } from "../../store/interface.js";
import type { EvalContext } from "./context.js";

/** What a status write's `modify` answers to write nothing at all. */
export const SKIP_WRITE = "skip";

/** The status fields the activities change in place. */
export type EvalStatusCommon = Pick<
  EvalRunStatus,
  "phase" | "partialReason" | "error" | "startedAt" | "finishedAt" | "triesTotal"
>;

/** One stored eval run's status, as the activities change it. */
export interface EvalStatusView {
  readonly status: EvalStatusCommon;
  /** The case at a flat index, as the matrix numbers it. */
  caseAt(caseIndex: number): EvalRunCase | undefined;
  /** Whether the skeleton is written. */
  planned(): boolean;
  /** Every summary recomputed from the tries. */
  recompute(threshold: number): void;
  /** The skeleton of a planned eval (writeSkeleton). */
  skeleton(context: EvalContext): void;
}

/** How the eval run's row is read and written by the suite's activities. */
export interface EvalStatusBook {
  read(store: Store, evalId: string): Promise<{ readonly phase: EvalRunPhase; readonly threshold: number } | undefined>;
  write(
    store: Store,
    evalId: string,
    modify: (view: EvalStatusView) => typeof SKIP_WRITE | undefined | void,
  ): Promise<void>;
}
