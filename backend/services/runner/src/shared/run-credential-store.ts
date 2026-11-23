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
 * different reader (the host's model clients and the local proxy) — two
 * facts, two stores.
 *
 * Exactly one writer — `interceptors/run-credential-activity.ts`, the
 * activity inbound interceptor both worker roots register — and readers that
 * are all the Stigmer platform's own clients: the auth interceptor in
 * `client/stigmer-client.ts`; the server's artifact lane client in
 * `shared/artifact-storage.ts` (its presign requests only, never the
 * presigned PUT or GET, which carry no credential); the remote adapter, which
 * opens each turn at the local proxy with it so the host's model, checkpoint
 * and engine-session calls go out as the turn (`agent-host/remote-adapter.ts`,
 * `agent-proxy/lanes.ts`); and the runner's own calls to the platform's model
 * and checkpoint lanes during a turn, through {@link credentialForTurn} and
 * {@link turnCredentialRef}. Nothing else may read this: a user task's
 * outbound HTTP (`activities/call-http.ts`) must never carry the run's
 * credential, and the way that stays true is that no code path but the
 * platform's clients asks for it.
 *
 * Why the runner's own calls read it first: a runner shared by many
 * organizations holds a key that opens only its Temporal door, so a call it
 * makes for a turn with its own key is refused. A turn whose dispatch
 * carried no credential keeps the runner's own token, as before.
 */

import { AsyncLocalStorage } from "node:async_hooks";

import type { TokenRef } from "../config.js";

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
 * dispatch carried none (the cloud, whose runner credential is provisioned,
 * not dispatched).
 */
export function currentRunCredential(): string | undefined {
  return runCredential.getStore();
}

/**
 * The credential a call to the Stigmer platform made for the running turn
 * goes out with: the turn's run credential, else the runner's own token
 * (`ref`); `undefined` when neither is held.
 */
export function credentialForTurn(ref: Readonly<TokenRef>): string | undefined {
  return currentRunCredential() ?? ref.current ?? undefined;
}

/**
 * `ref` as a client that reads its credential per request sees it: the
 * running turn's credential first, by {@link credentialForTurn}'s rule,
 * read at each request so the turn is the one whose async context made it.
 */
export function turnCredentialRef(ref: Readonly<TokenRef>): Readonly<TokenRef> {
  return {
    get current(): string | null {
      return credentialForTurn(ref) ?? null;
    },
  };
}
