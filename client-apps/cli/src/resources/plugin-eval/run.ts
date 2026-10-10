// `plugin eval` dispatch: resolve the plugin, start its eval, follow it to
// the end, and print or write the result.
//
// The eval runs on the server, so the command only starts it and reads it
// again every two seconds; closing the terminal leaves it running, and
// `--no-wait` returns at once with its id. Ctrl+C is the format's interrupt:
// the command cancels the eval (tries in flight stop), prints the results
// of the tries that finished, and exits 130; a second Ctrl+C exits at once.
//
// Streams follow the CLI's law: progress lines, notices and the suite's
// load findings go to stderr, the table and the summary to stdout. Under
// `--json` the run is quiet, as in the format: the result document goes to
// stdout, or to the `.json` path given, and nothing else is printed but an
// error. A refusal from create exits 1, the format's "a run couldn't be
// started", unless it is the CLI's own sign-in or connection failure.
//
// Every effect is injected (`PluginEvalIo`), so the follow loop, the
// interrupt and the outputs are unit-tested without a server or a clock.

import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { pluginEvalName, toResultDocument, type Stigmer } from "@stigmer/sdk";
import { requireOrganization } from "../../client/single-org.js";
import { CliExitError, ExitCode, classify } from "../../errors/index.js";
import { parseReference } from "../reference.js";
import type { PluginEvalOptions, PluginTarget } from "./options.js";
import {
  EvalExit,
  PROVISIONAL_NOTE,
  evalExitCode,
  finishedTries,
  isSettled,
  partialLine,
  renderEvalTables,
  renderNotRun,
  renderSummaryLine,
} from "./report.js";

/** How often the command reads the eval again while it runs. */
export const POLL_INTERVAL_MS = 2_000;

/** The plugin kind's id prefix (proto kind_meta). */
const PLUGIN_ID_PREFIX = "plg";

/** Everything the command does to the world besides the API. */
export interface PluginEvalIo {
  readonly stdout: { write(text: string): void };
  readonly stderr: { write(text: string): void };
  writeFile(path: string, content: string): Promise<void>;
  /** Waits `ms`, or resolves early when `signal` aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  /** Epoch milliseconds. */
  now(): number;
  /** Calls `handler` on each Ctrl+C until the returned function is called. */
  onInterrupt(handler: () => void): () => void;
  /** Ends the process at once: the second Ctrl+C. */
  exit(code: number): never;
}

/** Runs `stigmer plugin eval` and returns the code to exit with. */
export async function runPluginEval(
  client: Stigmer,
  org: string,
  target: PluginTarget,
  options: PluginEvalOptions,
  io: PluginEvalIo,
): Promise<EvalExit> {
  const quiet = options.json.kind !== "none";
  const plugin = await resolvePlugin(client, target.ref, org);
  const findings = plugin.status?.evals?.findings ?? [];
  for (const finding of findings) {
    io.stderr.write(`evals: ${finding.path === "" ? "" : `${finding.path}: `}${oneLine(finding.message)}\n`);
  }
  if (!quiet && options.maxCostDefaulted) {
    io.stderr.write(`Spending limit $${options.maxCostUsd.toFixed(2)}, the default; set --max-cost-usd to change it.\n`);
  }

  const started = await startEval(client, plugin, target, options, io.now());
  const id = started.metadata?.id ?? "";

  if (!options.wait) {
    if (quiet) {
      await writeDocument(started, options, io, false);
    } else {
      io.stdout.write(`${id}\n`);
      io.stderr.write(`Started. Follow it with: stigmer get plugin-eval ${id}\n`);
    }
    return EvalExit.Passed;
  }

  if (!quiet) {
    io.stderr.write(`Started ${id} on ${plugin.metadata?.name || target.ref}. Ctrl+C cancels it.\n`);
  }
  const { latest, interrupted } = await follow(client, started, quiet, io);

  const failed = latest.status?.phase === PluginEvalPhase.failed && !interrupted;
  if (quiet) {
    await writeDocument(latest, options, io, interrupted);
  } else if (!failed) {
    printReport(latest, interrupted, io);
  }
  if (failed) {
    const reason = oneLine(latest.status?.error ?? "");
    throw new CliExitError(reason === "" ? "the eval could not run" : `the eval could not run: ${reason}`, EvalExit.Failed);
  }
  return evalExitCode(latest, { interrupted, loadFindings: findings.length });
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
  nowMs: number,
): Promise<PluginEval> {
  try {
    return await client.plugineval.create({
      name: pluginEvalName(plugin.metadata?.name || plugin.metadata?.slug || target.ref, new Date(nowMs)),
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
    });
  } catch (error) {
    // The format exits 1 when a suite cannot start (no cases, a suite too
    // large, a version that does not exist); the CLI's usage code is 2,
    // which the format keeps for a partial run.
    const classified = classify(error);
    if (classified !== null && classified.exitCode === ExitCode.Usage) {
      throw new CliExitError(classified.message, EvalExit.Failed, classified.hints);
    }
    throw error;
  }
}

async function follow(
  client: Stigmer,
  started: PluginEval,
  quiet: boolean,
  io: PluginEvalIo,
): Promise<{ latest: PluginEval; interrupted: boolean }> {
  const id = started.metadata?.id ?? "";
  const interrupt = new AbortController();
  let interrupts = 0;
  const stopListening = io.onInterrupt(() => {
    interrupts += 1;
    if (interrupts > 1) io.exit(EvalExit.Interrupted);
    interrupt.abort();
  });
  const seen = new Set<string>();
  const report = (pluginEval: PluginEval): void => {
    for (const attempt of finishedTries(pluginEval)) {
      if (seen.has(attempt.key)) continue;
      seen.add(attempt.key);
      if (!quiet) io.stderr.write(`${attempt.line}\n`);
    }
  };

  let latest = started;
  try {
    while (!isSettled(latest) && !interrupt.signal.aborted) {
      await io.sleep(POLL_INTERVAL_MS, interrupt.signal);
      if (interrupt.signal.aborted) break;
      latest = await client.plugineval.get(id);
      report(latest);
    }
    if (!interrupt.signal.aborted) {
      return { latest, interrupted: false };
    }
    if (!quiet) io.stderr.write(`Cancelling ${id}…\n`);
    latest = await client.plugineval.cancel(id);
    latest = await client.plugineval.get(id).catch(() => latest);
    report(latest);
    return { latest, interrupted: true };
  } finally {
    stopListening();
  }
}

function printReport(pluginEval: PluginEval, interrupted: boolean, io: PluginEvalIo): void {
  const tables = renderEvalTables(pluginEval);
  const document = toResultDocument(pluginEval, { interrupted, nowMs: io.now() });
  const lines: string[] = [];
  if (tables !== "") lines.push(tables);
  lines.push(renderSummaryLine(pluginEval, document.durationSeconds));
  if (document.provisionalDelta && pluginEval.status?.aggregates?.meanDelta !== undefined) {
    lines.push(PROVISIONAL_NOTE);
  }
  const partial = partialLine(pluginEval, interrupted);
  if (partial !== "") lines.push(partial);
  io.stdout.write(`\n${lines.join("\n")}\n`);
  const notRun = renderNotRun(pluginEval);
  if (notRun !== "") io.stdout.write(`\n${notRun}`);
}

async function writeDocument(
  pluginEval: PluginEval,
  options: PluginEvalOptions,
  io: PluginEvalIo,
  interrupted: boolean,
): Promise<void> {
  const document = `${JSON.stringify(toResultDocument(pluginEval, { interrupted, nowMs: io.now() }), null, 2)}\n`;
  if (options.json.kind === "file") {
    await io.writeFile(options.json.path, document);
  } else {
    io.stdout.write(document);
  }
}

/** A server-relayed sentence as one terminal line. */
function oneLine(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
}
