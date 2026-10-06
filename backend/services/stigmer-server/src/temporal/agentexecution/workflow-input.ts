/**
 * The slim workflow input — ports
 * pkg/domain/agentexecution/temporal/workflows/workflow_input.go.
 *
 * Carries ONLY orchestration coordinates: no secrets, no large payloads
 * (the full AgentRun proto used to be the input; runtime_env could
 * hold secrets, and Temporal history is durable — stigmer's slim-input
 * redesign keeps secrets out of history).
 *
 * The snake_case keys are a cross-edition wire contract shared with the
 * Go and Java control planes (workflow_input.go: "The JSON keys MUST stay
 * byte-identical"). Go's omitempty fields are optional here so a
 * TS-authored history carries the same keys a Go-authored one would.
 *
 * The input is plain JSON, so a key this interface does not name decodes
 * and is ignored: a history started by an older server that still carries
 * `callback_token` or `parent_workflow_id` replays unchanged.
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
   * type (domain/mcpserver/engine.ts). The workflow hands it to the
   * runner's activities, which present it on the run's own RPCs: under
   * the built-in authorization posture it admits the runner as the
   * human whose run this is, for as long as the run lives. Like the
   * connect lane's, it sits in Temporal history in the clear — history
   * is operator-only, and the operator holds the signing key already.
   */
  readonly execution_context_token?: string;
  /**
   * Session harness as the proto enum numeric value (0=UNSPECIFIED treated
   * as NATIVE, 1=NATIVE, 2=CURSOR) — selects ExecuteDeepAgent vs
   * ExecuteCursor.
   */
  readonly harness?: number;
  /**
   * Resolved execution target as the proto enum numeric value (0=UNSPEC,
   * 1=LOCAL, 2=CLOUD). Cloud uses it for sandbox provisioning; the OSS
   * workflow ignores it (kept for cross-edition input parity).
   */
  readonly execution_target?: number;
}
