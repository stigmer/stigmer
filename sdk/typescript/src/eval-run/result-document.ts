// An eval run as a result document: what it was about, its totals, and
// one block per plugin a try loaded, each block in the shape of Claude
// Code's plugin-eval result document for that plugin's cases, for the
// gating scripts its documentation describes: a block carries the fields
// that documentation lists for them, under its names and meanings, so a
// script that gates on Claude Code's file gates on `plugins[i]`. On an eval
// run about a plugin there is one block, the plugin's. One field reads
// differently: a case's `aggregates.score` is `null` when none of its
// with-arm tries was graded, where Claude Code always writes a number, so
// a gate such as `score < 0.8` must handle `null` (the guide says so).
//
// The fields a block carries: `schemaVersion` 1, `partial` and
// `partialReason`, the plugin's `aggregates`, each case's `name`,
// `aggregates.score` and `aggregates.delta`, each run's `error` and
// `aborted` (present when a mock stopped the run, with `server`, `tool`
// and `reason`; the run scores 0 and its `error` stays `null`) under
// `arms.with` and `arms.without`, `costUsd` and `durationSeconds`. Listed
// fields for features Stigmer does not have are absent (a run's
// `skippedPaidGraders`, `claudeVersion`), and the rest of Claude Code's
// file is not mimicked: its echo of the suite's configuration, its grader
// definitions and its per-run grader results. The format tells scripts to
// ignore fields they do not recognise, so Stigmer's additions ride beside
// them: the plugin and whether the agent attaches it and whether it is
// the compared one, `notRunReason` when none of its cases ran, `targets`
// (every engine and model with its own cases), `passK` per case, `notRun`
// (the cases listed but not run, with the feature named), and per run its
// id and why it was not graded. `arms.without` and `delta` appear only on
// an eval run that compares a plugin. An eval run that ran Evals' cases on
// its agent also carries `evals`, one block per Eval in the same shape,
// with the Eval in place of the plugin; an eval run with none carries no
// `evals` key, so its document is what it was before Evals ran.
//
// Two readings differ from Claude Code on purpose. A try the platform could
// not grade (platform busy) has `score: null`, never 0, and is left out of
// every mean, so a case with no graded with-arm try has a `null` score too;
// a cancelled eval run reports `interrupted`, the format's word for a run
// stopped by hand. With several targets a block's top-level `cases` are the
// first target's, so a script that reads one model reads the first;
// `targets` carries each one's full list. A block's `costUsd` is what its
// own tries spent; its `durationSeconds` is the eval run's, since the
// plugins' tries ran interleaved.
//
// Pure: no I/O, no clock unless the caller passes none and the eval run
// has no start time. Pinned by `__tests__/result-document.test.ts`.

import { timestampMs } from "@bufbuild/protobuf/wkt";
import type { EvalRun } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import type { EvalRunTarget } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import {
  EvalRunPartialReason,
  EvalRunPhase,
  EvalRunTryState,
  type EvalRunAggregates,
  type EvalRunArm,
  type EvalRunCase,
  type EvalRunCaseTarget,
  type EvalRunPlugin,
  type EvalRunStatus,
  type EvalRunTry,
} from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

/** Why a suite did not finish, in the format's words. */
export type ResultPartialReason = "cost_ceiling" | "interrupted";

/** One try of one arm. */
export interface ResultRun {
  /** `null`, or why the run ended abnormally; a run with an error is still graded on what it produced. */
  readonly error: string | null;
  /** The weighted share of scored checks that passed, or `null` when the try was not graded. */
  readonly score: number | null;
  /** Why the try produced no score, as in "platform busy"; `null` when graded. */
  readonly notGradedReason: string | null;
  /** The try's run; empty until it exists. */
  readonly runId: string;
  /** Present when a mock stopped the run; it then scores 0 and `error` is `null`. */
  readonly aborted?: { readonly server: string; readonly tool: string; readonly reason: string };
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
  /** `stigmer` or `claude`. */
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

/** The totals of a list of cases, in Claude Code's names. */
export interface ResultAggregates {
  readonly overallScore: number;
  readonly casesPassed: number;
  readonly casesTotal: number;
  /** Omitted when no case had a comparison. */
  readonly meanDelta?: number;
}

/** One plugin's block: the plugin, and Claude Code's result fields for its cases. */
export interface EvalRunPluginResult {
  readonly schemaVersion: 1;
  readonly plugin: {
    readonly id: string;
    readonly slug: string;
    /** The plugin version every try ran. */
    readonly digest: string;
    /** Whether the agent attaches it; false on an eval run about a plugin and for a compared plugin the agent does not attach. */
    readonly attached: boolean;
    /** Whether each case ran with and without it. */
    readonly compared: boolean;
  };
  /** Why none of the plugin's cases ran; `null` when they ran. */
  readonly notRunReason: string | null;
  readonly partial: boolean;
  readonly partialReason: ResultPartialReason | null;
  readonly aggregates: ResultAggregates;
  readonly cases: readonly ResultCase[];
  readonly targets: readonly ResultTarget[];
  readonly notRun: readonly ResultNotRun[];
  readonly costUsd: number;
  readonly durationSeconds: number;
}

/** One Eval's block: the Eval, and Claude Code's result fields for its cases. */
export interface EvalRunEvalResult extends Omit<EvalRunPluginResult, "plugin"> {
  readonly eval: {
    readonly id: string;
    readonly slug: string;
    /** The Eval version every try ran. */
    readonly digest: string;
  };
}

/** What an eval run was about. */
export type ResultSubject =
  | {
      readonly kind: "agent";
      readonly id: string;
      /** The agent's slug, when the caller knows it; empty otherwise. */
      readonly slug: string;
      /** The agent version every try ran. */
      readonly versionHash: string;
    }
  | { readonly kind: "plugin"; readonly id: string; readonly slug: string };

/** An eval run's result document. */
export interface EvalRunResultDocument {
  readonly schemaVersion: 1;
  readonly evalRunId: string;
  readonly subject: ResultSubject;
  readonly partial: boolean;
  readonly partialReason: ResultPartialReason | null;
  readonly aggregates: ResultAggregates;
  readonly plugins: readonly EvalRunPluginResult[];
  /** The Evals whose cases ran on the agent; absent when none did. */
  readonly evals?: readonly EvalRunEvalResult[];
  readonly costUsd: number;
  readonly durationSeconds: number;
}

/** Options for {@link toResultDocument}. */
export interface ResultDocumentOptions {
  /**
   * The person stopped following the eval run (Ctrl+C) and cancelled it,
   * so the document is partial and `interrupted` even if the server has not
   * yet recorded the cancel.
   */
  readonly interrupted?: boolean;
  /** Wall-clock seconds to report; read from the eval run's start and finish when omitted. */
  readonly durationSeconds?: number;
  /** The clock for an eval run still running, in epoch milliseconds. @default Date.now() */
  readonly nowMs?: number;
  /** The subject's slug, for the document's `subject.slug`; on a plugin, read from its block when omitted. */
  readonly subjectSlug?: string;
}

/** Builds the result document for an eval run, finished or not. */
export function toResultDocument(evalRun: EvalRun, opts: ResultDocumentOptions = {}): EvalRunResultDocument {
  const status = evalRun.status;
  const spec = evalRun.spec;
  const partialReason = partialReasonOf(status, opts.interrupted === true);
  const durationSeconds = opts.durationSeconds ?? durationOf(status, opts.nowMs ?? Date.now());
  const specTargets = spec?.targets ?? [];
  const plugins = (status?.plugins ?? []).map((plugin) => pluginResultOf(plugin, specTargets, partialReason, durationSeconds));
  const evals = (status?.evals ?? []).map(
    (evalBlock): EvalRunEvalResult => ({
      schemaVersion: 1,
      eval: { id: evalBlock.evalId, slug: evalBlock.evalSlug, digest: evalBlock.evalDigest },
      ...sourceResultOf(evalBlock, specTargets, partialReason, durationSeconds),
    }),
  );
  return {
    schemaVersion: 1,
    evalRunId: evalRun.metadata?.id ?? "",
    subject: subjectOf(evalRun, opts.subjectSlug, plugins),
    partial: partialReason !== null,
    partialReason,
    aggregates: aggregatesOf(status?.aggregates),
    plugins,
    ...(evals.length > 0 && { evals }),
    costUsd: status?.costUsd ?? 0,
    durationSeconds,
  };
}

function subjectOf(evalRun: EvalRun, slug: string | undefined, plugins: readonly EvalRunPluginResult[]): ResultSubject {
  const subject = evalRun.spec?.subject;
  if (subject?.case === "pluginId") {
    return { kind: "plugin", id: subject.value, slug: slug ?? plugins.find((p) => p.plugin.id === subject.value)?.plugin.slug ?? "" };
  }
  const stamped = evalRun.status?.agentVersionHash ?? "";
  return {
    kind: "agent",
    id: subject?.case === "agentId" ? subject.value : "",
    slug: slug ?? "",
    versionHash: stamped !== "" ? stamped : (evalRun.spec?.agentVersion ?? ""),
  };
}

function pluginResultOf(
  plugin: EvalRunPlugin,
  specTargets: readonly EvalRunTarget[],
  partialReason: ResultPartialReason | null,
  durationSeconds: number,
): EvalRunPluginResult {
  return {
    schemaVersion: 1,
    plugin: {
      id: plugin.pluginId,
      slug: plugin.pluginSlug,
      digest: plugin.pluginDigest,
      attached: plugin.attached,
      compared: plugin.compared,
    },
    ...sourceResultOf(plugin, specTargets, partialReason, durationSeconds),
  };
}

/** The fields every source's block carries for its cases: a plugin's or an Eval's. */
function sourceResultOf(
  source: Pick<EvalRunPlugin, "cases" | "aggregates" | "notRunReason">,
  specTargets: readonly EvalRunTarget[],
  partialReason: ResultPartialReason | null,
  durationSeconds: number,
): Omit<EvalRunPluginResult, "schemaVersion" | "plugin"> {
  return {
    notRunReason: source.notRunReason === "" ? null : source.notRunReason,
    partial: partialReason !== null,
    partialReason,
    ...resultBlockOf(source.cases, specTargets, source.aggregates),
    costUsd: source.cases.reduce(
      (sum, evalCase) =>
        sum +
        evalCase.targets.reduce(
          (inner, target) =>
            inner +
            [target.withPlugin, target.withoutPlugin].reduce(
              (arms, arm) => arms + (arm?.tries ?? []).reduce((tries, attempt) => tries + attempt.costUsd, 0),
              0,
            ),
          0,
        ),
      0,
    ),
    durationSeconds,
  };
}

function aggregatesOf(aggregates: EvalRunAggregates | undefined): ResultAggregates {
  return {
    overallScore: aggregates?.overallScore ?? 0,
    casesPassed: aggregates?.casesPassed ?? 0,
    casesTotal: aggregates?.casesTotal ?? 0,
    ...(aggregates?.meanDelta !== undefined && { meanDelta: aggregates.meanDelta }),
  };
}

/** What the format's fields hold for one list of cases: one plugin's. */
export interface ResultBlock {
  readonly aggregates: ResultAggregates;
  readonly cases: readonly ResultCase[];
  readonly targets: readonly ResultTarget[];
  readonly notRun: readonly ResultNotRun[];
}

/**
 * The format's fields for `cases`: their aggregates as the server summed
 * them, the first target's cases, every target's, and the cases not run.
 * `specTargets` orders the targets; with none, they are read from the cases
 * in the order they first appear.
 */
export function resultBlockOf(
  cases: readonly EvalRunCase[],
  specTargets: readonly EvalRunTarget[],
  aggregates: EvalRunAggregates | undefined,
): ResultBlock {
  const targets = targetsOf(specTargets, cases);
  return {
    aggregates: aggregatesOf(aggregates),
    cases: targets[0]?.cases ?? [],
    targets,
    notRun: notRunOf(cases),
  };
}

/** A target as the CLI's `--model` takes it: `native/claude-sonnet-4-6`, or `native/default`. */
export function evalRunTargetLabel(target: EvalRunTarget | undefined): string {
  return `${harnessName(target?.harness ?? Harness.UNSPECIFIED)}/${target?.modelName || "default"}`;
}

/** The engine's word: `stigmer` (also for unspecified, the platform's default) or `claude`. */
function harnessName(harness: Harness): string {
  switch (harness) {
    case Harness.CLAUDE:
      return "claude";
    case Harness.STIGMER:
    case Harness.UNSPECIFIED:
      return "stigmer";
    default: {
      const exhaustive: never = harness;
      return String(exhaustive);
    }
  }
}

/** Why an eval run did not finish, in the format's words; `null` when it did, or still runs. */
export function partialReasonOf(
  status: Pick<EvalRunStatus, "phase" | "partialReason"> | undefined,
  interrupted: boolean,
): ResultPartialReason | null {
  const reason = status?.partialReason ?? EvalRunPartialReason.unspecified;
  switch (reason) {
    case EvalRunPartialReason.cost_ceiling:
      return "cost_ceiling";
    case EvalRunPartialReason.cancelled:
      return "interrupted";
    case EvalRunPartialReason.unspecified:
      break;
    default: {
      // A reason a newer server names is read like an unnamed one, so the
      // document keeps to the format's words rather than carry a number.
      const unknown: never = reason;
      void unknown;
      break;
    }
  }
  if (interrupted) return "interrupted";
  // A partial phase whose reason the server did not name is still partial;
  // the format's nearest word for "stopped before every run" is a stop.
  return status?.phase === EvalRunPhase.partial ? "interrupted" : null;
}

/**
 * Every target the eval run ran, in its order. Its spec lists them; one
 * created with none ran each case on its own model, so the targets
 * are read from the cases in the order they first appear.
 */
function targetsOf(specTargets: readonly EvalRunTarget[], cases: readonly EvalRunCase[]): ResultTarget[] {
  const labels: string[] = [];
  const byLabel = new Map<string, EvalRunTarget | undefined>();
  const note = (target: EvalRunTarget | undefined): void => {
    const label = evalRunTargetLabel(target);
    if (!byLabel.has(label)) {
      labels.push(label);
      byLabel.set(label, target);
    }
  };
  for (const target of specTargets) note(target);
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
        const result = evalCase.targets.find((caseTarget) => evalRunTargetLabel(caseTarget.target) === label);
        return result === undefined || result.notRunReason !== "" ? [] : [caseOf(evalCase, result)];
      }),
    };
  });
}

function caseOf(evalCase: EvalRunCase, result: EvalRunCaseTarget): ResultCase {
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

function runsOf(arm: EvalRunArm | undefined): ResultRun[] {
  return (arm?.tries ?? []).map(runOf);
}

function runOf(attempt: EvalRunTry): ResultRun {
  const graded = attempt.state === EvalRunTryState.graded;
  return {
    error: attempt.error === "" ? null : attempt.error,
    score: graded ? attempt.score : null,
    notGradedReason: attempt.notGradedReason === "" ? null : attempt.notGradedReason,
    runId: attempt.runId,
    ...(attempt.aborted !== undefined && {
      aborted: { server: attempt.aborted.server, tool: attempt.aborted.tool, reason: attempt.aborted.reason },
    }),
  };
}

function notRunOf(cases: readonly EvalRunCase[]): ResultNotRun[] {
  return cases.flatMap((evalCase): ResultNotRun[] => {
    if (evalCase.notRunReason !== "") {
      return [{ name: evalCase.caseName, reason: evalCase.notRunReason }];
    }
    return evalCase.targets
      .filter((caseTarget) => caseTarget.notRunReason !== "")
      .map((caseTarget) => ({
        name: evalCase.caseName,
        target: evalRunTargetLabel(caseTarget.target),
        reason: caseTarget.notRunReason,
      }));
  });
}

/** Seconds from the eval run's start to its finish, or to `nowMs` while it runs. */
export function durationOf(
  status: Pick<EvalRunStatus, "startedAt" | "finishedAt"> | undefined,
  nowMs: number,
): number {
  const startedAt = status?.startedAt;
  if (startedAt === undefined) return 0;
  const finishedAt = status?.finishedAt;
  const endMs = finishedAt === undefined ? nowMs : timestampMs(finishedAt);
  return Math.max(0, Math.round((endMs - timestampMs(startedAt)) / 1000));
}
