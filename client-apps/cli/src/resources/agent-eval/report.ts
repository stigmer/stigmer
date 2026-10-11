// What `agent eval` prints and the code it exits with, read from the eval.
// Pure: every line is a function of the eval, so the views are unit-tested.
//
// An agent eval's cases are plugin eval cases, grouped by plugin, so every
// view here is `plugin eval`'s (resources/plugin-eval/report.ts) applied to
// one plugin's cases at a time. A progress line names its case as
// `<plugin>/<case>`, since two plugins may each have a case of one name.
// The table is the one-arm table (SCORE PASS% PASS^k RUNS COST NOTES):
// one block per plugin and target, headed by the agent's slug and short
// version hash, the plugin's slug and short digest, and the target, so two
// versions' outputs read side by side. A plugin none of whose cases ran
// (not selected, or no cases at the version the agent attaches) is a
// block of its own heading and its reason. The cases a plugin listed and
// did not run follow in `Not run:`, as `plugin eval`'s do. The summary is
// `plugin eval`'s line, with no mean Δ: there is no comparison.
//
// The exit code is `plugin eval`'s over every plugin's cases: 0 when every
// case that ran reached the threshold, 1 when one did not or no case ran,
// 2 for a partial run, 130 when cancelled. An agent eval has no load
// findings of its own: a plugin's suite that cannot be read fails the eval.
//
// Every text from the eval goes through `oneLine`, as in `plugin eval`.

import type { AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import type { AgentEvalPlugin } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/status_pb";
import {
  exitCodeOf,
  finishedTriesOf,
  notRunLinesOf,
  notRunSection,
  oneLine,
  partialLine,
  renderCaseBlocks,
  renderSummaryLine,
  type CaseScope,
  type EvalExit,
  type FinishedTry,
} from "../plugin-eval/report.js";

/** How many characters of a version hash or a digest a heading shows. */
const SHORT_HASH = 12;

/** Every finished try of every plugin, with its progress line, in the eval's order. */
export function agentFinishedTries(agentEval: AgentEval): FinishedTry[] {
  return (agentEval.status?.plugins ?? []).flatMap((plugin) => finishedTriesOf(plugin.cases, scopeOf(plugin)));
}

/**
 * The table blocks, plugin by plugin in the agent's order: one per target
 * a plugin's cases ran on, or one line of why none of them ran.
 */
export function renderAgentEvalTables(agentEval: AgentEval, agentSlug: string): string {
  const agent = headingOf(oneLine(agentSlug), versionHashOf(agentEval));
  const blocks: string[] = [];
  for (const plugin of agentEval.status?.plugins ?? []) {
    const head = `${agent} · ${headingOf(oneLine(plugin.pluginSlug), plugin.pluginDigest)}`;
    if (plugin.notRunReason !== "") {
      blocks.push(`${head}\n  not run: ${oneLine(plugin.notRunReason)}\n`);
      continue;
    }
    blocks.push(...renderCaseBlocks(plugin.cases, agentEval.spec?.targets ?? [], true, (target) => `${head} · ${target}`));
  }
  return blocks.join("\n");
}

/** The cases, or cases on one target, a plugin listed and the eval did not run. */
export function renderAgentNotRun(agentEval: AgentEval): string {
  return notRunSection((agentEval.status?.plugins ?? []).flatMap((plugin) => notRunLinesOf(plugin.cases, scopeOf(plugin))));
}

/**
 * The text for stdout: the tables, the summary, why the eval stopped (or
 * `stillRunning` in its place, when not empty), and the cases not run.
 */
export function renderAgentEvalReport(
  agentEval: AgentEval,
  opts: {
    readonly agentSlug: string;
    readonly interrupted: boolean;
    readonly durationSeconds: number;
    readonly stillRunning: string;
  },
): string {
  const tables = renderAgentEvalTables(agentEval, opts.agentSlug);
  const lines: string[] = [];
  if (tables !== "") lines.push(tables);
  lines.push(renderSummaryLine(agentEval, opts.durationSeconds));
  const partial = opts.stillRunning === "" ? partialLine(agentEval, opts.interrupted) : opts.stillRunning;
  if (partial !== "") lines.push(partial);
  const notRun = renderAgentNotRun(agentEval);
  return `\n${lines.join("\n")}\n${notRun === "" ? "" : `\n${notRun}`}`;
}

/** The exit code a finished (or cancelled) agent eval earns. */
export function agentEvalExitCode(agentEval: AgentEval, opts: { readonly interrupted: boolean }): EvalExit {
  const cases = (agentEval.status?.plugins ?? []).flatMap((plugin) => plugin.cases);
  return exitCodeOf(agentEval.status, cases, { interrupted: opts.interrupted, loadFindings: 0 });
}

/** A plugin's cases named `<plugin>/<case>` and keyed by the plugin's id. */
function scopeOf(plugin: AgentEvalPlugin): CaseScope {
  return { key: `${plugin.pluginId}|`, name: `${oneLine(plugin.pluginSlug)}/` };
}

/** `<name>@<short hash>`, or the name alone when there is no hash yet. */
function headingOf(name: string, hash: string): string {
  const short = oneLine(hash).slice(0, SHORT_HASH);
  return short === "" ? name : `${name}@${short}`;
}

/** The version the tries ran: the status's stamp, or the spec's before the status carries one. */
function versionHashOf(agentEval: AgentEval): string {
  const stamped = agentEval.status?.agentVersionHash ?? "";
  return stamped !== "" ? stamped : (agentEval.spec?.agentVersion ?? "");
}
