/**
 * The slim workflow input — ports
 * pkg/domain/agentexecution/temporal/workflows/workflow_input.go.
 *
 * Carries ONLY orchestration coordinates: no secrets, no large payloads
 * (the full AgentExecution proto used to be the input; runtime_env could
 * hold secrets, and Temporal history is durable — stigmer's slim-input
 * redesign keeps secrets out of history).
 *
 * The snake_case keys are a cross-edition wire contract shared with the
 * Go and Java control planes (workflow_input.go: "The JSON keys MUST stay
 * byte-identical"). callback_token is a base64 string on the wire — Go
 * json.Marshal renders []byte as std-base64 — and Go's omitempty fields
 * are optional here so a TS-authored history carries the same keys a
 * Go-authored one would.
 *
 * Bundle-safe: imported by both the workflow and the engine client.
 */
export interface InvokeAgentExecutionWorkflowInput {
  readonly execution_id: string;
  readonly session_id: string;
  readonly agent_id: string;
  /** Base64-encoded activity callback token (Go []byte, omitempty). */
  readonly callback_token?: string;
  readonly auto_approve_all?: boolean;
  readonly parent_workflow_id?: string;
  readonly invoker_identity_account_id?: string;
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
