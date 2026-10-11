/**
 * The suite workflow's activities (workflows/run-plugin-eval.ts): load,
 * record, finish. Each writes the eval's status through the store's
 * atomic read-modify-write, and only the suite workflow calls them, one at
 * a time, so the status has one writer.
 *
 *   - load: the eval and its suite at the stamped digest, the matrix, and
 *     the status skeleton: every planned case with its tags, notes and
 *     not-run reason, every target with its arms and pending tries, the
 *     tries in all, phase running, the start time, and whether the delta
 *     is provisional (domain/plugin-eval/arm.ts: it is not). An eval already running
 *     with its skeleton written (a retried load) is planned again without
 *     a rewrite; an eval gone or ended plans nothing, ended also when it
 *     ends between the load's read and its write (create marking a slow
 *     start failed, a cancel), which the write re-checks and leaves as is; a suite that cannot
 *     be read, past a few attempts, ends the eval failed, "the plugin's
 *     evals could not be read".
 *   - record: one try's result into its place, then every score and
 *     aggregate recomputed (domain/plugin-eval/scoring.ts). A try not
 *     started because the plugin was updated leaves its case a note
 *     saying so, once.
 *   - finish: completed, partial with its reason, or failed with its
 *     error (the suite workflow's own step that could not be done), the
 *     finish time and the final aggregates; an eval already ended is left
 *     as it is.
 *
 * Both kinds of eval go through the same three activities: the eval's id
 * names its kind, and a status book (a plugin eval's here, an agent eval's
 * in agent-status.ts) reads and writes that kind's row. An agent eval's
 * cases are its plugins' cases one after another, so a try's flat case
 * index finds its place in its plugin's block, and its totals are summed
 * per plugin and over all.
 *
 * Proven by __tests__/suite-activities.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";
import { Context } from "@temporalio/activity";

import { PluginEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalTargetSchema } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import {
  PluginEvalAbortSchema,
  PluginEvalArmSchema,
  PluginEvalCaseSchema,
  PluginEvalCaseTargetSchema,
  PluginEvalPartialReason,
  PluginEvalPhase,
  PluginEvalStatusSchema,
  PluginEvalTryState,
  PluginEvalTrySchema,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import type {
  PluginEvalArm,
  PluginEvalCase,
  PluginEvalStatus,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import { evalKindOf } from "../../domain/plugin-eval/plugin-eval-run.js";
import { PROVISIONAL_DELTA } from "../../domain/plugin-eval/arm.js";
import {
  DEFAULT_THRESHOLD,
  recomputeStatus,
} from "../../domain/plugin-eval/scoring.js";
import type { PlannedCase } from "../../domain/plugin-eval/matrix.js";
import { caseNotesOf, mockedServersOf } from "../../domain/plugin-eval/try-run.js";
import { bumpStatusAudit } from "../../pipeline/steps/defaults.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import { agentStatusBook } from "./agent-status.js";
import { SKIP_WRITE } from "./status-book.js";
import type { EvalStatusBook } from "./status-book.js";
import type { EvalContext, EvalContextLoader, PluginEvalContext } from "./context.js";
import { caseWorkflowPrefixOf, orgOf, specOf } from "./context.js";
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

/** The failed eval's error when its suite cannot be read. */
export const SUITE_UNREADABLE_ERROR = "the plugin's evals could not be read";

/** Load attempts before an unreadable suite fails the eval. */
export const LOAD_ATTEMPTS_BEFORE_FAILING = 3;

export interface SuiteActivityDeps {
  readonly store: Store;
  readonly logger: Logger;
  readonly contexts: EvalContextLoader;
  /** The activity's attempt number; tests pin it. */
  readonly attempt?: () => number;
}


/** Thrown inside the store's update to leave the row untouched (the store skips a write its modify throws from). */
class SkippedWrite extends Error {}

const PARTIAL_REASONS: Readonly<Record<SuiteStop, PluginEvalPartialReason>> = {
  cost_ceiling: PluginEvalPartialReason.cost_ceiling,
  out_of_credit: PluginEvalPartialReason.out_of_credit,
  cancelled: PluginEvalPartialReason.cancelled,
};

export function createSuiteActivities(
  deps: SuiteActivityDeps,
): SuiteActivities {
  const attempt = deps.attempt ?? (() => Context.current().info.attempt);

  return {
    [LOAD_SUITE_ACTIVITY_NAME]: async (evalId): Promise<SuitePlan> => {
      const book = statusBookOf(evalId);
      const stored = await book.read(deps.store, evalId);
      if (stored === undefined || isEndedPhase(stored.phase)) {
        return { kind: "stop" };
      }
      let context: EvalContext | undefined;
      try {
        context = await deps.contexts(evalId);
      } catch (error) {
        deps.logger.warn("the eval's suite could not be read", {
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
          status.phase = PluginEvalPhase.failed;
          status.error = SUITE_UNREADABLE_ERROR;
          status.finishedAt = timestampNow();
          return undefined;
        });
        return { kind: "stop" };
      }
      if (context === undefined) {
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
          status.phase === PluginEvalPhase.running &&
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
        caseWorkflowPrefix: caseWorkflowPrefixOf(ready),
      };
    },

    [RECORD_TRY_ACTIVITY_NAME]: async (evalId, cell, result) => {
      const book = statusBookOf(evalId);
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
          deps.logger.warn("a try's result has no place in the eval's status", {
            evalId,
            ...cell,
          });
          return;
        }
        slot.sessionId = result.sessionId;
        slot.runId = result.runId;
        slot.state =
          result.state === "graded"
            ? PluginEvalTryState.graded
            : PluginEvalTryState.not_graded;
        slot.score = result.state === "graded" ? result.score : 0;
        slot.notGradedReason = result.notGradedReason;
        slot.error = result.error;
        slot.costUsd = result.costUsd;
        slot.durationSeconds = result.durationSeconds;
        slot.aborted =
          result.aborted === undefined
            ? undefined
            : create(PluginEvalAbortSchema, result.aborted);
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
      const book = statusBookOf(evalId);
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
            status.phase = PluginEvalPhase.completed;
            status.partialReason = PluginEvalPartialReason.unspecified;
            break;
          case "partial":
            status.phase = PluginEvalPhase.partial;
            status.partialReason = PARTIAL_REASONS[end.reason];
            break;
          case "failed":
            status.phase = PluginEvalPhase.failed;
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

/** The book of the kind an eval id names; an id naming neither is read as a plugin eval's, which finds no row. */
export function statusBookOf(evalId: string): EvalStatusBook {
  return evalKindOf(evalId) === "agent" ? agentStatusBook : pluginStatusBook;
}

/** A plugin eval's book: its row, written through writeStatus. */
const pluginStatusBook: EvalStatusBook = {
  async read(store, evalId) {
    const stored = await loadEval(store, evalId);
    return stored === undefined
      ? undefined
      : {
          phase: stored.status?.phase ?? PluginEvalPhase.unspecified,
          threshold: stored.spec?.threshold ?? DEFAULT_THRESHOLD,
        };
  },
  write: (store, evalId, modify) =>
    writeStatus(store, evalId, (status) =>
      modify({
        status,
        caseAt: (caseIndex) => status.cases[caseIndex],
        planned: () => status.cases.length > 0,
        recompute: (threshold) => recomputeStatus(status, threshold),
        skeleton: (context) => {
          if (context.kind === "plugin") {
            writeSkeleton(status, context);
          }
        },
      }),
    ),
};

/** The status skeleton of a planned eval (the module header). */
export function writeSkeleton(
  status: PluginEvalStatus,
  context: PluginEvalContext,
): void {
  const spec = context.pluginEval.spec;
  status.cases = context.matrix.cases.map((planned) =>
    skeletonCaseOf(planned, spec, context.plugin.metadata?.name ?? "", context.suite.servers, context.twoArms),
  );
  status.triesTotal = context.matrix.cells.length;
  status.phase = PluginEvalPhase.running;
  status.startedAt = timestampNow();
  status.provisionalDelta = PROVISIONAL_DELTA;
  recomputeStatus(status, spec?.threshold ?? DEFAULT_THRESHOLD);
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
): PluginEvalCase {
  const pendingArm = (runs: number): PluginEvalArm =>
    create(PluginEvalArmSchema, {
      tries: Array.from({ length: runs }, (_, index) =>
        create(PluginEvalTrySchema, {
          index: index + 1,
          state: PluginEvalTryState.pending,
        }),
      ),
    });
  return create(PluginEvalCaseSchema, {
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
      create(PluginEvalCaseTargetSchema, {
        target: create(PluginEvalTargetSchema, {
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

export function isEndedPhase(phase: PluginEvalPhase): boolean {
  return (
    phase === PluginEvalPhase.completed ||
    phase === PluginEvalPhase.partial ||
    phase === PluginEvalPhase.failed
  );
}

async function loadEval(
  store: Store,
  evalId: string,
): Promise<PluginEval | undefined> {
  try {
    return await store.getResource(
      ApiResourceKind.plugin_eval,
      evalId,
      PluginEvalSchema,
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return undefined;
    }
    throw error;
  }
}

/**
 * The status's one write (the module header); an eval deleted meanwhile is
 * left gone, and a `modify` that answers SKIP_WRITE leaves the row as it
 * is, its audit included.
 */
async function writeStatus(
  store: Store,
  evalId: string,
  modify: (status: PluginEvalStatus) => typeof SKIP_WRITE | undefined | void,
): Promise<void> {
  try {
    await store.updateResource(
      ApiResourceKind.plugin_eval,
      evalId,
      PluginEvalSchema,
      (live) => {
        if (live.status === undefined) {
          live.status = create(PluginEvalStatusSchema);
        }
        if (modify(live.status) === SKIP_WRITE) {
          throw new SkippedWrite();
        }
        bumpStatusAudit(live.status);
      },
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError || error instanceof SkippedWrite) {
      return;
    }
    throw error;
  }
}
