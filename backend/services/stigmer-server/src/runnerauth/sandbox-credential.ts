/**
 * Open source's sandbox credential, read two ways: which task queue its
 * sandbox serves (the Temporal worker lane's trust decision,
 * transport/temporal-worker-door/lane.ts), and whether it may be renewed.
 *
 * The credential is the CLOCKED execution-scoped token a sandbox is
 * launched with (sandbox/lane.ts `mintSandboxToken`): bound to the run that
 * ensured the sandbox, or to a tools listing's connect attempt, with an
 * `exp`. Its sandbox serves exactly one queue, built here from the binding,
 * never parsed from what the caller asks for:
 *
 *   - a run binding: the run's session, `session:<sessionId>`. The run
 *     itself need not be live: a session sandbox's token is bound to the
 *     run that last ensured it, which has usually ended by the next turn.
 *     The session must exist (a reaped session's sandbox is gone), and the
 *     token's own clock bounds it in time;
 *   - a connect binding: `mcpconnect:<attemptId>`, while the attempt's row
 *     is live (the listing deletes it when it settles).
 *
 * Refused (undefined), never thrown: a token this server did not sign, an
 * expired one, a RUN credential (no `exp`: the dispatch's credential for a
 * runner's per-run calls, which lives in Temporal history and is never a
 * sandbox's own), a person's key, and a binding whose row is gone. A store
 * outage propagates as the fault it is.
 *
 * Renewal re-mints the same binding with a fresh lifetime for a run-bound
 * token whose session exists, so a sandbox that outlives four hours keeps
 * taking work. A connect sandbox lives for one listing (at most ten
 * minutes) and is never renewed.
 */
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { sandboxTaskQueue } from "../sandbox/naming.js";
import { ResourceNotFoundError } from "../store/interface.js";
import { loadBoundExecution, type BoundExecution, type BoundExecutionStore } from "./bound-execution.js";
import type { MintedToken, RunnerAuthService } from "./runnerauth.js";
import { isClockedToken } from "./runnerauth.js";

export type SandboxCredentialStore = BoundExecutionStore;

/** The task queue the bearer's sandbox serves, or undefined to refuse (module header). */
export async function sandboxQueueOf(
  service: RunnerAuthService,
  store: SandboxCredentialStore,
  rawToken: string,
): Promise<string | undefined> {
  const bound = await liveSandboxBinding(service, store, rawToken);
  if (bound === undefined) {
    return undefined;
  }
  return bound.kind === "agent-execution"
    ? sandboxTaskQueue("session", bound.sessionId)
    : sandboxTaskQueue("connect", bound.executionId);
}

/** A fresh token on the same binding, or undefined when this credential does not renew. */
export async function renewSandboxCredential(
  service: RunnerAuthService,
  store: SandboxCredentialStore,
  rawToken: string,
  ttlSeconds: number,
): Promise<MintedToken | undefined> {
  const bound = await liveSandboxBinding(service, store, rawToken);
  if (bound === undefined || bound.kind !== "agent-execution") {
    return undefined;
  }
  return service.mint(bound.executionId, ttlSeconds);
}

/** The binding of a clocked token this server signed, when its sandbox can still exist. */
async function liveSandboxBinding(
  service: RunnerAuthService,
  store: SandboxCredentialStore,
  rawToken: string,
): Promise<BoundExecution | undefined> {
  let executionId: string;
  try {
    executionId = service.verify(rawToken);
  } catch {
    return undefined;
  }
  if (!isClockedToken(rawToken)) {
    return undefined;
  }
  const bound = await loadBoundExecution(store, executionId);
  if (bound === undefined) {
    return undefined;
  }
  if (bound.kind === "mcp-connect") {
    return bound;
  }
  if (bound.sessionId === "" || !(await sessionExists(store, bound.sessionId))) {
    return undefined;
  }
  return bound;
}

/**
 * Whether a clocked sandbox token bound to an ended run is still its
 * sandbox's: its run's session exists. The token's own `exp` bounds it in
 * time, and a run credential (no `exp`) never qualifies. The runner-subject
 * verifier reads it under the built-in posture, so a session sandbox's
 * token authenticates, and renews, while its session lives, as the hosted
 * edition's session token does.
 */
export async function sandboxSessionLives(
  store: SandboxCredentialStore,
  token: string,
  bound: BoundExecution,
): Promise<boolean> {
  return (
    isClockedToken(token) &&
    bound.kind === "agent-execution" &&
    bound.sessionId !== "" &&
    (await sessionExists(store, bound.sessionId))
  );
}

async function sessionExists(store: SandboxCredentialStore, sessionId: string): Promise<boolean> {
  try {
    await store.getResource(ApiResourceKind.session, sessionId, SessionSchema);
    return true;
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return false;
    }
    throw error;
  }
}
