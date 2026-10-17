// What `eval run` prints and the code it exits with, read from the eval
// run. Pure: every line is a function of the eval run, so the views are
// unit-tested.
//
// The shapes are Claude Code's `claude plugin eval` output, so its readers
// read Stigmer's: a case's `mocked:` line before its first finished try
// (each mocked server with its tools, each other server "not started: no
// mock"), a progress line as each try finishes (case, target, arm, try, and
// its score or why it was not graded, and which mock stopped it when one
// did), then the summary table (`CASE WITH W/OUT Δ PASS^k RUNS COST NOTES`
// when the eval run compares a plugin, else `SCORE PASS%`), then the line
// `N case(s) · mean Δ +0.67 · 74s · $0.41`. Stigmer adds the `PASS^k`
// column (every try passed) and lists the cases it did not run with the
// feature named.
//
// An eval run's cases are grouped by the plugin they come from, so the
// table is one block per plugin and target, headed by what ran: the
// agent's slug and short version hash on an eval run about an agent, the
// plugin's slug and short digest (marked `compared` when it is the plugin
// each case ran with and without), and the target, so two versions'
// outputs read side by side. A plugin none of whose cases ran (not
// selected, or no cases at the version a try loads) is a block of its own
// heading and its reason. An Eval whose cases ran on the agent follows the
// plugins, one block of its own per target, headed `eval <slug>@<digest>`.
// On an eval run about an agent a progress line names its case as
// `<plugin>/<case>` or `<eval>/<case>`, since two sources may each have a
// case of one name; about a plugin, by its name alone, as the format does.
//
// The exit code is the format's: 0 when every case that ran reached the
// threshold and every case file loaded; 1 for a case below it, a load
// finding, no case at all, or a case whose with-plugin tries on a target
// were all not graded (a case that never ran is not a pass); 2 for a
// partial run (the spending limit, or a reason or phase a newer server
// added); 130 when the eval run was cancelled, by this command's Ctrl+C or
// any other cancel (the console's Cancel, `eval cancel`). A connection or
// sign-in failure keeps the CLI's own 3 or 4, outside this file. A case
// Stigmer lists as not run (a feature it does not run yet) is named, not
// failed: it never ran, and `--case` or `--tag` leaves it out.
//
// Every text that reaches the terminal from the eval run (a case name, a
// target's model name as the suite's case.yaml wrote it, a reason, an
// error) goes through `oneLine`, so a suite cannot write a newline or an
// escape sequence there.

import { evalRunTargetLabel } from "@stigmer/client";
import type { EvalRun } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunAblation } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import type { EvalRunTarget } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import {
  EvalRunPartialReason,
  EvalRunPhase,
  EvalRunTryState,
  type EvalRunArm,
  type EvalRunCase,
  type EvalRunCaseTarget,
  type EvalRunTry,
} from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import { renderTable } from "../../output/index.js";

/** The exit codes of `eval run`, as Claude Code's `claude plugin eval` has them. */
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

/** How many characters of a version hash or a digest a heading shows. */
const SHORT_HASH = 12;

/** The status fields that say where an eval run is. */
export interface EvalProgress {
  readonly phase: EvalRunPhase;
  readonly partialReason: EvalRunPartialReason;
  readonly triesFinished: number;
  readonly triesTotal: number;
}

/** How a set of cases is named in progress lines and keyed apart from another set's. */
interface CaseScope {
  /** Prefixes every key, so two sets' cases never share one. */
  readonly key: string;
  /** Prefixes every case name printed, as in `thermos/`. */
  readonly name: string;
}

/** Every finished try of every plugin and Eval, with its progress line, in the eval run's order. */
export function finishedTries(evalRun: EvalRun): FinishedTry[] {
  return groupsOf(evalRun).flatMap((group) => finishedTriesOf(group.cases, group.scope));
}

/** Every finished try of `cases`, with its progress line, in their order. */
function finishedTriesOf(cases: readonly EvalRunCase[], scope: CaseScope): FinishedTry[] {
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

/**
 * The table blocks, plugin by plugin in the eval run's order: one per
 * target a plugin's cases ran on, or one line of why none of them ran.
 * `subjectSlug` names an eval run's agent; unused on one about a plugin.
 */
export function renderEvalTables(evalRun: EvalRun, subjectSlug: string): string {
  const agent = isAboutAgent(evalRun) ? headingOf(oneLine(subjectSlug), versionHashOf(evalRun)) : "";
  const oneArm = !isComparing(evalRun);
  const blocks: string[] = [];
  for (const group of groupsOf(evalRun)) {
    const head = agent === "" ? group.heading : `${agent} · ${group.heading}`;
    if (group.notRunReason !== "") {
      blocks.push(`${head}\n  not run: ${oneLine(group.notRunReason)}\n`);
      continue;
    }
    blocks.push(...renderCaseBlocks(group.cases, evalRun.spec?.targets ?? [], oneArm, (target) => `${head} · ${target}`));
  }
  return blocks.join("\n");
}

/**
 * The table blocks of `cases`, one per target any of them ran on (the
 * spec's targets first), each under `heading(target)`; cases not run are
 * left out, and a target nothing ran on has no block.
 */
function renderCaseBlocks(
  allCases: readonly EvalRunCase[],
  specTargets: readonly EvalRunTarget[],
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

/** `N case(s) · mean Δ +0.67 · 74s · $0.41`. */
export function renderSummaryLine(evalRun: EvalRun, durationSeconds: number): string {
  const status = evalRun.status;
  const parts = [`${status?.aggregates?.casesTotal ?? 0} case(s)`];
  const meanDelta = status?.aggregates?.meanDelta;
  if (meanDelta !== undefined) {
    parts.push(`mean Δ ${signed(meanDelta)}`);
  }
  parts.push(`${Math.round(durationSeconds)}s`, usd(status?.costUsd ?? 0));
  return parts.join(" · ");
}

/**
 * The text for stdout: the tables, the summary, why the eval run stopped
 * (or `stillRunning` in its place, when not empty), and the cases not run.
 */
export function renderEvalReport(
  evalRun: EvalRun,
  opts: {
    readonly subjectSlug: string;
    readonly interrupted: boolean;
    readonly durationSeconds: number;
    readonly stillRunning: string;
  },
): string {
  const tables = renderEvalTables(evalRun, opts.subjectSlug);
  const lines: string[] = [];
  if (tables !== "") lines.push(tables);
  lines.push(renderSummaryLine(evalRun, opts.durationSeconds));
  const partial = opts.stillRunning === "" ? partialLine(evalRun, opts.interrupted) : opts.stillRunning;
  if (partial !== "") lines.push(partial);
  const notRun = renderNotRun(evalRun);
  return `\n${lines.join("\n")}\n${notRun === "" ? "" : `\n${notRun}`}`;
}

/** The cases, or cases on one target, the eval run listed and did not run, one line each. */
export function renderNotRun(evalRun: EvalRun): string {
  return notRunSection(groupsOf(evalRun).flatMap((group) => notRunLinesOf(group.cases, group.scope)));
}

/** The `Not run:` section for `lines`; empty when there are none. */
function notRunSection(lines: readonly string[]): string {
  return lines.length === 0 ? "" : `Not run:\n${lines.join("\n")}\n`;
}

/** One indented line per case of `cases`, or case on one target, listed and not run. */
function notRunLinesOf(cases: readonly EvalRunCase[], scope: CaseScope): string[] {
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
  const reason = status?.partialReason ?? EvalRunPartialReason.unspecified;
  const ran = `${status?.triesFinished ?? 0} of ${status?.triesTotal ?? 0} tries ran`;
  switch (reason) {
    case EvalRunPartialReason.cost_ceiling:
      return `Stopped at the spending limit: ${ran}.`;
    case EvalRunPartialReason.cancelled:
      return `Cancelled: ${ran}.`;
    case EvalRunPartialReason.unspecified:
      return interrupted ? `Cancelled: ${ran}.` : "";
    default: {
      // A reason a newer server added: the run still stopped early.
      const unknown: never = reason;
      return `Stopped early (reason ${String(unknown)}): ${ran}.`;
    }
  }
}

/** The exit code a finished (or cancelled) eval run earns over every plugin's cases (the module header). */
export function evalExitCode(
  evalRun: EvalRun,
  opts: { readonly interrupted: boolean; readonly loadFindings: number },
): EvalExit {
  const status = evalRun.status;
  const cases = groupsOf(evalRun).flatMap((group) => group.cases);
  const reason = status?.partialReason ?? EvalRunPartialReason.unspecified;
  if (opts.interrupted || reason === EvalRunPartialReason.cancelled) {
    return EvalExit.Interrupted;
  }
  if (reason !== EvalRunPartialReason.unspecified) {
    // The spending limit, or a reason a newer server added: the
    // eval stopped early, so its aggregates cover only part of the suite.
    return EvalExit.Partial;
  }
  const phase = status?.phase ?? EvalRunPhase.unspecified;
  switch (phase) {
    case EvalRunPhase.failed:
      return EvalExit.Failed;
    case EvalRunPhase.partial:
      return EvalExit.Partial;
    case EvalRunPhase.unspecified:
    case EvalRunPhase.pending:
    case EvalRunPhase.running:
    case EvalRunPhase.completed:
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
function neverGradedWithPlugin(evalCase: EvalRunCase): boolean {
  if (evalCase.notRunReason !== "") return false;
  return evalCase.targets.some((result) => {
    const tries = result.withPlugin?.tries ?? [];
    return (
      result.notRunReason === "" &&
      tries.length > 0 &&
      tries.every((attempt) => attempt.state !== EvalRunTryState.graded)
    );
  });
}

/** Whether the eval has stopped changing. */
export function isSettled(evaluation: { readonly status?: Pick<EvalProgress, "phase"> }): boolean {
  const phase = evaluation.status?.phase ?? EvalRunPhase.unspecified;
  switch (phase) {
    case EvalRunPhase.completed:
    case EvalRunPhase.partial:
    case EvalRunPhase.failed:
      return true;
    case EvalRunPhase.unspecified:
    case EvalRunPhase.pending:
    case EvalRunPhase.running:
      return false;
    default: {
      // A phase a newer server added: stop following rather than poll forever.
      const unknown: never = phase;
      return typeof unknown === "number";
    }
  }
}

/** One source of an eval run's cases as the report shows it: a plugin, or an Eval. */
interface CaseGroup {
  readonly heading: string;
  readonly notRunReason: string;
  readonly cases: readonly EvalRunCase[];
  readonly scope: CaseScope;
}

/**
 * The plugins of the eval run, in its order, then its Evals: each headed
 * by its slug and short version (a plugin marked `compared` on an eval run
 * about an agent, an Eval as `eval <slug>`), its cases named
 * `<source>/<case>` on an eval run about an agent and keyed by its id.
 */
function groupsOf(evalRun: EvalRun): CaseGroup[] {
  const onAgent = isAboutAgent(evalRun);
  const plugins = (evalRun.status?.plugins ?? []).map((plugin) => ({
    heading: `${headingOf(oneLine(plugin.pluginSlug), plugin.pluginDigest)}${plugin.compared && onAgent ? " (compared)" : ""}`,
    notRunReason: plugin.notRunReason,
    cases: plugin.cases,
    scope: { key: `${plugin.pluginId}|`, name: onAgent ? `${oneLine(plugin.pluginSlug)}/` : "" },
  }));
  const evals = (evalRun.status?.evals ?? []).map((evalBlock) => ({
    heading: `eval ${headingOf(oneLine(evalBlock.evalSlug), evalBlock.evalDigest)}`,
    notRunReason: evalBlock.notRunReason,
    cases: evalBlock.cases,
    scope: { key: `${evalBlock.evalId}|`, name: `${oneLine(evalBlock.evalSlug)}/` },
  }));
  return [...plugins, ...evals];
}

/** Whether the eval run is about an agent. */
function isAboutAgent(evalRun: EvalRun): boolean {
  return evalRun.spec?.subject.case === "agentId";
}

/** Whether each case runs with and without a plugin: one is compared, and the ablation is not none. */
function isComparing(evalRun: EvalRun): boolean {
  const spec = evalRun.spec;
  const compared = spec?.subject.case === "pluginId" || (spec?.comparedPluginId ?? "") !== "";
  return compared && spec?.ablation !== EvalRunAblation.none;
}

/** `<name>@<short hash>`, or the name alone when there is no hash yet. */
function headingOf(name: string, hash: string): string {
  const short = oneLine(hash).slice(0, SHORT_HASH);
  return short === "" ? name : `${name}@${short}`;
}

/** The agent version the tries ran: the status's stamp, or the spec's before the status carries one. */
function versionHashOf(evalRun: EvalRun): string {
  const stamped = evalRun.status?.agentVersionHash ?? "";
  return stamped !== "" ? stamped : (evalRun.spec?.agentVersion ?? "");
}

/** A target's label as one line: its model name is the suite author's text. */
function targetLabel(target: Parameters<typeof evalRunTargetLabel>[0]): string {
  return oneLine(evalRunTargetLabel(target));
}

function targetLabels(specTargets: readonly EvalRunTarget[], cases: readonly EvalRunCase[]): string[] {
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

function twoArmRow(evalCase: EvalRunCase, result: EvalRunCaseTarget): string[] {
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

function oneArmRow(evalCase: EvalRunCase, result: EvalRunCaseTarget): string[] {
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
function mockedLine(caseName: string, evalCase: EvalRunCase): string {
  const servers = evalCase.mockedServers.map((server) =>
    server.notStartedReason !== ""
      ? `${oneLine(server.name)}[${oneLine(server.notStartedReason)}]`
      : `${oneLine(server.name)}(${server.tools.map(oneLine).join(", ")})`,
  );
  return `${caseName} · mocked: ${servers.join(", ")}`;
}

/** How a mock stopped a try, as the format reports it. */
function abortedText(aborted: NonNullable<EvalRunTry["aborted"]>): string {
  return `aborted by ${aborted.server}.${aborted.tool}: ${aborted.reason}`;
}

/** The with-arm's first error, abort or not-graded reason, else the case's own notes. */
function notesOf(evalCase: EvalRunCase, result: EvalRunCaseTarget): string {
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

function armsOf(result: EvalRunCaseTarget): [string, readonly EvalRunTry[]][] {
  const arms: [string, readonly EvalRunTry[]][] = [["with", result.withPlugin?.tries ?? []]];
  if (result.withoutPlugin !== undefined) {
    arms.push(["without", result.withoutPlugin.tries]);
  }
  return arms;
}

function triesOf(result: EvalRunCaseTarget): EvalRunTry[] {
  return [...(result.withPlugin?.tries ?? []), ...(result.withoutPlugin?.tries ?? [])];
}

function costOf(result: EvalRunCaseTarget): number {
  return triesOf(result).reduce((sum, attempt) => sum + attempt.costUsd, 0);
}

function isFinished(attempt: EvalRunTry): boolean {
  return attempt.state === EvalRunTryState.graded || attempt.state === EvalRunTryState.not_graded;
}

function progressLine(caseName: string, target: string, arm: string, attempt: EvalRunTry, of: number): string {
  const outcome =
    attempt.state === EvalRunTryState.graded
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

function scoreCell(arm: EvalRunArm | undefined): string {
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
