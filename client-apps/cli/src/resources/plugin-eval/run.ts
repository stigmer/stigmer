// `plugin eval` dispatch: resolve the plugin, start its eval, follow it to
// the end, and print or write the result.
//
// The eval runs on the server, so the command only starts it and reads it
// again every two seconds; closing the terminal leaves it running, and
// `--no-wait` returns at once with its id. Ctrl+C is the format's interrupt:
// the command cancels the eval (tries in flight stop), prints the results
// of the tries that finished, and exits 130; a second Ctrl+C exits at once.
// A read that fails is tried again with backoff for about a minute; past
// that the command cancels the eval rather than leave it spending unwatched,
// prints or writes what it had, and exits 1.
//
// The eval is sent with no name: the server names it by its id, which is
// short and unique, and a person tells evals apart by plugin and start time.
//
// Streams follow the CLI's law: progress lines, notices and the suite's
// load findings go to stderr, the table and the summary to stdout. Under
// `--json` the run is quiet, as in the format: the result document goes to
// stdout, or to the `.json` path given, and nothing else is printed but an
// error. A refusal from create or from reading the plugin (an organization
// not set, an invalid reference) exits 1, the format's "a run couldn't be
// started", unless it is the CLI's own sign-in or connection failure; the
// CLI's usage code 2 is the format's partial run.
//
// Every effect is injected (`PluginEvalIo`), so the follow loop, the
// interrupt and the outputs are unit-tested without a server or a clock.

import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { toResultDocument, type Stigmer } from "@stigmer/sdk";
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

/**
 * The waits between tries of a read that failed, about a minute in all;
 * when the last one fails too, the command gives the eval up.
 */
const POLL_RETRY_WAITS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 15_000, 15_000] as const;

/** How long a failing read is tried again before the command gives the eval up. */
export const POLL_RETRY_BUDGET_MS = POLL_RETRY_WAITS_MS.reduce((sum, ms) => sum + ms, 0);

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
  const plugin = await resolvePlugin(client, target.ref, org).catch(asStartRefusal);
  const findings = plugin.status?.evals?.findings ?? [];
  for (const finding of findings) {
    io.stderr.write(`evals: ${finding.path === "" ? "" : `${finding.path}: `}${oneLine(finding.message)}\n`);
  }
  if (!quiet && options.maxCostDefaulted) {
    io.stderr.write(`Spending limit $${options.maxCostUsd.toFixed(2)}, the default; set --max-cost-usd to change it.\n`);
  }

  const started = await startEval(client, plugin, target, options);
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
  const { latest, interrupted, lost } = await follow(client, started, quiet, io);

  if (lost !== undefined) {
    if (quiet) {
      await writeDocument(latest, options, io, true);
    } else {
      printReport(latest, true, io);
    }
    throw new CliExitError(
      lost.cancelled
        ? `lost track of eval ${id} (${lost.reason}), so it was cancelled`
        : `lost track of eval ${id} (${lost.reason}), and could not cancel it; cancel it with: stigmer plugin eval cancel ${id}`,
      EvalExit.Failed,
    );
  }
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
    });
  } catch (error) {
    return asStartRefusal(error);
  }
}

/**
 * Rethrows a usage refusal as exit 1: the format exits 1 when a suite
 * cannot start (no cases, a suite too large, a version that does not exist,
 * no organization, a reference the server refuses); the CLI's usage code is
 * 2, which the format keeps for a partial run. Anything else passes on.
 */
function asStartRefusal(error: unknown): never {
  const classified = classify(error);
  if (classified !== null && classified.exitCode === ExitCode.Usage) {
    throw new CliExitError(classified.message, EvalExit.Failed, classified.hints);
  }
  throw error;
}

/** Why the command stopped following the eval, and whether its cancel went through. */
interface Lost {
  readonly reason: string;
  readonly cancelled: boolean;
}

type Read = { readonly kind: "read"; readonly pluginEval: PluginEval } | { readonly kind: "lost"; readonly reason: string } | { readonly kind: "aborted" };

/** Reads the eval, trying again with backoff while the read fails. */
async function readEval(client: Stigmer, id: string, quiet: boolean, signal: AbortSignal, io: PluginEvalIo): Promise<Read> {
  for (let failures = 0; ; failures += 1) {
    try {
      return { kind: "read", pluginEval: await client.plugineval.get(id) };
    } catch (error) {
      const reason = oneLine(classify(error)?.message ?? "") || "the read failed";
      const wait = POLL_RETRY_WAITS_MS[failures];
      if (wait === undefined) return { kind: "lost", reason };
      if (!quiet) io.stderr.write(`Could not read ${id} (${reason}); trying again in ${wait / 1_000}s.\n`);
      await io.sleep(wait, signal);
      if (signal.aborted) return { kind: "aborted" };
    }
  }
}

async function follow(
  client: Stigmer,
  started: PluginEval,
  quiet: boolean,
  io: PluginEvalIo,
): Promise<{ latest: PluginEval; interrupted: boolean; lost?: Lost }> {
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
      const read = await readEval(client, id, quiet, interrupt.signal, io);
      if (read.kind === "aborted") break;
      if (read.kind === "lost") {
        // The eval would go on spending with no one watching: stop it.
        const cancelled = await client.plugineval.cancel(id).catch(() => undefined);
        if (cancelled !== undefined) {
          latest = await client.plugineval.get(id).catch(() => cancelled);
          report(latest);
        }
        return { latest, interrupted: true, lost: { reason: read.reason, cancelled: cancelled !== undefined } };
      }
      latest = read.pluginEval;
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
