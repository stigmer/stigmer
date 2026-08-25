/**
 * The slim orchestration input for stigmer/workflow-execution/invoke —
 * ports activities.InvokeWorkflowExecutionWorkflowInput
 * (execute_workflow.go): orchestration coordinates only, snake_case keys
 * with Go's omitempty shape so TS-authored histories carry the same keys
 * a Go-authored history would.
 *
 * The slim-input doctrine keeps secrets out of Temporal's durable
 * history: the child workflow hydrates the full context
 * (WorkflowInstance, Workflow, ExecutionContext) via gRPC from these IDs.
 * The SAME object is passed to the child, so the key set is a
 * cross-component contract with the runner's execute-from-execution.
 *
 * Go's callback_token / invoker_identity_account_id fields have no OSS
 * producer (cloud-only lanes) and are not modeled — the seam's ratified
 * boundary (src/domain/workflowexecution/engine.ts).
 *
 * Sandbox-shared module: type-only, no imports.
 */
export interface InvokeWorkflowExecutionWorkflowInput {
  readonly execution_id: string;
  readonly workflow_instance_id?: string;
  readonly workflow_id?: string;
  readonly org_id?: string;
  /**
   * Signals the runner's workflow engine to skip completed tasks and
   * resume from the first incomplete/failed task. Set only by the
   * recover pipeline; normal executions omit it (Go omitempty).
   */
  readonly recovery_mode?: boolean;
}

/**
 * The relaySignal envelope (invoke_workflow_impl.go RelaySignalPayload,
 * June DD-013): an arbitrary signal to forward to the child, sent by the
 * controller's sendSignal / submitWorkflowTaskApproval through
 * SignalWithStart. JSON keys are the Go struct tags.
 */
export interface RelaySignalPayload {
  readonly signalName: string;
  readonly payload: unknown;
}
