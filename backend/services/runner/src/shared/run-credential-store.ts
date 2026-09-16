/**
 * The run credential of the activity that is running — an `AsyncLocalStorage`
 * the activity boundary enters once and the control-plane transport reads
 * per request.
 *
 * Why a store and not a parameter: the runner serves many executions in one
 * process, and the `StigmerClient` a request goes out on is shared — one per
 * worker for the turn activities (`harness/registry.ts`), one per call or a
 * module singleton for the engine's activities. A credential baked into a
 * client would be the wrong run's the moment two runs share it; a credential
 * read from the async context of the request is always the run whose
 * activity made the request, and a client cached across runs stays correct.
 * `shared/execution-context.ts` is the same shape for the execution id, with
 * a different owner (the turn runtime enters it INSIDE the turn) and a
 * different reader (the Cursor proxy interceptors) — two facts, two stores.
 *
 * Exactly one writer — `interceptors/run-credential-activity.ts`, the
 * activity inbound interceptor both worker roots register — and exactly one
 * reader — the auth interceptor in `client/stigmer-client.ts`. Nothing else
 * may read this: a user task's outbound HTTP (`activities/call-http.ts`) must
 * never carry the run's credential, and the way that stays true is that no
 * code path but the control-plane client asks for it.
 */

import { AsyncLocalStorage } from "node:async_hooks";

const runCredential = new AsyncLocalStorage<string>();

/** Run `fn` with `credential` as the run credential of everything it awaits. */
export function withRunCredential<T>(
  credential: string,
  fn: () => Promise<T>,
): Promise<T> {
  return runCredential.run(credential, fn);
}

/**
 * The run credential of the activity this request belongs to; `undefined`
 * outside any activity (boot, renewal loops) and inside an activity whose
 * dispatch carried none (an older server; the cloud, whose runner credential
 * is provisioned, not dispatched).
 */
export function currentRunCredential(): string | undefined {
  return runCredential.getStore();
}
