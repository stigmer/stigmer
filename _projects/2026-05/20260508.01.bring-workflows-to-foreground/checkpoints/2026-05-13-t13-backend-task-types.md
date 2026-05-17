# Checkpoint: T13 — P0 Task Types Backend Implementation (Go)

**Date**: 2026-05-13
**Task**: T13 — P0 Task Types — Backend Implementation
**Status**: COMPLETE
**Scope**: Go workflow-runner only (Java deferred to T13b)

## Accomplishments

Implemented runtime execution for 6 new P0 task types in the Go workflow-runner:
transform, validate, emit_event, notification, llm_call, human_input. Created shared
infrastructure: budget tracker, event emitter, LLM provider abstraction, notification
provider interface. Modified the core task executor to support dynamic branch routing.

20 new files created, 5 existing files modified. Zero test regressions.

## New Files Created

### Infrastructure Packages (7 files)
- `pkg/budget/tracker.go` — Budget accumulator (cost_micros, total_tokens, duration)
- `pkg/events/emitter.go` — Typed event builder with auto-incrementing sequence numbers
- `pkg/llm/provider.go` — LLMProvider interface (Request/Response types)
- `pkg/llm/openai.go` — OpenAI ChatCompletion provider
- `pkg/llm/anthropic.go` — Anthropic Messages API provider
- `pkg/llm/registry.go` — Prefix-based model slug → provider resolution
- `pkg/notification/provider.go` — NotificationProvider interface + registry
- `pkg/notification/webhook.go` — Webhook provider (HTTP POST)

### Task Builders (11 files)
- `task_builder_transform.go` + `task_builder_transform_activities.go`
- `task_builder_validate.go` + `task_builder_validate_activities.go`
- `task_builder_emit_event.go` + `task_builder_emit_event_activities.go`
- `task_builder_notification.go` + `task_builder_notification_activities.go`
- `task_builder_call_llm.go` + `task_builder_call_llm_activities.go`
- `task_builder_human_input.go`

### Modified Files (5 files)
- `constants.go` — 6 new call function constants
- `task_builder.go` — NewTaskBuilder factory dispatches to 6 new builders
- `task_builder_do.go` — runTask returns branch override; iterateTasks applies it
- `converter/proto_to_yaml.go` — 6 new task kind dispatch entries
- `converter/task_converters.go` — 6 new typed converter methods

## Key Design Decisions

### DD-T13-001: Custom CallFunction Pattern
All 6 new task types map to `model.CallFunction` with custom `call` names
(same pattern as agent_call). The CNCF SDK parses them as call functions,
task builders parse config from `With` via `protojson.Unmarshal`.

### DD-T13-002: Direct workflow.ExecuteActivity
New task builders call `workflow.ExecuteActivity` directly (not through the
base `executeActivity` helper) because they use custom proto configs, not
CNCF SDK model types. This matches the agent_call pattern.

### DD-T13-003: __stigmer_branch_override for Dynamic Routing
Tasks that need dynamic flow control (validate.fallback_task, llm_call.fallback_task,
human_input.outcome.then) return `__stigmer_branch_override` in their output.
The DoTaskBuilder.runTask detects this, strips it from output, and overrides
the static flow directive.

### DD-T13-004: human_input Uses Temporal Signals (Not Activities)
Unlike all other task types, human_input does NOT schedule a Temporal activity.
It waits directly in the workflow function via Temporal signals + timer. This is
correct because signals are durable, no worker thread is blocked, and timeout
is handled by Temporal's timer.

### DD-T13-005: Phase 1 Scoping Decisions
- JSONata engine: deferred (JQ + template cover P0 use cases)
- Notification channels: webhook-only; Slack/email/Discord deferred
- emit_event delivery: CloudEvents envelope constructed, cross-workflow delivery deferred
- LLM model resolution: prefix-based; full model registry integration deferred
- LLM cost calculation: raw token counts returned; precise billing deferred

## Dependencies Added
- `github.com/santhosh-tekuri/jsonschema/v6` (Apache-2.0) — JSON Schema Draft 2020-12
- `github.com/sashabaranov/go-openai` (Apache-2.0) — OpenAI API client
- `github.com/liushuangls/go-anthropic/v2` (Apache-2.0) — Anthropic API client

## Open Items
- Event emission wiring into updateStatus RPC call path
- Budget enforcement integration into iterateTasks loop
- stigmer-server signal routing for human_input submitWorkflowApproval
- Java/stigmer-service parity (T13b)
- Server-side event persistence verification (getEventLog/subscribeEvents)

## Verification
- `go build ./...` — clean
- `go vet ./...` — clean
- `go test ./pkg/...` — all pass, zero regressions
