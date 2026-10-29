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
   * as STIGMER, 1=STIGMER, 3=CLAUDE; 2 is retired) — selects ExecuteDeepAgent
   * or ExecuteClaude; any other number fails the run.
   */
  readonly harness?: number;
  /**
   * Resolved execution target as the proto enum numeric value (0=UNSPEC,
   * 1=LOCAL, 2=CLOUD). Cloud uses it for sandbox provisioning; the OSS
   * workflow ignores it (kept for cross-edition input parity).
   */
  readonly execution_target?: number;
  /**
   * The run is a reconcile turn (`RunSpec.reconcile_file_review`): it puts
   * back undone files and sends no message, so its workflow titles no
   * session and closes no earlier turn's file review. Omitted when false.
   */
  readonly reconcile_file_review?: boolean;
}
