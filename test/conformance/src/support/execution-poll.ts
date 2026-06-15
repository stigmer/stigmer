// Enum-agnostic execution polling core.
// Domain: conformance support (execution engine).
//
// Both execution domains (WorkflowExecution, AgentExecution) are *running things*
// whose phase advances asynchronously, so their suites must poll-don't-sleep:
// fetch the resource on an interval until a phase is observed, never block on a
// fixed timer. The rhythm is identical across domains; only two things genuinely
// differ — each owns a distinct proto `ExecutionPhase` enum and a distinct `get`
// client. This core captures the shared rhythm parameterized on exactly those
// two, so the per-domain modules (workflowexecutions.ts / agentexecutions.ts) add
// only typed builders, phase constants, and a diagnostic renderer over it.
import { setTimeout as delay } from "node:timers/promises";

export const DEFAULT_TIMEOUT_MS = 60_000;
export const DEFAULT_POLL_MS = 250;

export interface PollCoreOptions {
  timeoutMs?: number;
  pollMs?: number;
}

// Polls getFn() until `predicate` holds, returning the matching resource. On
// timeout it throws an Error whose message is built by `describeTimeout` from the
// last observed resource — keeping all phase/enum/id formatting in the typed
// caller, so diagnostics stay precise without the core knowing any enum.
export async function pollUntil<T>(
  getFn: () => Promise<T>,
  predicate: (resource: T) => boolean,
  describeTimeout: (last: T | undefined, timeoutMs: number) => string,
  opts: PollCoreOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? DEFAULT_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  let last: T | undefined;
  while (Date.now() < deadline) {
    last = await getFn();
    if (predicate(last)) {
      return last;
    }
    await delay(pollMs);
  }
  throw new Error(describeTimeout(last, timeoutMs));
}
