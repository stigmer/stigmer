// What `plugin eval` prints and the code it exits with, read from the eval.
// Pure: every line is a function of the eval, so the views are unit-tested.
//
// The shapes are Claude Code's `claude plugin eval` output, so its readers
// read Stigmer's: a case's `mocked:` line before its first finished try
// (each mocked server with its tools, each other server "not started: no
// mock"), a progress line as each try finishes (case, target, arm, try, and
// its score or why it was not graded, and which mock stopped it when one
// did), then the summary table
// (`CASE WITH W/OUT Δ PASS^k RUNS COST NOTES`, or `SCORE PASS%` when the
// eval made no comparison), one block per engine and model, then the line
// `N case(s) · mean Δ +0.67 · 74s · $0.41`. Stigmer adds the `PASS^k`
// column (every try passed), says "Δ provisional" when the comparison also
// measured an agent Stigmer composed for the plugin (an eval made before
// conversations listed plugins directly), and lists the cases it
// did not run with the feature named.
//
// The exit code is the format's: 0 when every case that ran reached the
// threshold and every case file loaded; 1 for a case below it, a load
// finding, no case at all, or a case whose with-plugin tries on a target
// were all not graded (a case that never ran is not a pass); 2 for a
// partial run (the spending limit, the
// organization out of credit, or a reason or phase a newer server added);
// 130 when the eval was cancelled, by this command's Ctrl+C or any other
// cancel (the console's Cancel, `plugin eval cancel`). A connection or
// sign-in failure keeps the CLI's own 3 or 4, outside this file. A case
// Stigmer lists as not run (a feature it does not run yet) is named, not
// failed: it never ran, and `--case` or `--tag` leaves it out.
//
// Every text that reaches the terminal from the eval (a case name, a
// target's model name as the suite's case.yaml wrote it, a reason, an
// error) goes through `oneLine`, so a suite cannot write a newline or an
// escape sequence there.
//
// An agent eval carries these same case messages, one plugin's cases at a
// time, so the case-level views (`finishedTriesOf`, `renderCaseBlocks`,
// `notRunLinesOf`, `exitCodeOf`) take a list of cases, and the eval-level
// reads (`isSettled`, `partialLine`, `renderSummaryLine`) take any eval
// whose status has the fields they read; resources/agent-eval/report.ts
// builds its views from them.

import { pluginEvalTargetLabel } from "@stigmer/sdk";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import type { PluginEvalTarget } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import {
  PluginEvalPartialReason,
  PluginEvalPhase,
  PluginEvalTryState,
  type PluginEvalAggregates,
  type PluginEvalArm,
  type PluginEvalCase,
  type PluginEvalCaseTarget,
  type PluginEvalTry,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { renderTable } from "../../output/index.js";

/** The exit codes of `plugin eval`, as Claude Code's `claude plugin eval` has them. */
export const EvalExit = {
  Passed: 0,
  Failed: 1,
  Partial: 2,
  Interrupted: 130,
} as const;

export type EvalExit = (typeof EvalExit)[keyof typeof EvalExit];

/** The longest NOTES cell, so one long error does not widen every row. */
const MAX_NOTE = 60;

/** One finished try, keyed so a poll prints each try once. */
export interface FinishedTry {
  readonly key: string;
  readonly line: string;
}

/** The status fields that say where an eval is, which both eval kinds carry. */
export interface EvalProgress {
  readonly phase: PluginEvalPhase;
  readonly partialReason: PluginEvalPartialReason;
  readonly triesFinished: number;
  readonly triesTotal: number;
}

/** The status fields the summary line reads. */
interface EvalTotals {
  readonly aggregates?: PluginEvalAggregates;
  readonly costUsd: number;
  readonly provisionalDelta?: boolean;
}

/** How a set of cases is named in progress lines and keyed apart from another set's. */
export interface CaseScope {
  /** Prefixes every key, so two sets' cases never share one. */
  readonly key: string;
  /** Prefixes every case name printed, as in `thermos/`. */
  readonly name: string;
}

const NO_SCOPE: CaseScope = { key: "", name: "" };

/** Every try that has finished, with its progress line, in the eval's order. */
export function finishedTries(pluginEval: PluginEval): FinishedTry[] {
  return finishedTriesOf(pluginEval.status?.cases ?? [], NO_SCOPE);
}

/** Every finished try of `cases`, with its progress line, in their order. */
export function finishedTriesOf(cases: readonly PluginEvalCase[], scope: CaseScope): FinishedTry[] {
  const finished: FinishedTry[] = [];
  for (const evalCase of cases) {
    let mockedShown = evalCase.mockedServers.length === 0;
    const caseName = `${scope.name}${oneLine(evalCase.caseName)}`;
    for (const result of evalCase.targets) {
      const target = targetLabel(result.target);
      for (const [arm, tries] of armsOf(result)) {
        for (const attempt of tries) {
          if (!isFinished(attempt)) continue;
          if (!mockedShown) {
            mockedShown = true;
            finished.push({ key: `${scope.key}${evalCase.path}|mocked`, line: mockedLine(caseName, evalCase) });
          }
          finished.push({
            key: `${scope.key}${evalCase.path}|${target}|${arm}|${attempt.index}`,
            line: progressLine(caseName, target, arm, attempt, tries.length),
          });
        }
      }
    }
  }
  return finished;
}

/** The summary table, one block per target, each headed by its target. */
export function renderEvalTables(pluginEval: PluginEval): string {
  const oneArm = pluginEval.spec?.ablation === PluginEvalAblation.none;
  return renderCaseBlocks(pluginEval.status?.cases ?? [], pluginEval.spec?.targets ?? [], oneArm, (label) => label).join(
    "\n",
  );
}

/**
 * The table blocks of `cases`, one per target any of them ran on (the
 * spec's targets first), each under `heading(target)`; cases not run are
 * left out, and a target nothing ran on has no block.
 */
export function renderCaseBlocks(
  allCases: readonly PluginEvalCase[],
  specTargets: readonly PluginEvalTarget[],
  oneArm: boolean,
  heading: (target: string) => string,
): string[] {
  const cases = allCases.filter((evalCase) => evalCase.notRunReason === "");
  const blocks: string[] = [];
  for (const label of targetLabels(specTargets, allCases)) {
    const rows = cases.flatMap((evalCase) => {
      const result = evalCase.targets.find((candidate) => targetLabel(candidate.target) === label);
      if (result === undefined || result.notRunReason !== "") return [];
      return [oneArm ? oneArmRow(evalCase, result) : twoArmRow(evalCase, result)];
    });
    if (rows.length === 0) continue;
    const headers = oneArm
      ? ["CASE", "SCORE", "PASS%", "PASS^k", "RUNS", "COST", "NOTES"]
      : ["CASE", "WITH", "W/OUT", "Δ", "PASS^k", "RUNS", "COST", "NOTES"];
    blocks.push(`${heading(label)}\n${renderTable(headers, rows)}`);
  }
  return blocks;
}

/** `N case(s) · mean Δ +0.67 · 74s · $0.41`, with "Δ provisional" when the eval says so. */
export function renderSummaryLine(evaluation: { readonly status?: EvalTotals }, durationSeconds: number): string {
  const status = evaluation.status;
  const parts = [`${status?.aggregates?.casesTotal ?? 0} case(s)`];
  const meanDelta = status?.aggregates?.meanDelta;
  if (meanDelta !== undefined) {
    parts.push(`mean Δ ${signed(meanDelta)}`);
  }
  parts.push(`${Math.round(durationSeconds)}s`, usd(status?.costUsd ?? 0));
  if (meanDelta !== undefined && status?.provisionalDelta === true) {
    parts.push("Δ provisional");
  }
  return parts.join(" · ");
}

/**
 * Why the comparison is provisional, for the line under the summary: an
 * eval made before conversations listed plugins directly ran its with-arm
 * on an agent Stigmer composed for the plugin, whose
 * instructions name it, so Δ measures that agent as well as the plugin.
 */
export const PROVISIONAL_NOTE =
  "Δ provisional: this eval ran before conversations listed plugins directly; its runs with the plugin used an agent Stigmer composed for it, so Δ measures that agent too.";

/** The cases, or cases on one target, the eval listed and did not run, one line each. */
export function renderNotRun(pluginEval: PluginEval): string {
  return notRunSection(notRunLinesOf(pluginEval.status?.cases ?? [], NO_SCOPE));
}

/** The `Not run:` section for `lines`; empty when there are none. */
export function notRunSection(lines: readonly string[]): string {
  return lines.length === 0 ? "" : `Not run:\n${lines.join("\n")}\n`;
}

/** One indented line per case of `cases`, or case on one target, listed and not run. */
export function notRunLinesOf(cases: readonly PluginEvalCase[], scope: CaseScope): string[] {
  const lines: string[] = [];
  for (const evalCase of cases) {
    const caseName = `${scope.name}${oneLine(evalCase.caseName)}`;
    if (evalCase.notRunReason !== "") {
      lines.push(`  ${caseName}: ${oneLine(evalCase.notRunReason)}`);
      continue;
    }
    for (const result of evalCase.targets) {
      if (result.notRunReason !== "") {
        lines.push(`  ${caseName} on ${targetLabel(result.target)}: ${oneLine(result.notRunReason)}`);
      }
    }
  }
  return lines;
}

/** Why the eval stopped early, in words; empty when it did not. */
export function partialLine(evaluation: { readonly status?: EvalProgress }, interrupted: boolean): string {
  const status = evaluation.status;
  const reason = status?.partialReason ?? PluginEvalPartialReason.unspecified;
  const ran = `${status?.triesFinished ?? 0} of ${status?.triesTotal ?? 0} tries ran`;
  switch (reason) {
    case PluginEvalPartialReason.cost_ceiling:
      return `Stopped at the spending limit: ${ran}.`;
    case PluginEvalPartialReason.out_of_credit:
      return `Stopped: the organization is out of credit; ${ran}.`;
    case PluginEvalPartialReason.cancelled:
      return `Cancelled: ${ran}.`;
    case PluginEvalPartialReason.unspecified:
      return interrupted ? `Cancelled: ${ran}.` : "";
    default: {
      // A reason a newer server added: the run still stopped early.
      const unknown: never = reason;
      return `Stopped early (reason ${String(unknown)}): ${ran}.`;
    }
  }
}

/** The exit code a finished (or cancelled) eval earns. */
export function evalExitCode(
  pluginEval: PluginEval,
  opts: { readonly interrupted: boolean; readonly loadFindings: number },
): EvalExit {
  return exitCodeOf(pluginEval.status, pluginEval.status?.cases ?? [], opts);
}

/**
 * The exit code an eval with `status` earns over all of its `cases`: the
 * rules {@link evalExitCode} states, for either eval kind.
 */
export function exitCodeOf(
  status: (EvalProgress & { readonly aggregates?: PluginEvalAggregates }) | undefined,
  cases: readonly PluginEvalCase[],
  opts: { readonly interrupted: boolean; readonly loadFindings: number },
): EvalExit {
  const reason = status?.partialReason ?? PluginEvalPartialReason.unspecified;
  if (opts.interrupted || reason === PluginEvalPartialReason.cancelled) {
    return EvalExit.Interrupted;
  }
  if (reason !== PluginEvalPartialReason.unspecified) {
    // The spending limit, no credit, or a reason a newer server added: the
    // eval stopped early, so its aggregates cover only part of the suite.
    return EvalExit.Partial;
  }
  const phase = status?.phase ?? PluginEvalPhase.unspecified;
  switch (phase) {
    case PluginEvalPhase.failed:
      return EvalExit.Failed;
    case PluginEvalPhase.partial:
      return EvalExit.Partial;
    case PluginEvalPhase.unspecified:
    case PluginEvalPhase.pending:
    case PluginEvalPhase.running:
    case PluginEvalPhase.completed:
      break;
    default: {
      // A phase a newer server added: not one this command knows as a full
      // result, so never a pass.
      const unknown: never = phase;
      return typeof unknown === "number" ? EvalExit.Partial : EvalExit.Failed;
    }
  }
  const aggregates = status?.aggregates;
  const total = aggregates?.casesTotal ?? 0;
  if (
    total === 0 ||
    opts.loadFindings > 0 ||
    (aggregates?.casesPassed ?? 0) < total ||
    cases.some(neverGradedWithPlugin)
  ) {
    return EvalExit.Failed;
  }
  return EvalExit.Passed;
}

/**
 * Whether a case that ran left a target with-plugin tries none of which
 * was graded: the server leaves such a case out of its counts, but it
 * never ran there, so it is not a pass.
 */
function neverGradedWithPlugin(evalCase: PluginEvalCase): boolean {
  if (evalCase.notRunReason !== "") return false;
  return evalCase.targets.some((result) => {
    const tries = result.withPlugin?.tries ?? [];
    return (
      result.notRunReason === "" &&
      tries.length > 0 &&
      tries.every((attempt) => attempt.state !== PluginEvalTryState.graded)
    );
  });
}

/** Whether the eval has stopped changing. */
export function isSettled(evaluation: { readonly status?: Pick<EvalProgress, "phase"> }): boolean {
  const phase = evaluation.status?.phase ?? PluginEvalPhase.unspecified;
  switch (phase) {
    case PluginEvalPhase.completed:
    case PluginEvalPhase.partial:
    case PluginEvalPhase.failed:
      return true;
    case PluginEvalPhase.unspecified:
    case PluginEvalPhase.pending:
    case PluginEvalPhase.running:
      return false;
    default: {
      // A phase a newer server added: stop following rather than poll forever.
      const unknown: never = phase;
      return typeof unknown === "number";
    }
  }
}

/** A target's label as one line: its model name is the suite author's text. */
function targetLabel(target: Parameters<typeof pluginEvalTargetLabel>[0]): string {
  return oneLine(pluginEvalTargetLabel(target));
}

function targetLabels(specTargets: readonly PluginEvalTarget[], cases: readonly PluginEvalCase[]): string[] {
  const labels: string[] = [];
  const add = (label: string): void => {
    if (!labels.includes(label)) labels.push(label);
  };
  for (const target of specTargets) add(targetLabel(target));
  for (const evalCase of cases) {
    for (const result of evalCase.targets) add(targetLabel(result.target));
  }
  return labels;
}

function twoArmRow(evalCase: PluginEvalCase, result: PluginEvalCaseTarget): string[] {
  return [
    oneLine(evalCase.caseName),
    scoreCell(result.withPlugin),
    scoreCell(result.withoutPlugin),
    result.delta === undefined ? "—" : signed(result.delta),
    result.passK ? "yes" : "no",
    String(triesOf(result).length),
    usd(costOf(result)),
    notesOf(evalCase, result),
  ];
}

function oneArmRow(evalCase: PluginEvalCase, result: PluginEvalCaseTarget): string[] {
  const arm = result.withPlugin;
  const graded = arm?.gradedTries ?? 0;
  return [
    oneLine(evalCase.caseName),
    scoreCell(arm),
    graded === 0 ? "—" : `${Math.round(((arm?.perfectRuns ?? 0) / graded) * 100)}%`,
    result.passK ? "yes" : "no",
    String(triesOf(result).length),
    usd(costOf(result)),
    notesOf(evalCase, result),
  ];
}

/** `<case> · mocked: plugin_kit_tracker(create_issue, close_issue), plugin_kit_wiki[not started: no mock]`. */
function mockedLine(caseName: string, evalCase: PluginEvalCase): string {
  const servers = evalCase.mockedServers.map((server) =>
    server.notStartedReason !== ""
      ? `${oneLine(server.name)}[${oneLine(server.notStartedReason)}]`
      : `${oneLine(server.name)}(${server.tools.map(oneLine).join(", ")})`,
  );
  return `${caseName} · mocked: ${servers.join(", ")}`;
}

/** How a mock stopped a try, as the format reports it. */
function abortedText(aborted: NonNullable<PluginEvalTry["aborted"]>): string {
  return `aborted by ${aborted.server}.${aborted.tool}: ${aborted.reason}`;
}

/** The with-arm's first error, abort or not-graded reason, else the case's own notes. */
function notesOf(evalCase: PluginEvalCase, result: PluginEvalCaseTarget): string {
  const tries = result.withPlugin?.tries ?? [];
  const error = tries.find((attempt) => attempt.error !== "")?.error;
  const aborted = tries.find((attempt) => attempt.aborted !== undefined)?.aborted;
  const notGraded = tries.find((attempt) => attempt.notGradedReason !== "")?.notGradedReason;
  const note =
    error ??
    (aborted !== undefined
      ? abortedText(aborted)
      : notGraded === undefined
        ? evalCase.notes.join("; ")
        : `not graded: ${notGraded}`);
  const line = oneLine(note);
  return line.length > MAX_NOTE ? `${line.slice(0, MAX_NOTE - 1)}…` : line;
}

function armsOf(result: PluginEvalCaseTarget): [string, readonly PluginEvalTry[]][] {
  const arms: [string, readonly PluginEvalTry[]][] = [["with", result.withPlugin?.tries ?? []]];
  if (result.withoutPlugin !== undefined) {
    arms.push(["without", result.withoutPlugin.tries]);
  }
  return arms;
}

function triesOf(result: PluginEvalCaseTarget): PluginEvalTry[] {
  return [...(result.withPlugin?.tries ?? []), ...(result.withoutPlugin?.tries ?? [])];
}

function costOf(result: PluginEvalCaseTarget): number {
  return triesOf(result).reduce((sum, attempt) => sum + attempt.costUsd, 0);
}

function isFinished(attempt: PluginEvalTry): boolean {
  return attempt.state === PluginEvalTryState.graded || attempt.state === PluginEvalTryState.not_graded;
}

function progressLine(caseName: string, target: string, arm: string, attempt: PluginEvalTry, of: number): string {
  const outcome =
    attempt.state === PluginEvalTryState.graded
      ? attempt.score.toFixed(2)
      : `not graded: ${oneLine(attempt.notGradedReason) || "no reason given"}`;
  const error =
    attempt.error !== ""
      ? ` (${oneLine(attempt.error)})`
      : attempt.aborted !== undefined
        ? ` (${oneLine(abortedText(attempt.aborted))})`
        : "";
  return `${caseName} · ${target} · ${arm} · try ${attempt.index}/${of} · ${outcome}${error}`;
}

function scoreCell(arm: PluginEvalArm | undefined): string {
  return arm?.score === undefined ? "—" : arm.score.toFixed(2);
}

function signed(value: number): string {
  const fixed = value.toFixed(2);
  return value > 0 && fixed !== "0.00" ? `+${fixed}` : fixed === "-0.00" ? "0.00" : fixed;
}

function usd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/**
 * Text the server relays from a run (an error, a reason) as one line: a
 * run's error can quote a model's output, so a newline or an escape
 * sequence never reaches the terminal.
 */
export function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
}
