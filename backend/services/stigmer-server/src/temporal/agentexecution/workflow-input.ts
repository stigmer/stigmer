/**
 * The slim workflow input.
 *
 * Carries ONLY orchestration coordinates: no secrets, no large payloads.
 * Temporal history is durable, so a Run proto, which can hold secrets,
 * never rides in it.
 *
 * The snake_case keys are wire contract: they are what every recorded
 * history carries, so they stay byte-identical. Fields that may be absent
 * are optional.
 *
 * The input is plain JSON, so a key this interface does not name decodes
 * and is ignored.
 *
 * Bundle-safe: imported by both the workflow and the engine client.
 */
export interface InvokeAgentExecutionWorkflowInput {
  readonly execution_id: string;
  readonly session_id: string;
  readonly agent_id: string;
  readonly auto_approve_all?: boolean;
  readonly invoker_identity_account_id?: string;
  /**
   * The run credential (runnerauth: a clockless execution-scoped token
   * bound to this execution), minted by the engine client at dispatch
   * when the composed credential provider defines `mintRunCredential`
   * and omitted otherwise. The connect lane's key for the same token
   * type (domain/plugin/tools/engine.ts). The workflow hands it to the
   * runner's activities, which present it on the run's own RPCs: under
   * the built-in authorization posture it admits the runner as the
   * human whose run this is, for as long as the run lives. Like the
   * connect lane's, it sits in Temporal history in the clear — history
   * is operator-only, and the operator holds the signing key already.
   */
  readonly execution_context_token?: string;
  /**
   * Session harness as the proto enum numeric value (0=UNSPECIFIED treated
   * as STIGMER, 1=STIGMER, 3=CLAUDE; 2 names no harness) — selects ExecuteDeepAgent
   * or ExecuteClaude; any other number fails the run.
   */
  readonly harness?: number;
  /**
   * Resolved execution target as the proto enum numeric value (0=UNSPEC,
   * 1=LOCAL, 2=CLOUD). On CLOUD the workflow ensures the session's sandbox
   * before the turn's first runner activity and waits while the fleet has
   * no room (sandbox-wait.ts).
   */
  readonly execution_target?: number;
  /**
   * The class of the caller whose request started the run (the identity
   * interceptor's word, CallerIdentity.callerClass), which the workflow's
   * sandbox ensure hands the driver (sandbox/provisioner.ts SandboxFacts).
   * Absent in an input from a server that predates the workflow's ensure:
   * such a run's sandbox was ensured by its request alone, and the
   * workflow does not wait for room.
   */
  readonly caller_class?: string;
  /** The routine whose fire started the run (CallerIdentity.routineId); absent for every other request. */
  readonly routine_id?: string;
  /**
   * The caller's id (CallerIdentity.identityId). The sandbox ensure mints
   * its runner credential for it only under the trusted-local posture
   * (sandbox/steps.ts). Not a secret; history is operator-only, as for
   * `invoker_identity_account_id`.
   */
  readonly caller_identity_id?: string;
  /**
   * How long the turn may wait for a sandbox with room, in seconds
   * (STIGMER_SANDBOX_WAIT_SECONDS at dispatch; `0` = not at all). Carried
   * on CLOUD only, zero included; absent means the default
   * (sandbox-wait.ts DEFAULT_SANDBOX_WAIT_SECONDS).
   */
  readonly sandbox_wait_seconds?: number;
  /**
   * The run is a reconcile turn (`RunSpec.reconcile_file_review`): it puts
   * back undone files and sends no message, so its workflow titles no
   * session and closes no earlier turn's file review. Omitted when false.
   */
  readonly reconcile_file_review?: boolean;
}
