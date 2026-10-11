// The eval loop both eval commands share: start the eval, follow it to its
// end, and print or write the result. `plugin eval` (run.ts) and `agent
// eval` (resources/agent-eval/run.ts) each resolve what they evaluate and
// hand this module an `EvalRun`: how to create, read and cancel their kind,
// and how to print and write it. The rules below are the same for both.
//
// The eval runs on the server, so the command only starts it and reads it
// again every two seconds; closing the terminal leaves it running, and
// `--no-wait` returns at once with its id. Ctrl+C is the format's interrupt:
// the command cancels the eval (tries in flight stop), prints the results
// of the tries that finished, and exits 130; a second Ctrl+C exits at once,
// saying how to cancel. The command listens from just before create: a
// Ctrl+C while create is in flight (up to its deadline) takes effect once
// create answers, so the eval it started is cancelled, its id printed, and
// the exit is 130, under `--no-wait` too. An eval that finished before the
// cancel took hold (Ctrl+C landed during the last read, or the cancel
// found it done) is reported as finished, with its own exit code. Every
// read and the cancel race Ctrl+C and a 30-second deadline: the transport
// has no call timeout, and a half-open connection would otherwise swallow
// the interrupt. A read past its deadline counts as a failed read.
// A read that fails is tried again with backoff for about a minute; past
// that the command cancels the eval rather than leave it spending unwatched,
// prints or writes what it had, and exits 1. When that cancel, or Ctrl+C's,
// cannot reach the server either, the eval may still be running: the report
// says so in place of "Cancelled", `--json` adds Stigmer's
// `stillRunning: true`, and the error names the kind's cancel command;
// the exit code stays the one the stop earned (1 lost, 130 interrupted).
//
// Streams follow the CLI's law: progress lines and notices go to stderr,
// the table and the summary to stdout. Under `--json` the run is quiet, as
// in the format: the result document goes to stdout, or to the `.json`
// path given, and nothing else is printed but an error. Any refusal of the
// eval's start (not found, not permitted, a precondition, an invalid
// argument, an organization not set) exits 1, the format's "a run couldn't
// be started"; the CLI's own codes for those (2, 4, 5) would read as the
// format's partial run or as codes it does not have. Only a sign-in or
// connection failure keeps the CLI's code: the eval never reached the
// server's judgement. A kind's own reads before the start pass through
// `asStartRefusal` for the same reason.
//
// Every effect is injected (`EvalIo`), so the follow loop, the interrupt
// and the outputs are unit-tested without a server or a clock.

import { Code } from "@connectrpc/connect";
import { PluginEvalPartialReason, PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { CliExitError, ExitCode, classify } from "../../errors/index.js";
import type { JsonTarget } from "./options.js";
import { EvalExit, isSettled, oneLine, type EvalProgress, type FinishedTry } from "./report.js";

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

/** Everything the command does to the world besides the API. */
export interface EvalIo {
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

/** What the loop reads of an eval of either kind. */
export interface FollowedEval {
  readonly metadata?: { readonly id: string };
  readonly status?: EvalProgress & { readonly error: string };
}

/** The options the loop reads. */
export interface FollowOptions {
  readonly json: JsonTarget;
  readonly wait: boolean;
  readonly maxCostUsd: number;
  readonly maxCostDefaulted: boolean;
}

/** One eval kind's part in the loop: its calls, its words and its views. */
export interface EvalRun<E extends FollowedEval> {
  /** The command that cancels one by id, as `stigmer plugin eval cancel`. */
  readonly cancelCommand: string;
  /** The command that reads one by id, as `stigmer get plugin-eval`. */
  readonly getCommand: string;
  /** Where to cancel an eval whose start went unanswered, after "if the eval started, ". */
  readonly cancelElsewhere: string;
  /** What the eval runs on, for `Started <id> on <on>.` */
  readonly on: string;
  /** Creates the eval; a refusal rejects as {@link asStartRefusal} has it. */
  create(): Promise<E>;
  get(id: string): Promise<E>;
  cancel(id: string): Promise<E>;
  /** Every finished try's progress line, keyed so each prints once. */
  finishedTries(evaluation: E): readonly FinishedTry[];
  /**
   * The text for stdout: tables, summary, why it stopped. `stillRunning`,
   * when not empty, is said in place of why the eval stopped: it may not have.
   */
  report(evaluation: E, interrupted: boolean, stillRunning: string): string;
  /** The result document, with `stillRunning: true` when that is so. */
  document(evaluation: E, interrupted: boolean, stillRunning: boolean): object;
  /** The exit code a finished (or cancelled) eval earns. */
  exitCode(evaluation: E, interrupted: boolean): EvalExit;
}

/** Starts the eval and follows it to its end; returns the code to exit with. */
export async function runEval<E extends FollowedEval>(run: EvalRun<E>, options: FollowOptions, io: EvalIo): Promise<EvalExit> {
  const quiet = options.json.kind !== "none";
  if (!quiet && options.maxCostDefaulted) {
    io.stderr.write(`Spending limit $${options.maxCostUsd.toFixed(2)}, the default; set --max-cost-usd to change it.\n`);
  }

  // Listening starts before create: a Ctrl+C while create is in flight
  // takes effect once it answers, so the eval it started is cancelled.
  const interrupt = new AbortController();
  let id = "";
  let interrupts = 0;
  const stopListening = io.onInterrupt(() => {
    interrupts += 1;
    if (interrupts > 1) {
      io.stderr.write(
        id === ""
          ? `Stopped before the server answered the start; if the eval started, ${run.cancelElsewhere}\n`
          : `Stopped following ${id}; if it is still running, cancel it with: ${run.cancelCommand} ${id}\n`,
      );
      io.exit(EvalExit.Interrupted);
    }
    interrupt.abort();
  });
  try {
    const started = await run.create();
    id = started.metadata?.id ?? "";
    return await followStarted(run, options, io, started, interrupt.signal);
  } finally {
    stopListening();
  }
}

/**
 * Rethrows a refusal of the eval's start as exit 1: the format exits 1 when
 * a suite cannot start (no cases, a suite too large, a plugin, agent or
 * version that does not exist, one the caller may not evaluate, no
 * organization, a reference the server refuses). The CLI's usage, not-found
 * and permission codes (2, 5, 4) are not the format's: 2 is its partial run.
 * A sign-in or connection failure, or anything else, passes on unchanged.
 */
export function asStartRefusal(error: unknown): never {
  const classified = classify(error);
  if (classified !== null && isStartRefusal(classified.exitCode, classified.code)) {
    throw new CliExitError(classified.message, EvalExit.Failed, classified.hints);
  }
  throw error;
}

function isStartRefusal(exitCode: number, code: number | undefined): boolean {
  return exitCode === ExitCode.Usage || exitCode === ExitCode.NotFound || code === Code.PermissionDenied;
}

/** The command after create answered: return under `--no-wait`, or follow the eval to its end. */
async function followStarted<E extends FollowedEval>(
  run: EvalRun<E>,
  options: FollowOptions,
  io: EvalIo,
  started: E,
  interrupt: AbortSignal,
): Promise<EvalExit> {
  const quiet = options.json.kind !== "none";
  const id = started.metadata?.id ?? "";

  // A Ctrl+C during create cancels the eval under `--no-wait` too.
  if (!options.wait && !interrupt.aborted) {
    if (quiet) {
      await writeDocument(run.document(started, false, false), options.json, io);
    } else {
      io.stdout.write(`${id}\n`);
      io.stderr.write(`Started. Follow it with: ${run.getCommand} ${id}\n`);
    }
    return EvalExit.Passed;
  }

  if (!quiet) {
    io.stderr.write(interrupt.aborted ? `Started ${id} on ${run.on}.\n` : `Started ${id} on ${run.on}. Ctrl+C cancels it.\n`);
  }
  const { latest, interrupted, lost, cancelFailure } = await follow(run, started, quiet, interrupt, io);

  if (lost !== undefined || cancelFailure !== undefined) {
    const stillRunning =
      cancelFailure === undefined
        ? ""
        : `${lost === undefined ? "Could not cancel the eval" : "Lost track of the eval"}; it may still be running: cancel it with \`${run.cancelCommand} ${id}\``;
    if (quiet) {
      await writeDocument(run.document(latest, true, stillRunning !== ""), options.json, io);
    } else {
      io.stdout.write(run.report(latest, true, stillRunning));
    }
    const hint = `cancel it with: ${run.cancelCommand} ${id}`;
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
    await writeDocument(run.document(latest, interrupted, false), options.json, io);
  } else if (!failed) {
    io.stdout.write(run.report(latest, interrupted, ""));
  }
  if (failed) {
    const reason = oneLine(latest.status?.error ?? "");
    throw new CliExitError(reason === "" ? "the eval could not run" : `the eval could not run: ${reason}`, EvalExit.Failed);
  }
  return run.exitCode(latest, interrupted);
}

/** How following the eval ended. */
interface Followed<E> {
  readonly latest: E;
  readonly interrupted: boolean;
  /** Why the reads were given up, when they were. */
  readonly lost?: string;
  /** Why the cancel failed, when the command tried one and it did. */
  readonly cancelFailure?: string;
}

type Read<E> = { readonly kind: "read"; readonly evaluation: E } | { readonly kind: "lost"; readonly reason: string } | { readonly kind: "aborted" };

/** A call raced against Ctrl+C and its deadline. */
type Bounded<T> = { readonly kind: "answer"; readonly value: T } | { readonly kind: "no-answer" } | { readonly kind: "aborted" };

/**
 * Waits for `call` until it answers, `signal` aborts or
 * {@link CALL_DEADLINE_MS} passes, whichever is first; a call that fails
 * rejects. The deadline's timer is cleared once the race is decided.
 */
async function bounded<T>(call: Promise<T>, signal: AbortSignal | undefined, io: EvalIo): Promise<Bounded<T>> {
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
async function readEval<E extends FollowedEval>(
  run: EvalRun<E>,
  id: string,
  quiet: boolean,
  signal: AbortSignal,
  io: EvalIo,
): Promise<Read<E>> {
  for (let failures = 0; ; failures += 1) {
    let reason: string;
    try {
      const read = await bounded(run.get(id), signal, io);
      if (read.kind === "aborted") return read;
      if (read.kind === "answer") return { kind: "read", evaluation: read.value };
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

/** Follows the eval until it settles, its reads are lost, or `interrupt` (Ctrl+C) aborts and the eval is cancelled. */
async function follow<E extends FollowedEval>(
  run: EvalRun<E>,
  started: E,
  quiet: boolean,
  interrupt: AbortSignal,
  io: EvalIo,
): Promise<Followed<E>> {
  const id = started.metadata?.id ?? "";
  const seen = new Set<string>();
  const report = (evaluation: E): void => {
    for (const attempt of run.finishedTries(evaluation)) {
      if (seen.has(attempt.key)) continue;
      seen.add(attempt.key);
      if (!quiet) io.stderr.write(`${attempt.line}\n`);
    }
  };

  let latest = started;
  while (!isSettled(latest) && !interrupt.aborted) {
    await io.sleep(POLL_INTERVAL_MS, interrupt);
    if (interrupt.aborted) break;
    const read = await readEval(run, id, quiet, interrupt, io);
    if (read.kind === "aborted") break;
    if (read.kind === "lost") {
      // The eval would go on spending with no one watching: stop it. One
      // that finished while the reads failed is reported as finished.
      const cancel = await cancelAndRead(run, id, latest, io);
      report(cancel.latest);
      if (finishedOnItsOwn(cancel.latest)) return { latest: cancel.latest, interrupted: false };
      return { ...cancel, interrupted: true, lost: read.reason };
    }
    latest = read.evaluation;
    report(latest);
  }
  // Ctrl+C during the read that found the eval finished cancels nothing.
  if (!interrupt.aborted || isSettled(latest)) {
    return { latest, interrupted: false };
  }
  if (!quiet) io.stderr.write(`Cancelling ${id}…\n`);
  const cancel = await cancelAndRead(run, id, latest, io);
  report(cancel.latest);
  return { ...cancel, interrupted: !finishedOnItsOwn(cancel.latest) };
}

/** Whether the eval ended without being cancelled: it finished before the cancel took hold. */
function finishedOnItsOwn(evaluation: FollowedEval): boolean {
  return isSettled(evaluation) && evaluation.status?.partialReason !== PluginEvalPartialReason.cancelled;
}

/**
 * Cancels the eval and reads it once more, each call within its deadline.
 * The cancel's own answer stands when the read fails; when the cancel
 * fails or goes unanswered, `last` stands with the reason.
 */
async function cancelAndRead<E extends FollowedEval>(
  run: EvalRun<E>,
  id: string,
  last: E,
  io: EvalIo,
): Promise<{ readonly latest: E; readonly cancelFailure?: string }> {
  let cancelled: E;
  try {
    const cancel = await bounded(run.cancel(id), undefined, io);
    if (cancel.kind !== "answer") return { latest: last, cancelFailure: NO_ANSWER };
    cancelled = cancel.value;
  } catch (error) {
    return { latest: last, cancelFailure: oneLine(classify(error)?.message ?? "") || "the cancel failed" };
  }
  const read = await bounded(run.get(id), undefined, io).catch(() => undefined);
  return { latest: read?.kind === "answer" ? read.value : cancelled };
}

async function writeDocument(document: object, json: JsonTarget, io: EvalIo): Promise<void> {
  const text = `${JSON.stringify(document, null, 2)}\n`;
  if (json.kind === "file") {
    await io.writeFile(json.path, text);
  } else {
    io.stdout.write(text);
  }
}
