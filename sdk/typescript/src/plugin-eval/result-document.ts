// A plugin eval as Claude Code's plugin-eval result document, so a CI script
// written for `claude plugin eval --json` reads Stigmer's file unchanged.
//
// Only the fields Claude Code documents are mimicked, under their names and
// meanings: `schemaVersion` 1, `partial` and `partialReason`, the suite's
// `aggregates`, each case's `name`, `aggregates.score` and
// `aggregates.delta`, each run's `error` under `arms.with` and
// `arms.without`, `costUsd` and `durationSeconds`. The format tells scripts
// to ignore fields they do not recognise, so Stigmer's additions ride
// beside them: `targets` (every engine and model with its own cases),
// `passK` per case, `provisionalDelta`, `notRun` (the cases listed but not
// run, with the feature named), and per run its id and why it was not
// graded.
//
// Two readings differ from Claude Code on purpose. A try the platform could
// not grade (out of credit, platform busy) has `score: null`, never 0, and
// is left out of every mean; a cancelled eval reports `interrupted`, the
// format's word for a run stopped by hand, and an eval that ran out of
// credit reports `out_of_credit`, a reason the format does not have. With
// several targets the top-level `cases` are the first target's, so a script
// that reads one model reads the first; `targets` carries each one's full
// list.
//
// Pure: no I/O, no clock unless the caller passes none and the eval has no
// start time. Pinned by `__tests__/result-document.test.ts`.

import { timestampMs } from "@bufbuild/protobuf/wkt";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import type { PluginEvalTarget } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import {
  PluginEvalPartialReason,
  PluginEvalPhase,
  PluginEvalTryState,
  type PluginEvalArm,
  type PluginEvalCase,
  type PluginEvalCaseTarget,
  type PluginEvalTry,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

/** Why a suite did not finish, in the format's words plus Stigmer's `out_of_credit`. */
export type ResultPartialReason = "cost_ceiling" | "interrupted" | "out_of_credit";

/** One try of one arm. */
export interface ResultRun {
  /** `null`, or why the run ended abnormally; a run with an error is still graded on what it produced. */
  readonly error: string | null;
  /** The weighted share of scored checks that passed, or `null` when the try was not graded. */
  readonly score: number | null;
  /** Why the try produced no score, as in "platform busy"; `null` when graded. */
  readonly notGradedReason: string | null;
  /** The try's run, which the eval's viewers can open; empty until it exists. */
  readonly runId: string;
}

/** One case on one target. */
export interface ResultCase {
  readonly name: string;
  readonly aggregates: {
    /** Mean with-arm score; `null` when no with-arm try was graded. */
    readonly score: number | null;
    /** With-arm minus without-arm; omitted when the case ran one arm or an arm has no score. */
    readonly delta?: number;
  };
  /** Whether the with-arm score reached the threshold. */
  readonly passed: boolean;
  /** Whether every with-arm try scored 1: pass^k, k being the tries. */
  readonly passK: boolean;
  readonly arms: {
    readonly with: readonly ResultRun[];
    /** Omitted when the eval made no comparison. */
    readonly without?: readonly ResultRun[];
  };
}

/** One engine and model, with its cases. */
export interface ResultTarget {
  /** `native` or `cursor`. */
  readonly harness: string;
  /** The catalog model id; empty for the engine's default model. */
  readonly model: string;
  /** `<harness>/<model>`, as the CLI's `--model` takes it. */
  readonly label: string;
  readonly cases: readonly ResultCase[];
}

/** A case, or a case on one target, that was listed but not run. */
export interface ResultNotRun {
  readonly name: string;
  /** The target it did not run on; omitted when it ran on none. */
  readonly target?: string;
  /** The reason, naming the feature Stigmer does not run yet. */
  readonly reason: string;
}

/** Claude Code's plugin-eval result document, with Stigmer's additions. */
export interface PluginEvalResultDocument {
  readonly schemaVersion: 1;
  readonly partial: boolean;
  readonly partialReason: ResultPartialReason | null;
  readonly aggregates: {
    readonly overallScore: number;
    readonly casesPassed: number;
    readonly casesTotal: number;
    /** Omitted when no case had a comparison. */
    readonly meanDelta?: number;
  };
  readonly cases: readonly ResultCase[];
  readonly costUsd: number;
  readonly durationSeconds: number;
  /** The eval's id. */
  readonly evalId: string;
  /** True while the comparison also measures the agent Stigmer composes for the plugin. */
  readonly provisionalDelta: boolean;
  readonly targets: readonly ResultTarget[];
  readonly notRun: readonly ResultNotRun[];
}

/** Options for {@link toResultDocument}. */
export interface ResultDocumentOptions {
  /**
   * The person stopped following the eval (Ctrl+C) and cancelled it, so
   * the document is partial and `interrupted` even if the server has not
   * yet recorded the cancel.
   */
  readonly interrupted?: boolean;
  /** Wall-clock seconds to report; read from the eval's start and finish when omitted. */
  readonly durationSeconds?: number;
  /** The clock for an eval still running, in epoch milliseconds. @default Date.now() */
  readonly nowMs?: number;
}

/** Builds the result document for an eval, finished or not. */
export function toResultDocument(
  pluginEval: PluginEval,
  opts: ResultDocumentOptions = {},
): PluginEvalResultDocument {
  const status = pluginEval.status;
  const cases = status?.cases ?? [];
  const targets = targetsOf(pluginEval, cases);
  const partialReason = partialReasonOf(pluginEval, opts.interrupted === true);
  const aggregates = status?.aggregates;
  return {
    schemaVersion: 1,
    partial: partialReason !== null,
    partialReason,
    aggregates: {
      overallScore: aggregates?.overallScore ?? 0,
      casesPassed: aggregates?.casesPassed ?? 0,
      casesTotal: aggregates?.casesTotal ?? 0,
      ...(aggregates?.meanDelta !== undefined && { meanDelta: aggregates.meanDelta }),
    },
    cases: targets[0]?.cases ?? [],
    costUsd: status?.costUsd ?? 0,
    durationSeconds: opts.durationSeconds ?? durationOf(pluginEval, opts.nowMs ?? Date.now()),
    evalId: pluginEval.metadata?.id ?? "",
    provisionalDelta: status?.provisionalDelta ?? false,
    targets,
    notRun: notRunOf(cases),
  };
}

/** A target as the CLI's `--model` takes it: `native/claude-sonnet-4-6`, or `native/default`. */
export function pluginEvalTargetLabel(target: PluginEvalTarget | undefined): string {
  return `${harnessName(target?.harness ?? Harness.UNSPECIFIED)}/${target?.modelName || "default"}`;
}

/** The engine's word: `native` (also for unspecified, the platform's default) or `cursor`. */
function harnessName(harness: Harness): string {
  switch (harness) {
    case Harness.CURSOR:
      return "cursor";
    case Harness.NATIVE:
    case Harness.UNSPECIFIED:
      return "native";
    default: {
      const exhaustive: never = harness;
      return String(exhaustive);
    }
  }
}

function partialReasonOf(pluginEval: PluginEval, interrupted: boolean): ResultPartialReason | null {
  const status = pluginEval.status;
  const reason = status?.partialReason ?? PluginEvalPartialReason.unspecified;
  switch (reason) {
    case PluginEvalPartialReason.cost_ceiling:
      return "cost_ceiling";
    case PluginEvalPartialReason.out_of_credit:
      return "out_of_credit";
    case PluginEvalPartialReason.cancelled:
      return "interrupted";
    case PluginEvalPartialReason.unspecified:
      break;
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
  if (interrupted) return "interrupted";
  // A partial phase whose reason the server did not name is still partial;
  // the format's nearest word for "stopped before every run" is a stop.
  return status?.phase === PluginEvalPhase.partial ? "interrupted" : null;
}

/**
 * Every target the eval ran, in its order. The eval's spec lists them; an
 * eval created with none ran each case on its own model, so the targets
 * are read from the cases in the order they first appear.
 */
function targetsOf(pluginEval: PluginEval, cases: readonly PluginEvalCase[]): ResultTarget[] {
  const labels: string[] = [];
  const byLabel = new Map<string, PluginEvalTarget | undefined>();
  const note = (target: PluginEvalTarget | undefined): void => {
    const label = pluginEvalTargetLabel(target);
    if (!byLabel.has(label)) {
      labels.push(label);
      byLabel.set(label, target);
    }
  };
  for (const target of pluginEval.spec?.targets ?? []) note(target);
  for (const evalCase of cases) {
    for (const caseTarget of evalCase.targets) note(caseTarget.target);
  }
  return labels.map((label) => {
    const target = byLabel.get(label);
    return {
      harness: harnessName(target?.harness ?? Harness.UNSPECIFIED),
      model: target?.modelName ?? "",
      label,
      cases: cases.flatMap((evalCase) => {
        if (evalCase.notRunReason !== "") return [];
        const result = evalCase.targets.find((caseTarget) => pluginEvalTargetLabel(caseTarget.target) === label);
        return result === undefined || result.notRunReason !== "" ? [] : [caseOf(evalCase, result)];
      }),
    };
  });
}

function caseOf(evalCase: PluginEvalCase, result: PluginEvalCaseTarget): ResultCase {
  const withArm = result.withPlugin;
  const withoutArm = result.withoutPlugin;
  return {
    name: evalCase.caseName,
    aggregates: {
      score: withArm?.score ?? null,
      ...(result.delta !== undefined && { delta: result.delta }),
    },
    passed: result.passed,
    passK: result.passK,
    arms: {
      with: runsOf(withArm),
      ...(withoutArm !== undefined && { without: runsOf(withoutArm) }),
    },
  };
}

function runsOf(arm: PluginEvalArm | undefined): ResultRun[] {
  return (arm?.tries ?? []).map(runOf);
}

function runOf(attempt: PluginEvalTry): ResultRun {
  const graded = attempt.state === PluginEvalTryState.graded;
  return {
    error: attempt.error === "" ? null : attempt.error,
    score: graded ? attempt.score : null,
    notGradedReason: attempt.notGradedReason === "" ? null : attempt.notGradedReason,
    runId: attempt.runId,
  };
}

function notRunOf(cases: readonly PluginEvalCase[]): ResultNotRun[] {
  return cases.flatMap((evalCase): ResultNotRun[] => {
    if (evalCase.notRunReason !== "") {
      return [{ name: evalCase.caseName, reason: evalCase.notRunReason }];
    }
    return evalCase.targets
      .filter((caseTarget) => caseTarget.notRunReason !== "")
      .map((caseTarget) => ({
        name: evalCase.caseName,
        target: pluginEvalTargetLabel(caseTarget.target),
        reason: caseTarget.notRunReason,
      }));
  });
}

function durationOf(pluginEval: PluginEval, nowMs: number): number {
  const startedAt = pluginEval.status?.startedAt;
  if (startedAt === undefined) return 0;
  const finishedAt = pluginEval.status?.finishedAt;
  const endMs = finishedAt === undefined ? nowMs : timestampMs(finishedAt);
  return Math.max(0, Math.round((endMs - timestampMs(startedAt)) / 1000));
}
