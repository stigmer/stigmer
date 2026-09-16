/**
 * The runner-subject lane's pinned names and copy — the one constants
 * module for the runner-credential domain (the ts-server guideline:
 * byte-pinned copy lives in one constants module per domain, never
 * inline at the refusal site).
 *
 * Two refusal sentences for a PRESENTED credential, deliberately not
 * more (the InvalidTokenError doctrine of runnerauth.ts: a finer reason
 * invites branching on it). The runner is the only caller that ever
 * presents a run credential, and the person reading these is its
 * operator, in the runner's log:
 *
 *   - the TOKEN sentence: the credential itself is not one this server
 *     will honor — forged, the wrong shape, bound to an execution this
 *     server does not have, a present `exp` in the past, or minted by a
 *     key this server does not hold. A missing execution is this
 *     sentence and not NOT_FOUND on purpose: the credential is invalid,
 *     and the run is not the caller's to learn about.
 *   - the LIVENESS sentence: the credential is genuine but its run is
 *     over, or its run was created by nobody this server recognizes as a
 *     person (the schedule fire caller's deterministic-refusal shape: no
 *     retry will make that run anyone's).
 *
 * And one for a REQUESTED credential — the platform exchange under the
 * built-in posture (built-in-runner-credential-provider.ts), where the
 * caller is a signed-in person asking for a run's credential and the
 * answer is a permission, not a token verdict: only the person whose run
 * it is may hold its credential. A run whose creator stamp names nobody
 * gets the same sentence — no one is its person.
 *
 * The lineage mismatch copy is the cloud edition's, transcribed byte for
 * byte (credentials/provider.ts in the composition; the Java
 * RecordRunnerLineageLabelsStep before it) so the two editions refuse a
 * mis-stamped lineage label with one sentence.
 */

/** The verifier's name in the boot log and in auth failures (the `oidc` / `apikey` precedent). */
export const RUNNER_VERIFIER_NAME = "runner";

/** The token arms: forged, wrong shape, unknown execution, past `exp`, keyless. */
export const RUNNER_CREDENTIAL_INVALID_MESSAGE =
  "runner credential is not valid on this server";

/** The resolution arms: a terminal execution; a run stamped by nobody the server recognizes. */
export const RUNNER_CREDENTIAL_NOT_LIVE_MESSAGE =
  "runner credential names a run that is over or belongs to nobody this server recognizes";

/** The exchange's refusal under the built-in posture: the caller is not the run's person (PERMISSION_DENIED). */
export const RUN_CREDENTIAL_NOT_RUNS_PERSON_MESSAGE =
  "a run credential is minted only for the person whose run it is";

/** The cloud's byte-pinned lineage refusal (the Java step's copy). */
export const WORKFLOW_LINEAGE_BINDING_MISMATCH_MESSAGE =
  "workflow lineage label names a workflow execution this runner credential is not bound to";

/** The cloud's byte-pinned org-mismatch refusal (MemoryPolicy.MEMORY_CAPTURE_ORG_MISMATCH_MESSAGE). */
export const MEMORY_CAPTURE_ORG_MISMATCH_MESSAGE =
  "memory capture is scoped to the session's organization";

/**
 * How long a run credential outlives its run, measured from the row's
 * `status.completed_at`. A run's credential is valid while the run is
 * not terminal — runs wait on humans with no timeout, so no clock can
 * bound them — and for this long after, because two legitimate runner
 * writes land after the terminal stamp: the session-subject generation
 * the workflow fires and does not await (issue #665), and a Temporal
 * activity retried after its completion failed to reach the engine.
 * Ten minutes covers one model call and one retry backoff; today's
 * exchange-lane token outlives a run by up to an hour. A terminal row
 * with no `completed_at` gets no grace: fail closed.
 */
export const RUN_CREDENTIAL_GRACE_AFTER_TERMINAL_MS = 10 * 60 * 1000;
