// `plugin eval` dispatch: resolve the plugin, start its eval, follow it to
// the end, and print or write the result.
//
// The eval runs on the server, so the command only starts it and reads it
// again every two seconds; closing the terminal leaves it running, and
// `--no-wait` returns at once with its id. Ctrl+C is the format's interrupt:
// the command cancels the eval (tries in flight stop), prints the results
// of the tries that finished, and exits 130; a second Ctrl+C exits at once,
// saying how to cancel. An eval that finished before the cancel took hold
// (Ctrl+C landed during the last read, or the cancel found it done) is
// reported as finished, with its own exit code. Every read and the cancel
// race Ctrl+C and a 30-second deadline: the transport has no call timeout,
// and a half-open connection would otherwise swallow the interrupt. A read
// past its deadline counts as a failed read.
// A read that fails is tried again with backoff for about a minute; past
// that the command cancels the eval rather than leave it spending unwatched,
// prints or writes what it had, and exits 1. When that cancel, or Ctrl+C's,
// cannot reach the server either, the eval may still be running: the report
// says so in place of "Cancelled", `--json` adds Stigmer's
// `stillRunning: true`, and the error names `stigmer plugin eval cancel`;
// the exit code stays the one the stop earned (1 lost, 130 interrupted).
//
// The eval is sent with no name: the server names it by its id, which is
// short and unique, and a person tells evals apart by plugin and start time.
//
// Streams follow the CLI's law: progress lines, notices and the suite's
// load findings go to stderr, the table and the summary to stdout. A load
// finding prints as the server relays it, on one line: its message already
// starts with the file's path. Under `--json` the run is quiet, as in the
// format: the result document goes to stdout, or to the `.json` path given,
// with the load findings in Stigmer's `findings` field beside the format's,
// and nothing else is printed but an error. Any refusal of the eval's start,
// from create or from reading the plugin (not found, not permitted, a
// precondition, an invalid argument, an organization not set), exits 1, the
// format's "a run couldn't be started"; the CLI's own codes for those (2, 4,
// 5) would read as the format's partial run or as codes it does not have.
// Only a sign-in or connection failure keeps the CLI's code: the eval never
// reached the server's judgement.
//
// Every effect is injected (`PluginEvalIo`), so the follow loop, the
// interrupt and the outputs are unit-tested without a server or a clock.

import { Code } from "@connectrpc/connect";
import type { Plugin } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import type { PluginWarning } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/status_pb";
import type { PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalPartialReason, PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { toResultDocument, type PluginEvalResultDocument, type Stigmer } from "@stigmer/sdk";
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

/** How long one call to the server may go unanswered before it counts as failed. */
export const CALL_DEADLINE_MS = 30_000;

/** Why a call past {@link CALL_DEADLINE_MS} failed, as the command says it. */
const NO_ANSWER = `no answer in ${CALL_DEADLINE_MS / 1_000}s`;

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

/** Everything the command does to the world besides the API. */
export interface PluginEvalIo {
  readonly stdout: { write(text: string): void };
  readonly stderr: { write(text: string): void };
  writeFile(path: string, content: string): Promise<void>;
  /** Waits `ms`, or resolves early when `signal` aborts. */
  sleep(ms: number, signal: AbortSignal): Promise<void>;
  /** A call's deadline: resolves after `ms`, or early when `signal` aborts. Apart from `sleep`, which paces the reads. */
  timeout(ms: number, signal: AbortSignal): Promise<void>;
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
  if (!quiet) {
    for (const finding of findings) io.stderr.write(`evals: ${oneLine(finding.message)}\n`);
  }
  if (!quiet && options.maxCostDefaulted) {
    io.stderr.write(`Spending limit $${options.maxCostUsd.toFixed(2)}, the default; set --max-cost-usd to change it.\n`);
  }

  const started = await startEval(client, plugin, target, options);
  const id = started.metadata?.id ?? "";

  if (!options.wait) {
    if (quiet) {
      await writeDocument(started, findings, options, io, false, false);
    } else {
      io.stdout.write(`${id}\n`);
      io.stderr.write(`Started. Follow it with: stigmer get plugin-eval ${id}\n`);
    }
    return EvalExit.Passed;
  }

  if (!quiet) {
    io.stderr.write(`Started ${id} on ${plugin.metadata?.name || target.ref}. Ctrl+C cancels it.\n`);
  }
  const { latest, interrupted, lost, cancelFailure } = await follow(client, started, quiet, io);

  if (lost !== undefined || cancelFailure !== undefined) {
    const stillRunning =
      cancelFailure === undefined
        ? ""
        : `${lost === undefined ? "Could not cancel the eval" : "Lost track of the eval"}; it may still be running: cancel it with \`stigmer plugin eval cancel ${id}\``;
    if (quiet) {
      await writeDocument(latest, findings, options, io, true, stillRunning !== "");
    } else {
      printReport(latest, true, io, stillRunning);
    }
    const hint = `cancel it with: stigmer plugin eval cancel ${id}`;
    if (lost === undefined) {
      throw new CliExitError(`could not cancel eval ${id} (${cancelFailure}); ${hint}`, EvalExit.Interrupted);
    }
    throw new CliExitError(
      cancelFailure === undefined
        ? `lost track of eval ${id} (${lost}), so it was cancelled`
        : `lost track of eval ${id} (${lost}), and could not cancel it; ${hint}`,
      EvalExit.Failed,
    );
  }
  const failed = latest.status?.phase === PluginEvalPhase.failed && !interrupted;
  if (quiet) {
    await writeDocument(latest, findings, options, io, interrupted, false);
  } else if (!failed) {
    printReport(latest, interrupted, io, "");
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
 * Rethrows a refusal of the eval's start as exit 1: the format exits 1 when
 * a suite cannot start (no cases, a suite too large, a plugin or version
 * that does not exist, a plugin the caller may not evaluate, no
 * organization, a reference the server refuses). The CLI's usage, not-found
 * and permission codes (2, 5, 4) are not the format's: 2 is its partial run.
 * A sign-in or connection failure, or anything else, passes on unchanged.
 */
function asStartRefusal(error: unknown): never {
  const classified = classify(error);
  if (classified !== null && isStartRefusal(classified.exitCode, classified.code)) {
    throw new CliExitError(classified.message, EvalExit.Failed, classified.hints);
  }
  throw error;
}

function isStartRefusal(exitCode: number, code: number | undefined): boolean {
  return exitCode === ExitCode.Usage || exitCode === ExitCode.NotFound || code === Code.PermissionDenied;
}

/** How following the eval ended. */
interface Followed {
  readonly latest: PluginEval;
  readonly interrupted: boolean;
  /** Why the reads were given up, when they were. */
  readonly lost?: string;
  /** Why the cancel failed, when the command tried one and it did. */
  readonly cancelFailure?: string;
}

type Read = { readonly kind: "read"; readonly pluginEval: PluginEval } | { readonly kind: "lost"; readonly reason: string } | { readonly kind: "aborted" };

/** A call raced against Ctrl+C and its deadline. */
type Bounded<T> = { readonly kind: "answer"; readonly value: T } | { readonly kind: "no-answer" } | { readonly kind: "aborted" };

/**
 * Waits for `call` until it answers, `signal` aborts or
 * {@link CALL_DEADLINE_MS} passes, whichever is first; a call that fails
 * rejects. The deadline's timer is cleared once the race is decided.
 */
async function bounded<T>(call: Promise<T>, signal: AbortSignal | undefined, io: PluginEvalIo): Promise<Bounded<T>> {
  const decided = new AbortController();
  const deadline = io.timeout(CALL_DEADLINE_MS, signal === undefined ? decided.signal : AbortSignal.any([signal, decided.signal]));
  try {
    return await Promise.race([
      call.then((value): Bounded<T> => ({ kind: "answer", value })),
      deadline.then((): Bounded<T> => (signal?.aborted === true ? { kind: "aborted" } : { kind: "no-answer" })),
    ]);
  } finally {
    decided.abort();
  }
}

/** Reads the eval, trying again with backoff while the read fails or goes unanswered. */
async function readEval(client: Stigmer, id: string, quiet: boolean, signal: AbortSignal, io: PluginEvalIo): Promise<Read> {
  for (let failures = 0; ; failures += 1) {
    let reason: string;
    try {
      const read = await bounded(client.plugineval.get(id), signal, io);
      if (read.kind === "aborted") return read;
      if (read.kind === "answer") return { kind: "read", pluginEval: read.value };
      reason = NO_ANSWER;
    } catch (error) {
      reason = oneLine(classify(error)?.message ?? "") || "the read failed";
    }
    const wait = POLL_RETRY_WAITS_MS[failures];
    if (wait === undefined) return { kind: "lost", reason };
    if (!quiet) io.stderr.write(`Could not read ${id} (${reason}); trying again in ${wait / 1_000}s.\n`);
    await io.sleep(wait, signal);
    if (signal.aborted) return { kind: "aborted" };
  }
}

async function follow(
  client: Stigmer,
  started: PluginEval,
  quiet: boolean,
  io: PluginEvalIo,
): Promise<Followed> {
  const id = started.metadata?.id ?? "";
  const interrupt = new AbortController();
  let interrupts = 0;
  const stopListening = io.onInterrupt(() => {
    interrupts += 1;
    if (interrupts > 1) {
      io.stderr.write(`Stopped following ${id}; if it is still running, cancel it with: stigmer plugin eval cancel ${id}\n`);
      io.exit(EvalExit.Interrupted);
    }
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
        const cancel = await cancelAndRead(client, id, latest, io);
        report(cancel.latest);
        return { ...cancel, interrupted: true, lost: read.reason };
      }
      latest = read.pluginEval;
      report(latest);
    }
    // Ctrl+C during the read that found the eval finished cancels nothing.
    if (!interrupt.signal.aborted || isSettled(latest)) {
      return { latest, interrupted: false };
    }
    if (!quiet) io.stderr.write(`Cancelling ${id}…\n`);
    const cancel = await cancelAndRead(client, id, latest, io);
    report(cancel.latest);
    return { ...cancel, interrupted: !finishedOnItsOwn(cancel.latest) };
  } finally {
    stopListening();
  }
}

/** Whether the eval ended without being cancelled: it finished before the cancel took hold. */
function finishedOnItsOwn(pluginEval: PluginEval): boolean {
  return isSettled(pluginEval) && pluginEval.status?.partialReason !== PluginEvalPartialReason.cancelled;
}

/**
 * Cancels the eval and reads it once more, each call within its deadline.
 * The cancel's own answer stands when the read fails; when the cancel
 * fails or goes unanswered, `last` stands with the reason.
 */
async function cancelAndRead(
  client: Stigmer,
  id: string,
  last: PluginEval,
  io: PluginEvalIo,
): Promise<{ readonly latest: PluginEval; readonly cancelFailure?: string }> {
  let cancelled: PluginEval;
  try {
    const cancel = await bounded(client.plugineval.cancel(id), undefined, io);
    if (cancel.kind !== "answer") return { latest: last, cancelFailure: NO_ANSWER };
    cancelled = cancel.value;
  } catch (error) {
    return { latest: last, cancelFailure: oneLine(classify(error)?.message ?? "") || "the cancel failed" };
  }
  const read = await bounded(client.plugineval.get(id), undefined, io).catch(() => undefined);
  return { latest: read?.kind === "answer" ? read.value : cancelled };
}

/**
 * Prints the tables and the summary. `stillRunning`, when not empty, is the
 * line said in place of why the eval stopped: it may not have.
 */
function printReport(pluginEval: PluginEval, interrupted: boolean, io: PluginEvalIo, stillRunning: string): void {
  const tables = renderEvalTables(pluginEval);
  const document = toResultDocument(pluginEval, { interrupted, nowMs: io.now() });
  const lines: string[] = [];
  if (tables !== "") lines.push(tables);
  lines.push(renderSummaryLine(pluginEval, document.durationSeconds));
  if (document.provisionalDelta && pluginEval.status?.aggregates?.meanDelta !== undefined) {
    lines.push(PROVISIONAL_NOTE);
  }
  const partial = stillRunning === "" ? partialLine(pluginEval, interrupted) : stillRunning;
  if (partial !== "") lines.push(partial);
  io.stdout.write(`\n${lines.join("\n")}\n`);
  const notRun = renderNotRun(pluginEval);
  if (notRun !== "") io.stdout.write(`\n${notRun}`);
}

async function writeDocument(
  pluginEval: PluginEval,
  findings: readonly PluginWarning[],
  options: PluginEvalOptions,
  io: PluginEvalIo,
  interrupted: boolean,
  stillRunning: boolean,
): Promise<void> {
  const result: CliResultDocument = {
    ...toResultDocument(pluginEval, { interrupted, nowMs: io.now() }),
    findings: findings.map((finding) => ({ kind: finding.kind, path: finding.path, message: finding.message })),
    ...(stillRunning && { stillRunning: true as const }),
  };
  const document = `${JSON.stringify(result, null, 2)}\n`;
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
