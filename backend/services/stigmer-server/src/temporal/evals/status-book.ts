/**
 * The seam between the suite's activities (suite-activities.ts) and the
 * row they write: a status book per kind of eval reads the eval's phase and
 * threshold and writes its status through the store's atomic
 * read-modify-write, handing the activity a view that is the same for a
 * plugin eval and an agent eval. The scalar fields both statuses share by
 * name are changed in place; the cases, their totals and the skeleton,
 * shaped differently per kind, go through the view's methods.
 */
import type { PluginEvalCase, PluginEvalPhase, PluginEvalStatus } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";

import type { Store } from "../../store/interface.js";
import type { EvalContext } from "./context.js";

/** What a status write's `modify` answers to write nothing at all. */
export const SKIP_WRITE = "skip";

/** The status fields both kinds of eval share by name and type. */
export type EvalStatusCommon = Pick<
  PluginEvalStatus,
  "phase" | "partialReason" | "error" | "startedAt" | "finishedAt" | "triesTotal"
>;

/** One stored eval's status, as the activities change it, whatever its kind. */
export interface EvalStatusView {
  readonly status: EvalStatusCommon;
  /** The case at a flat index, as the matrix numbers it. */
  caseAt(caseIndex: number): PluginEvalCase | undefined;
  /** Whether the skeleton is written. */
  planned(): boolean;
  /** Every summary recomputed from the tries. */
  recompute(threshold: number): void;
  /** The skeleton of a planned eval (writeSkeleton). */
  skeleton(context: EvalContext): void;
}

/** How one kind of eval's row is read and written by the suite's activities. */
export interface EvalStatusBook {
  read(store: Store, evalId: string): Promise<{ readonly phase: PluginEvalPhase; readonly threshold: number } | undefined>;
  write(
    store: Store,
    evalId: string,
    modify: (view: EvalStatusView) => typeof SKIP_WRITE | undefined | void,
  ): Promise<void>;
}
