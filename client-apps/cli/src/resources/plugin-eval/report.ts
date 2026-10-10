// What `plugin eval` prints and the code it exits with, read from the eval.
// Pure: every line is a function of the eval, so the views are unit-tested.
//
// The shapes are Claude Code's `claude plugin eval` output, so its readers
// read Stigmer's: a progress line as each try finishes (case, target, arm,
// try, and its score or why it was not graded), then the summary table
// (`CASE WITH W/OUT Δ PASS^k RUNS COST NOTES`, or `SCORE PASS%` when the
// eval made no comparison), one block per engine and model, then the line
// `N case(s) · mean Δ +0.67 · 74s · $0.41`. Stigmer adds the `PASS^k`
// column (every try passed), says "Δ provisional" while the comparison also
// measures the agent Stigmer composes for the plugin, and lists the cases it
// did not run with the feature named.
//
// The exit code is the format's: 0 when every case that ran reached the
// threshold and every case file loaded; 1 for a case below it, a load
// finding, or no case at all; 2 for a partial run (the spending limit, or
// the organization out of credit); 130 when the eval was cancelled, by this
// command's Ctrl+C or by someone else. A case Stigmer lists as not run (a
// feature it does not run yet) is named, not failed: it never ran, and
// `--case` or `--tag` leaves it out.

import { pluginEvalTargetLabel } from "@stigmer/sdk";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import {
  PluginEvalPartialReason,
  PluginEvalPhase,
  PluginEvalTryState,
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

/** Every try that has finished, with its progress line, in the eval's order. */
export function finishedTries(pluginEval: PluginEval): FinishedTry[] {
  const finished: FinishedTry[] = [];
  for (const evalCase of pluginEval.status?.cases ?? []) {
    for (const result of evalCase.targets) {
      const target = pluginEvalTargetLabel(result.target);
      for (const [arm, tries] of armsOf(result)) {
        for (const attempt of tries) {
          if (!isFinished(attempt)) continue;
          finished.push({
            key: `${evalCase.path}|${target}|${arm}|${attempt.index}`,
            line: progressLine(oneLine(evalCase.caseName), target, arm, attempt, tries.length),
          });
        }
      }
    }
  }
  return finished;
}

/** The summary table, one block per target, each headed by its target. */
export function renderEvalTables(pluginEval: PluginEval): string {
  const cases = (pluginEval.status?.cases ?? []).filter((evalCase) => evalCase.notRunReason === "");
  const oneArm = pluginEval.spec?.ablation === PluginEvalAblation.none;
  const blocks: string[] = [];
  for (const label of targetLabels(pluginEval)) {
    const rows = cases.flatMap((evalCase) => {
      const result = evalCase.targets.find((candidate) => pluginEvalTargetLabel(candidate.target) === label);
      if (result === undefined || result.notRunReason !== "") return [];
      return [oneArm ? oneArmRow(evalCase, result) : twoArmRow(evalCase, result)];
    });
    if (rows.length === 0) continue;
    const headers = oneArm
      ? ["CASE", "SCORE", "PASS%", "PASS^k", "RUNS", "COST", "NOTES"]
      : ["CASE", "WITH", "W/OUT", "Δ", "PASS^k", "RUNS", "COST", "NOTES"];
    blocks.push(`${label}\n${renderTable(headers, rows)}`);
  }
  return blocks.join("\n");
}

/** `N case(s) · mean Δ +0.67 · 74s · $0.41`, with "Δ provisional" when the eval says so. */
export function renderSummaryLine(pluginEval: PluginEval, durationSeconds: number): string {
  const status = pluginEval.status;
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
 * Why the comparison is provisional, for the line under the summary: the
 * with-arm runs on the agent Stigmer composes for the plugin, whose
 * instructions name it, so Δ measures that agent as well as the plugin.
 */
export const PROVISIONAL_NOTE =
  "Δ provisional: the runs with the plugin use the agent Stigmer composes for it, whose instructions name the plugin, so Δ measures that agent too.";

/** The cases, or cases on one target, the eval listed and did not run, one line each. */
export function renderNotRun(pluginEval: PluginEval): string {
  const lines: string[] = [];
  for (const evalCase of pluginEval.status?.cases ?? []) {
    if (evalCase.notRunReason !== "") {
      lines.push(`  ${oneLine(evalCase.caseName)}: ${oneLine(evalCase.notRunReason)}`);
      continue;
    }
    for (const result of evalCase.targets) {
      if (result.notRunReason !== "") {
        lines.push(`  ${oneLine(evalCase.caseName)} on ${pluginEvalTargetLabel(result.target)}: ${oneLine(result.notRunReason)}`);
      }
    }
  }
  return lines.length === 0 ? "" : `Not run:\n${lines.join("\n")}\n`;
}

/** Why the eval stopped early, in words; empty when it did not. */
export function partialLine(pluginEval: PluginEval, interrupted: boolean): string {
  const status = pluginEval.status;
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
  const status = pluginEval.status;
  const reason = status?.partialReason ?? PluginEvalPartialReason.unspecified;
  if (opts.interrupted || reason === PluginEvalPartialReason.cancelled) {
    return EvalExit.Interrupted;
  }
  if (reason === PluginEvalPartialReason.cost_ceiling || reason === PluginEvalPartialReason.out_of_credit) {
    return EvalExit.Partial;
  }
  if (status?.phase === PluginEvalPhase.failed) {
    return EvalExit.Failed;
  }
  const aggregates = status?.aggregates;
  const total = aggregates?.casesTotal ?? 0;
  if (total === 0 || opts.loadFindings > 0 || (aggregates?.casesPassed ?? 0) < total) {
    return EvalExit.Failed;
  }
  return EvalExit.Passed;
}

/** Whether the eval has stopped changing. */
export function isSettled(pluginEval: PluginEval): boolean {
  const phase = pluginEval.status?.phase ?? PluginEvalPhase.unspecified;
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

function targetLabels(pluginEval: PluginEval): string[] {
  const labels: string[] = [];
  const add = (label: string): void => {
    if (!labels.includes(label)) labels.push(label);
  };
  for (const target of pluginEval.spec?.targets ?? []) add(pluginEvalTargetLabel(target));
  for (const evalCase of pluginEval.status?.cases ?? []) {
    for (const result of evalCase.targets) add(pluginEvalTargetLabel(result.target));
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

/** The with-arm's first error or not-graded reason, else the case's own notes. */
function notesOf(evalCase: PluginEvalCase, result: PluginEvalCaseTarget): string {
  const tries = result.withPlugin?.tries ?? [];
  const error = tries.find((attempt) => attempt.error !== "")?.error;
  const notGraded = tries.find((attempt) => attempt.notGradedReason !== "")?.notGradedReason;
  const note = error ?? (notGraded === undefined ? evalCase.notes.join("; ") : `not graded: ${notGraded}`);
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
  const error = attempt.error === "" ? "" : ` (${oneLine(attempt.error)})`;
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
function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
}
