// The loop `eval run` follows an eval run with: start it, follow it to its
// end, and print or write the result. run.ts resolves what the eval run is
// about and hands this module a `FollowedRun`: how to create it, and how to
// print and write it; the reads and the cancel are the kind's own calls.
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
// `stillRunning: true`, and the error names `stigmer eval cancel`;
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
// server's judgement. The reads of what the eval run is about, before the
// start, pass through `asStartRefusal` for the same reason.
//
// Every effect is injected (`EvalIo`), so the follow loop, the interrupt
// and the outputs are unit-tested without a server or a clock.

import { Code } from "@connectrpc/connect";
import type { EvalRun } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunPartialReason, EvalRunPhase } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import type { Stigmer } from "@stigmer/sdk";
import { CliExitError, ExitCode, classify } from "../../errors/index.js";
import type { JsonTarget } from "./options.js";
import { EvalExit, finishedTries, isSettled, oneLine, type FinishedTry } from "./report.js";

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

/** The options the loop reads. */
export interface FollowOptions {
  readonly json: JsonTarget;
  readonly wait: boolean;
  readonly maxCostUsd: number;
  readonly maxCostDefaulted: boolean;
}

/** The command that cancels an eval run by id. */
const CANCEL_COMMAND = "stigmer eval cancel";

/** The command that reads an eval run by id. */
const GET_COMMAND = "stigmer get eval-run";

/** What an eval run is about, and how to start it and show it. */
export interface FollowedRun {
  /** Where to cancel an eval run whose start went unanswered, after "if the eval run started, ". */
  readonly cancelElsewhere: string;
  /** What the eval run runs on, for `Started <id> on <on>.` */
  readonly on: string;
  /** Creates the eval run; a refusal rejects as {@link asStartRefusal} has it. */
  create(): Promise<EvalRun>;
  /**
   * The text for stdout: tables, summary, why it stopped. `stillRunning`,
   * when not empty, is said in place of why the eval run stopped: it may not have.
   */
  report(evalRun: EvalRun, interrupted: boolean, stillRunning: string): string;
  /** The result document, with `stillRunning: true` when that is so. */
  document(evalRun: EvalRun, interrupted: boolean, stillRunning: boolean): object;
  /** The exit code a finished (or cancelled) eval run earns. */
  exitCode(evalRun: EvalRun, interrupted: boolean): EvalExit;
}

/** A run with the kind's calls, as the loop reads it. */
interface Loop extends FollowedRun {
  get(id: string): Promise<EvalRun>;
  cancel(id: string): Promise<EvalRun>;
  finishedTries(evalRun: EvalRun): readonly FinishedTry[];
}

/** Starts the eval run and follows it to its end; returns the code to exit with. */
export async function runEval(
  client: Stigmer,
  followed: FollowedRun,
  options: FollowOptions,
  io: EvalIo,
): Promise<EvalExit> {
  const run: Loop = {
    ...followed,
    get: (id) => client.evalrun.get(id),
    cancel: (id) => client.evalrun.cancel(id),
    finishedTries,
  };
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
          ? `Stopped before the server answered the start; if the eval run started, ${run.cancelElsewhere}\n`
          : `Stopped following ${id}; if it is still running, cancel it with: ${CANCEL_COMMAND} ${id}\n`,
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
async function followStarted(
  run: Loop,
  options: FollowOptions,
  io: EvalIo,
  started: EvalRun,
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
      io.stderr.write(`Started. Follow it with: ${GET_COMMAND} ${id}\n`);
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
        : `${lost === undefined ? "Could not cancel the eval run" : "Lost track of the eval run"}; it may still be running: cancel it with \`${CANCEL_COMMAND} ${id}\``;
    if (quiet) {
      await writeDocument(run.document(latest, true, stillRunning !== ""), options.json, io);
    } else {
      io.stdout.write(run.report(latest, true, stillRunning));
    }
    const hint = `cancel it with: ${CANCEL_COMMAND} ${id}`;
    if (lost === undefined) {
      throw new CliExitError(`could not cancel eval run ${id} (${cancelFailure}); ${hint}`, EvalExit.Interrupted);
    }
    throw new CliExitError(
      cancelFailure === undefined
        ? `lost track of eval run ${id} (${lost}), so it was cancelled`
        : `lost track of eval run ${id} (${lost}), and could not cancel it; ${hint}`,
      EvalExit.Failed,
    );
  }
  const failed = latest.status?.phase === EvalRunPhase.failed && !interrupted;
  if (quiet) {
    await writeDocument(run.document(latest, interrupted, false), options.json, io);
  } else if (!failed) {
    io.stdout.write(run.report(latest, interrupted, ""));
  }
  if (failed) {
    const reason = oneLine(latest.status?.error ?? "");
    throw new CliExitError(reason === "" ? "the eval run could not run" : `the eval run could not run: ${reason}`, EvalExit.Failed);
  }
  return run.exitCode(latest, interrupted);
}

/** How following the eval ended. */
interface Followed {
  readonly latest: EvalRun;
  readonly interrupted: boolean;
  /** Why the reads were given up, when they were. */
  readonly lost?: string;
  /** Why the cancel failed, when the command tried one and it did. */
  readonly cancelFailure?: string;
}

type Read = { readonly kind: "read"; readonly evaluation: EvalRun } | { readonly kind: "lost"; readonly reason: string } | { readonly kind: "aborted" };

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
async function readEval(
  run: Loop,
  id: string,
  quiet: boolean,
  signal: AbortSignal,
  io: EvalIo,
): Promise<Read> {
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
async function follow(
  run: Loop,
  started: EvalRun,
  quiet: boolean,
  interrupt: AbortSignal,
  io: EvalIo,
): Promise<Followed> {
  const id = started.metadata?.id ?? "";
  const seen = new Set<string>();
  const report = (evaluation: EvalRun): void => {
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
function finishedOnItsOwn(evaluation: EvalRun): boolean {
  return isSettled(evaluation) && evaluation.status?.partialReason !== EvalRunPartialReason.cancelled;
}

/**
 * Cancels the eval and reads it once more, each call within its deadline.
 * The cancel's own answer stands when the read fails; when the cancel
 * fails or goes unanswered, `last` stands with the reason.
 */
async function cancelAndRead(
  run: Loop,
  id: string,
  last: EvalRun,
  io: EvalIo,
): Promise<{ readonly latest: EvalRun; readonly cancelFailure?: string }> {
  let cancelled: EvalRun;
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
