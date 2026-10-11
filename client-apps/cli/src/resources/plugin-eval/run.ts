// `plugin eval` dispatch: resolve the plugin, start its eval, follow it to
// the end, and print or write the result.
//
// The start, the follow loop, Ctrl+C, the deadlines and the exit on a lost
// eval are the loop both eval commands share (follow.ts, whose header holds
// those rules); this module is the plugin's part in it: the plugin read,
// the create, the suite's load findings, and the report and document.
//
// The eval is sent with no name: the server names it by its id, which is
// short and unique, and a person tells evals apart by plugin and start time.
//
// The suite's load findings go to stderr before the eval starts, each as
// the server relays it, on one line: its message already starts with the
// file's path. Under `--json` they go into Stigmer's `findings` field of
// the result document beside the format's, and a finding fails the exit
// code. Reading the plugin is part of the start: its refusal exits 1, as
// create's does.

import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { PluginWarning } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { toResultDocument, type PluginEvalResultDocument, type Stigmer } from "@stigmer/sdk";
import { requireOrganization } from "../../client/single-org.js";
import { parseReference } from "../reference.js";
import { asStartRefusal, runEval, type EvalIo } from "./follow.js";
import type { PluginEvalOptions, PluginTarget } from "./options.js";
import {
  PROVISIONAL_NOTE,
  evalExitCode,
  finishedTries,
  oneLine,
  partialLine,
  renderEvalTables,
  renderNotRun,
  renderSummaryLine,
  type EvalExit,
} from "./report.js";

export { CALL_DEADLINE_MS, POLL_INTERVAL_MS, POLL_RETRY_BUDGET_MS } from "./follow.js";

/** The plugin kind's id prefix (proto kind_meta). */
const PLUGIN_ID_PREFIX = "plg";

/** A problem reading the plugin's suite, as the result document carries it. */
interface ResultFinding {
  /** The finding's kind, such as `eval-case-invalid`. */
  readonly kind: string;
  /** The plugin-relative file it is about; empty for the suite as a whole. */
  readonly path: string;
  /** The sentence, which starts with the path. */
  readonly message: string;
}

/** The result document the command writes: the SDK's, with the suite's load findings. */
interface CliResultDocument extends PluginEvalResultDocument {
  readonly findings: readonly ResultFinding[];
  /**
   * Present, and true, only when the command stopped following the eval and
   * could not cancel it: the eval may still be running and spending.
   */
  readonly stillRunning?: true;
}

/** Everything the command does to the world besides the API (follow.ts). */
export type PluginEvalIo = EvalIo;

/** Runs `stigmer plugin eval` and returns the code to exit with. */
export async function runPluginEval(
  client: Stigmer,
  org: string,
  target: PluginTarget,
  options: PluginEvalOptions,
  io: PluginEvalIo,
): Promise<EvalExit> {
  const quiet = options.json.kind !== "none";
  const plugin = await resolvePlugin(client, target.ref, org).catch(asStartRefusal);
  const findings = plugin.status?.evals?.findings ?? [];
  if (!quiet) {
    for (const finding of findings) io.stderr.write(`evals: ${oneLine(finding.message)}\n`);
  }
  return runEval<PluginEval>(
    {
      cancelCommand: "stigmer plugin eval cancel",
      getCommand: "stigmer get plugin-eval",
      cancelElsewhere: "cancel it from the plugin's Evals tab in the console",
      on: plugin.metadata?.name || target.ref,
      create: () => startEval(client, plugin, target, options),
      get: (id) => client.plugineval.get(id),
      cancel: (id) => client.plugineval.cancel(id),
      finishedTries,
      report: (pluginEval, interrupted, stillRunning) => reportOf(pluginEval, interrupted, io.now(), stillRunning),
      document: (pluginEval, interrupted, stillRunning) => documentOf(pluginEval, findings, interrupted, io.now(), stillRunning),
      exitCode: (pluginEval, interrupted) => evalExitCode(pluginEval, { interrupted, loadFindings: findings.length }),
    },
    options,
    io,
  );
}

/** Cancels an eval and says what happened. */
export async function cancelPluginEval(client: Stigmer, id: string, io: Pick<PluginEvalIo, "stderr">): Promise<void> {
  const cancelled = await client.plugineval.cancel(id);
  const status = cancelled.status;
  io.stderr.write(
    `Cancelled ${id}: tries in flight stop; ${status?.triesFinished ?? 0} of ${status?.triesTotal ?? 0} tries had finished.\n`,
  );
}

async function resolvePlugin(client: Stigmer, ref: string, org: string): Promise<Plugin> {
  const parsed = parseReference(ref, org, PLUGIN_ID_PREFIX);
  if (parsed.kind === "id") {
    return client.plugin.get(parsed.id);
  }
  await requireOrganization(client, parsed.org, [
    "stigmer config context set --org <org>",
    "stigmer plugin eval --org <org> ...",
  ]);
  return client.plugin.getByReference({ org: parsed.org, slug: parsed.slug });
}

async function startEval(
  client: Stigmer,
  plugin: Plugin,
  target: PluginTarget,
  options: PluginEvalOptions,
): Promise<PluginEval> {
  try {
    return await client.plugineval.create({
      name: "",
      org: plugin.metadata?.org ?? "",
      pluginId: plugin.metadata?.id ?? "",
      pluginDigest: target.digest,
      targets: [...options.targets],
      runs: options.runs,
      ablation: options.ablation,
      ...(options.threshold !== undefined && { threshold: options.threshold }),
      caseGlob: options.caseGlob,
      caseTags: [...options.caseTags],
      judgeModel: options.judgeModel,
      maxCostUsd: options.maxCostUsd,
      concurrency: options.concurrency,
      allowTools: [...options.allowTools],
      realMcpServers: options.realMcpServers,
      allowRealServers: options.allowRealServers,
      skipScaffold: options.skipScaffold,
    });
  } catch (error) {
    return asStartRefusal(error);
  }
}

/**
 * The tables, the summary and the cases not run. `stillRunning`, when not
 * empty, is the line said in place of why the eval stopped: it may not have.
 */
function reportOf(pluginEval: PluginEval, interrupted: boolean, nowMs: number, stillRunning: string): string {
  const tables = renderEvalTables(pluginEval);
  const document = toResultDocument(pluginEval, { interrupted, nowMs });
  const lines: string[] = [];
  if (tables !== "") lines.push(tables);
  lines.push(renderSummaryLine(pluginEval, document.durationSeconds));
  if (document.provisionalDelta && pluginEval.status?.aggregates?.meanDelta !== undefined) {
    lines.push(PROVISIONAL_NOTE);
  }
  const partial = stillRunning === "" ? partialLine(pluginEval, interrupted) : stillRunning;
  if (partial !== "") lines.push(partial);
  const notRun = renderNotRun(pluginEval);
  return `\n${lines.join("\n")}\n${notRun === "" ? "" : `\n${notRun}`}`;
}

function documentOf(
  pluginEval: PluginEval,
  findings: readonly PluginWarning[],
  interrupted: boolean,
  nowMs: number,
  stillRunning: boolean,
): CliResultDocument {
  return {
    ...toResultDocument(pluginEval, { interrupted, nowMs }),
    findings: findings.map((finding) => ({ kind: finding.kind, path: finding.path, message: finding.message })),
    ...(stillRunning && { stillRunning: true as const }),
  };
}
