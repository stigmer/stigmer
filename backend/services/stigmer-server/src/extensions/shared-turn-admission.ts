/**
 * The shared-turn admission point (single-instance, ExtensionDrivers
 * .sharedTurnAdmission): whether a turn a shared runner serves
 * (domain/run/placement.ts `shared`) may run now, and the release of its
 * place.
 *
 * A sandboxed turn is bounded by its fleet's room; a shared turn needs no
 * sandbox, so nothing bounds it unless a composition says so. The
 * agent-execution workflow asks `admit` before each of the turn's runner
 * invocations (the first, and each after an approval, a resume or a
 * recovery) and waits on `no_room` with the sandbox wait's loop and limit
 * (temporal/agentexecution/shared-turn.ts): a turn over its organization's
 * limit waits PENDING, it is never refused. It calls `release` when the
 * turn parks on a person's answer or a pause, and when the turn ends
 * however it ends, so a turn holds a place only while it runs.
 *
 * The contract an implementation keeps:
 *   - `admit` is idempotent per run: a run that already holds a place is
 *     answered `ready` again (a recovery asks again without a release);
 *   - `release` is idempotent, and releasing a run that holds no place is
 *     a no-op;
 *   - a place lost to a crash between the two (the workflow's release
 *     never ran) is freed by the implementation's own freshness rule;
 *   - a throw is a failed ask: logged, and the turn goes on, as a failed
 *     sandbox ensure does.
 *
 * With none composed, open source bounds nothing (one organization holds
 * the install), and the workflow releases nothing.
 */
/** The facts a shared turn's ask carries, as a sandbox ensure's (sandbox/provisioner.ts SandboxFacts) do. */
export interface SharedTurnFacts {
  readonly executionId: string;
  readonly sessionId: string;
  readonly org: string;
  /** The class of the caller whose request started the run (CallerIdentity.callerClass), as the workflow input carries it. */
  readonly callerClass: string;
}

/** The composition's admission (module header). */
export interface SharedTurnAdmission {
  admit(facts: SharedTurnFacts): Promise<"ready" | "no_room">;
  release(executionId: string): Promise<void>;
}
