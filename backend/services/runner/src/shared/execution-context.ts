/**
 * The execution-scoped context — "this async work belongs to execution X" —
 * as an `AsyncLocalStorage` the turn runtime enters once around the WHOLE
 * activity, and the transport layer reads per request.
 *
 * Why it is the runtime's and not a harness's: every proxy-bound request the
 * runner makes carries `x-stigmer-execution-id` from this store (the Cursor
 * fetch and HTTP/2 interceptors stamp it; `rejection-capture.ts` correlates
 * unhandled rejections by it), and a large share of those requests are made
 * OUTSIDE any engine stretch — attachment downloads and status offload
 * through the artifact proxy, the memory selection, the structured-output
 * extraction and the plan-artifact publish in the epilogue, and in a cloud
 * sandbox the control-plane writes themselves. Under `maxConcurrentActivities
 * > 1` the fallback (a module-level id, `fetch-interceptor.ts`
 * `setInterceptorExecutionId`) is whichever turn set it last; this store is
 * what makes concurrent turns not overwrite each other's headers.
 *
 * Moved from `activities/execute-cursor/fetch-interceptor.ts` (S2 M3,
 * Q-M3-12) so `harness/run-turn.ts` can enter it without importing the
 * adapter; the interceptors import it from here. No harness enters it: the
 * contract lists it among the things deliberately NOT on `TurnSink`.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface ExecutionContextStore {
  readonly executionId: string;
}

const executionContext = new AsyncLocalStorage<ExecutionContextStore>();

/** The store, for readers that stamp or correlate by execution id. */
export function getExecutionContext(): AsyncLocalStorage<ExecutionContextStore> {
  return executionContext;
}

/**
 * Run an async function with execution-scoped context. The executionId is
 * propagated through the async call chain via AsyncLocalStorage, ensuring
 * concurrent activities on the same runner process don't overwrite each
 * other's proxy headers.
 */
export function runWithExecutionContext<T>(executionId: string, fn: () => Promise<T>): Promise<T> {
  return executionContext.run({ executionId }, fn);
}
