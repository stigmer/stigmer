// Bounded collection of server-streaming RPC responses.
// Domain: conformance support (streaming lanes).
//
// The subscribe lanes (AgentExecution.subscribe, WorkflowExecution.subscribe/
// subscribeEvents) return long-lived streams that only sometimes close on
// their own — the server ends them on a terminal-phase UPDATE, but a stream
// opened against an already-terminal execution replays its snapshot/events
// and then idles forever (a verified quirk of both editions' pollers, pinned
// deliberately by the suites). A bare `for await` over such a stream would
// hang the test, so every conformance consumption of a stream goes through
// this helper: collect until a predicate is satisfied or a deadline passes,
// then abort the call and report what was gathered.
//
// The shape mirrors the poll-don't-sleep core (execution-poll.ts): the caller
// owns the predicate and the meaning of the collected messages; this module
// owns only the bounded-consumption rhythm. The streamFactory receives the
// AbortSignal because Connect-ES binds cancellation per call — the same
// `(signal) => AsyncIterable` seam the CLI's stream drivers use.
import { Code, ConnectError } from "@connectrpc/connect";

export const DEFAULT_STREAM_TIMEOUT_MS = 30_000;

export interface CollectStreamOptions<T> {
  // Stop collecting (successfully) once this returns true for the messages
  // gathered so far. Omit it to collect until the SERVER closes the stream —
  // only safe where the server is known to close (e.g. subscribeEvents on a
  // terminal execution); the timeout still backstops a hang.
  until?: (messages: T[]) => boolean;
  timeoutMs?: number;
}

export interface CollectedStream<T> {
  messages: T[];
  // How consumption ended:
  //   "until"  — the predicate was satisfied (the stream was then aborted);
  //   "closed" — the server ended the stream on its own;
  //   "timeout" — the deadline passed first. Deliberately NOT an error:
  //     some pinned contracts (the idle-forever snapshot replay) are proven
  //     BY the timeout arm, so the caller asserts on the outcome instead of
  //     catching.
  outcome: "until" | "closed" | "timeout";
}

// Consumes a server stream until the predicate, server close, or deadline —
// whichever comes first — and returns everything received. Abort-induced
// stream termination (Code.Canceled) is the helper's own doing and never
// surfaces; every other stream error propagates untouched, so error-contract
// assertions (NotFound on an unknown id) still see the real ConnectError.
export async function collectStream<T>(
  streamFactory: (signal: AbortSignal) => AsyncIterable<T>,
  options: CollectStreamOptions<T> = {},
): Promise<CollectedStream<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_STREAM_TIMEOUT_MS;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  const messages: T[] = [];
  let outcome: CollectedStream<T>["outcome"] = "closed";
  try {
    for await (const message of streamFactory(abort.signal)) {
      messages.push(message);
      if (options.until?.(messages) === true) {
        outcome = "until";
        abort.abort();
        break;
      }
    }
  } catch (err) {
    // Our own abort ends the iterable with Canceled; translate it to the
    // outcome it represents rather than failing the caller.
    if (err instanceof ConnectError && err.code === Code.Canceled && abort.signal.aborted) {
      outcome = outcome === "until" ? "until" : "timeout";
    } else {
      throw err;
    }
  } finally {
    clearTimeout(timer);
  }

  // A predicate satisfied on the same tick the server closed reports "until":
  // the caller got what it asked for; how the stream ended is incidental.
  if (outcome === "closed" && abort.signal.aborted) {
    outcome = "timeout";
  }
  return { messages, outcome };
}
