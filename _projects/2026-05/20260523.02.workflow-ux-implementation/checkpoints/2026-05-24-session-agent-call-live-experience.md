# Session Notes: 2026-05-24 — Agent Call Live Experience

## Accomplishments

- Fixed `pending_approvals` race condition (proto + Go + Java + runner)
- Added `child_execution_started` signal for early execution ID (Java + Go + TS orchestrator)
- Rewrote `AgentCallTab` with live `useExecutionStream` + `MessageThread` composition
- Wired orphaned `WorkflowExecutionApprovalCard` into inspector with new Approval tab
- Enhanced `ExecutionBadge` with tool name display for `waiting_approval` status
- Added `AgentCallProgressEvent` type and proto conversion to event pipeline
- Documented `run_workflow` architectural gap (no child DB record)
- Go unit tests for merge logic, TypeScript tests for view logic

## Decisions Made

- **DD-LIVE-001**: Inspector subscribes on-demand (not viewer level) — avoid N concurrent streams
- **DD-LIVE-002**: Sentinel boolean (not field mask) for approval fix — backward compatible, minimal blast radius
- **DD-LIVE-003**: Platform signal for early ID (not activity split) — preserves async completion pattern
- **DD-LIVE-004**: `call_llm` descoped — synchronous 5m activity, no streaming path
- **DD-LIVE-005**: Compose existing hooks (not build new infrastructure) — `useExecutionStream` + `MessageThread` proven
- **DD-LIVE-006**: Visibility-aware subscription — subscribe on tab focus, unsubscribe on blur

## Key Code Changes

- `io.proto`: `bool update_pending_approvals = 11` on UpdateStatusInput
- `update_status.go`: Conditional merge with `if input.UpdatePendingApprovals`
- `call-agent-orchestrator.ts`: New signal + event proxy + progress emission
- `AgentCallTab.tsx`: Complete rewrite with live/pending/static view switching
- `ExecutionInspector.tsx`: New Approval tab, auto-select on waiting_approval
- `invoke_workflow_impl.go`: SignalExternalWorkflow for child_execution_started
- `InvokeAgentExecutionWorkflowImpl.java`: signalParentExecutionStarted before harness dispatch

## Learnings

- `run_workflow` is scaffolded but incomplete — `executeChild(config.name)` uses the workflow name as a Temporal type, which isn't registered. Future work needed to make sub-workflows first-class.
- The existing `useExecutionStream` + `MessageThread` pattern from `WorkflowArchitectDialog` is directly composable into the inspector — no new streaming infrastructure needed.
- Approval routing already works: `WorkflowExecution.submitApproval` → `AgentExecution.submitApproval` in-process forwarding exists in both Go and Java.

## Open Questions

- After `make protos && make codegen`, verify `AgentCallProgressPayloadSchema` is properly generated and imported.
- The Go OSS `invoke_workflow_impl.go` uses `SignalExternalWorkflow` (non-blocking goroutine) — verify this doesn't affect workflow determinism guarantees.
- The Java `signalParentExecutionStarted` uses a String payload (not a proto) — verify Temporal serialization compatibility with TypeScript signal handler expecting `{ executionId: string }`.

## Next Session Plan

1. Run `make protos && make codegen` to regenerate TS/Go/Java stubs
2. Verify builds pass in both repos
3. Consider Phase B: periodic `agent_call_progress` from platform for graph node badges
4. Consider: wire approval card into timeline (for agent tool approvals alongside existing human_input cards)
