# Next Task: Workflow HITL Approval UI

## Current State
- **Status**: in-progress (core implementation complete, testing blocked by pre-existing issue)
- **Last Session**: May 22, 2026 — Implemented full end-to-end pipeline
- **Active Task**: Integration testing and verification

## Session Progress (May 21–22, 2026)

### Completed
- Proto enrichment: `HumanInputOutcomeInfo` message + extended `ApprovalRequestedPayload` with `outcomes[]` + `form_schema`
- Codegen: All stubs regenerated in both repos (Go, TS, Python, Java, Dart)
- TS runner loader: Extended `parseHumanInputConfig` to parse `form_schema`, `approvers`, `outcomes[].label`
- TS runner event pipeline: New `workflow-event-activities.ts`, wired into `engine-core.ts`, `do-executor.ts`, `tasks/human-input.ts`
- Go handler: `submit_workflow_task_approval.go` with `relaySignal` wrapping and 5-step pipeline
- React hook: `submitTaskApproval` added to `useWorkflowExecutionActions`
- React component: `WorkflowTaskApprovalCard` with dynamic outcomes, form fields, a11y
- Wiring: Props plumbed through Viewer → Timeline → TimelineEvent
- Exports: New component + types exported from SDK barrels

### Key Decisions
- Proto enrichment is NOT optional — Tiny Tactics workflows have 3-way outcomes that can't be hardcoded
- Event emission pipeline must be built (was lost in Go→TS runner migration) — without it the timeline is empty
- `WorkflowTaskApprovalCard` is a NEW component, not a modification of `WorkflowExecutionApprovalCard` (different domain model)
- Signal delivery uses `relaySignal` wrapping (not raw signal name) to reach the TS child workflow

### Critical Discovery
The workflow execution event emission pipeline did not exist in the TS runner. The entire event stream infrastructure (event store, timeline UI, CLI formatter) was built and ready but starved of data. This session restored event emission for the core event types.

## Next Steps
1. Resolve pre-existing Go module dependency conflict (`genproto` ambiguous imports) to unblock `go build` and unit tests
2. Run integration tests (`make test-integration`) to verify the Go handler end-to-end
3. Verify the event emission pipeline produces correct events by running a workflow with human_input tasks
4. Run `make lint` on the React SDK to confirm no theme token or import boundary violations
5. Propagate the `relaySignal` wrapping fix to `send_signal.go` (currently sends raw signal names — same gap)
6. Test with Tiny Tactics `daily-notification-plan` workflow end-to-end in the web app

## Blockers
- **Pre-existing Go module dependency conflict**: `go build` fails with `ambiguous import: found package google.golang.org/genproto` in the stigmer-server module. This is NOT caused by this change — it's a pre-existing MODULE.bazel issue. Needs `bazel mod tidy` or manual dependency resolution.

## Context for Resume
- The `WorkflowExecutionApprovalCard` (existing, orphaned) is for agent tool approvals — leave it as-is
- `send_signal.go` has the same relay wrapping gap — signals sent via `SendSignal` don't reach the TS child workflow either. This should be fixed separately.
- The TS runner's `do-executor.ts` now emits task events but cost/token tracking is always 0 — needs enhancement when agent_call tasks report cost back
- Outcome branching (`outcomes[].then`) in the TS runner may not work yet — needs verification with Tiny Tactics `daily_approval` (branches to `revise_proposal` on "revise")

## Quick Resume
To continue this project, drag this file into chat:
`@_projects/2026-05/20260521.03.workflow-hitl-approval-ui/next-task.md`
