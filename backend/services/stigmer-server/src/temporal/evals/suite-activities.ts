/**
 * The suite workflow's activities (workflows/run-eval-run.ts): load,
 * record, finish. Each writes the eval run's status through the store's
 * atomic read-modify-write (the status book, run-status.ts), and only the
 * suite workflow calls them, one at a time, so the status has one writer.
 *
 *   - load: the eval run and its suites at the stamped digests, the
 *     matrix, and the status skeleton: every planned case in its plugin's
 *     block with its tags, notes and not-run reason, every target with its
 *     arms and pending tries, the tries in all, phase running, the start
 *     time. An eval run already running with its skeleton written (a
 *     retried load) is planned again without a rewrite; one gone or ended
 *     plans nothing; one whose agent version or stamped plugin version is
 *     gone ends failed (EVAL_SUBJECT_GONE_ERROR), ended also when it ends
 *     between the load's read and its write (create marking a slow start
 *     failed, a cancel), which the write re-checks and leaves as is; a
 *     suite that cannot be read, past a few attempts, ends the eval run
 *     failed, "the plugins' evals could not be read".
 *   - record: one try's result into its place (a try's flat case index
 *     finds its place in its plugin's block), then every score and
 *     aggregate recomputed, per plugin and over all (domain/eval-run/
 *     scoring.ts). A try not started because the plugin was updated
 *     leaves its case a note saying so, once.
 *   - finish: completed, partial with its reason, or failed with its
 *     error (the suite workflow's own step that could not be done), the
 *     finish time and the final aggregates; an eval run already ended is
 *     left as it is.
 *
 * Proven by __tests__/suite-activities.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";
import { Context } from "@temporalio/activity";

import { EvalRunTargetSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/spec_pb";
import {
  EvalRunAbortSchema,
  EvalRunArmSchema,
  EvalRunCaseSchema,
  EvalRunCaseTargetSchema,
  EvalRunPartialReason,
  EvalRunPhase,
  EvalRunTryState,
  EvalRunTrySchema,
} from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import type { EvalRunArm, EvalRunCase } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";

import type { Logger } from "../../boot/logger.js";
import { EVAL_RUN_SUITES_UNREADABLE_ERROR } from "../../domain/eval-run/constants.js";
import type { PlannedCase } from "../../domain/eval-run/matrix.js";
import { caseNotesOf, mockedServersOf } from "../../domain/eval-run/try-run.js";
import type { Store } from "../../store/interface.js";
import { evalRunStatusBook } from "./run-status.js";
import { SKIP_WRITE } from "./status-book.js";
import type { EvalContext, EvalContextLoader } from "./context.js";
import { orgOf, specOf } from "./context.js";
import {
  FINISH_EVAL_ACTIVITY_NAME,
  LOAD_SUITE_ACTIVITY_NAME,
  PLUGIN_UPDATED_NOTE,
  PLUGIN_UPDATED_REASON,
  RECORD_TRY_ACTIVITY_NAME,
} from "./names.js";
import type {
  SuiteActivities,
  SuiteCell,
  SuitePlan,
  SuiteStop,
} from "./names.js";

/** The failed eval run's error when its suites cannot be read. */
export const SUITE_UNREADABLE_ERROR = EVAL_RUN_SUITES_UNREADABLE_ERROR;

/**
 * The failed eval run's error when its row is there but what it runs is
 * not: its agent's stamped version or one of its stamped plugin versions.
 */
export const EVAL_SUBJECT_GONE_ERROR = "what the eval run runs is gone: its agent version or a plugin version it stamped";

/** Load attempts before an unreadable suite fails the eval. */
export const LOAD_ATTEMPTS_BEFORE_FAILING = 3;

export interface SuiteActivityDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly contexts: EvalContextLoader;
  /** The activity's attempt number; tests pin it. */
  readonly attempt?: () => number;
}


const PARTIAL_REASONS: Readonly<Record<SuiteStop, EvalRunPartialReason>> = {
  cost_ceiling: EvalRunPartialReason.cost_ceiling,
  cancelled: EvalRunPartialReason.cancelled,
};

export function createSuiteActivities(
  deps: SuiteActivityDeps,
): SuiteActivities {
  const attempt = deps.attempt ?? (() => Context.current().info.attempt);

  return {
    [LOAD_SUITE_ACTIVITY_NAME]: async (evalId): Promise<SuitePlan> => {
      const book = evalRunStatusBook;
      const stored = await book.read(deps.store, evalId);
      if (stored === undefined || isEndedPhase(stored.phase)) {
        return { kind: "stop" };
      }
      let context: EvalContext | undefined;
      try {
        context = await deps.contexts(evalId);
      } catch (error) {
        deps.logger.warn("the eval run's suites could not be read", {
          evalId,
          attempt: attempt(),
          reason: error instanceof Error ? error.message : String(error),
        });
        if (attempt() < LOAD_ATTEMPTS_BEFORE_FAILING) {
          throw error;
        }
        await book.write(deps.store, evalId, ({ status }) => {
          if (isEndedPhase(status.phase)) {
            return SKIP_WRITE;
          }
          status.phase = EvalRunPhase.failed;
          status.error = SUITE_UNREADABLE_ERROR;
          status.finishedAt = timestampNow();
          return undefined;
        });
        return { kind: "stop" };
      }
      if (context === undefined) {
        // The row is there but its agent version or a stamped plugin
        // version is not (a compared plugin's delete does not cascade to
        // the agent's eval runs that stamped it): end it, so it never shows
        // pending until its workflow's timeout.
        await book.write(deps.store, evalId, ({ status }) => {
          if (isEndedPhase(status.phase)) {
            return SKIP_WRITE;
          }
          status.phase = EvalRunPhase.failed;
          status.error = EVAL_SUBJECT_GONE_ERROR;
          status.finishedAt = timestampNow();
          return undefined;
        });
        return { kind: "stop" };
      }
      const ready = context;
      let ended = false;
      await book.write(deps.store, evalId, (view) => {
        const { status } = view;
        if (isEndedPhase(status.phase)) {
          ended = true;
          return SKIP_WRITE;
        }
        if (
          status.phase === EvalRunPhase.running &&
          view.planned()
        ) {
          return SKIP_WRITE;
        }
        view.skeleton(ready);
        return undefined;
      });
      if (ended) {
        return { kind: "stop" };
      }
      const spec = specOf(ready);
      const cells: SuiteCell[] = ready.matrix.cells.map((cell) => ({
        ...cell,
        timeoutSeconds:
          ready.matrix.cases[cell.caseIndex]?.evalCase.timeoutSeconds ?? 300,
      }));
      return {
        kind: "run",
        org: orgOf(ready),
        cells,
        maxCostUsd: spec?.maxCostUsd ?? 0,
        concurrency:
          spec?.concurrency !== undefined && spec.concurrency > 0
            ? spec.concurrency
            : 1,
      };
    },

    [RECORD_TRY_ACTIVITY_NAME]: async (evalId, cell, result) => {
      const book = evalRunStatusBook;
      const stored = await book.read(deps.store, evalId);
      if (stored === undefined) {
        return;
      }
      const { threshold } = stored;
      await book.write(deps.store, evalId, (view) => {
        const evalCase = view.caseAt(cell.caseIndex);
        const target = evalCase?.targets[cell.targetIndex];
        const arm =
          cell.arm === "with" ? target?.withPlugin : target?.withoutPlugin;
        const slot = arm?.tries[cell.tryIndex];
        if (evalCase === undefined || slot === undefined) {
          deps.logger.warn("a try's result has no place in the eval run's status", {
            evalId,
            ...cell,
          });
          return;
        }
        slot.sessionId = result.sessionId;
        slot.runId = result.runId;
        slot.state =
          result.state === "graded"
            ? EvalRunTryState.graded
            : EvalRunTryState.not_graded;
        slot.score = result.state === "graded" ? result.score : 0;
        slot.notGradedReason = result.notGradedReason;
        slot.error = result.error;
        slot.costUsd = result.costUsd;
        slot.durationSeconds = result.durationSeconds;
        slot.aborted =
          result.aborted === undefined
            ? undefined
            : create(EvalRunAbortSchema, result.aborted);
        if (
          result.notGradedReason === PLUGIN_UPDATED_REASON &&
          !evalCase.notes.includes(PLUGIN_UPDATED_NOTE)
        ) {
          evalCase.notes.push(PLUGIN_UPDATED_NOTE);
        }
        view.recompute(threshold);
      });
    },

    [FINISH_EVAL_ACTIVITY_NAME]: async (evalId, end) => {
      const book = evalRunStatusBook;
      const stored = await book.read(deps.store, evalId);
      if (stored === undefined || isEndedPhase(stored.phase)) {
        return;
      }
      const { threshold } = stored;
      await book.write(deps.store, evalId, (view) => {
        const { status } = view;
        if (isEndedPhase(status.phase)) {
          return SKIP_WRITE;
        }
        switch (end.phase) {
          case "completed":
            status.phase = EvalRunPhase.completed;
            status.partialReason = EvalRunPartialReason.unspecified;
            break;
          case "partial":
            status.phase = EvalRunPhase.partial;
            status.partialReason = PARTIAL_REASONS[end.reason];
            break;
          case "failed":
            status.phase = EvalRunPhase.failed;
            status.error = end.error;
            break;
          /* v8 ignore next -- @preserve: the exhaustiveness guard over a closed union; no value reaches it */
          default: {
            const exhausted: never = end;
            return exhausted;
          }
        }
        status.finishedAt = timestampNow();
        view.recompute(threshold);
      });
    },
  };
}

/**
 * One planned case's skeleton: its tags, notes and mocked servers, each
 * target with its pending tries in the with-plugin arm, and in the
 * without-plugin arm too when the eval compares (`twoArms`).
 */
export function skeletonCaseOf(
  planned: PlannedCase,
  spec: Parameters<typeof caseNotesOf>[1] | undefined,
  pluginName: string,
  servers: ReadonlyArray<string>,
  twoArms: boolean,
  extraNotes: ReadonlyArray<string> = [],
): EvalRunCase {
  const pendingArm = (runs: number): EvalRunArm =>
    create(EvalRunArmSchema, {
      tries: Array.from({ length: runs }, (_, index) =>
        create(EvalRunTrySchema, {
          index: index + 1,
          state: EvalRunTryState.pending,
        }),
      ),
    });
  return create(EvalRunCaseSchema, {
    caseName: planned.evalCase.name,
    path: planned.evalCase.dir,
    caseTags: [...planned.evalCase.tags],
    notRunReason: planned.notRunReason ?? "",
    notes:
      planned.notRunReason === undefined && spec !== undefined
        ? [...caseNotesOf(planned.evalCase, spec), ...extraNotes]
        : [],
    mockedServers:
      planned.notRunReason === undefined && spec !== undefined
        ? mockedServersOf(planned.evalCase, spec, pluginName, servers)
        : [],
    targets: planned.targets.map((target) =>
      create(EvalRunCaseTargetSchema, {
        target: create(EvalRunTargetSchema, {
          harness: target.target.harness,
          modelName: target.target.modelName,
        }),
        notRunReason: target.notRunReason ?? "",
        ...(target.notRunReason === undefined
          ? {
              withPlugin: pendingArm(target.runs),
              ...(twoArms ? { withoutPlugin: pendingArm(target.runs) } : {}),
            }
          : {}),
      }),
    ),
  });
}

export function isEndedPhase(phase: EvalRunPhase): boolean {
  return (
    phase === EvalRunPhase.completed ||
    phase === EvalRunPhase.partial ||
    phase === EvalRunPhase.failed
  );
}
