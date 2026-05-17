# Session Notes: T06 Execution Event Stream Model — 2026-05-12

## Accomplishments

- Created `event.proto` with `WorkflowExecutionEvent`, `WorkflowEventType` (17 types), and 20 typed payload messages
- Added `getEventLog` (paginated) and `subscribeEvents` (server-streaming) RPCs to `query.proto`
- Added `GetEventLogRequest`, `GetEventLogResponse`, `SubscribeEventsRequest` to `io.proto`
- Added `repeated WorkflowExecutionEvent events = 10` to `WorkflowExecutionUpdateStatusInput` for atomic event production
- Removed dead `WorkflowExecutionUpdate` and `WorkflowUpdateType` (unused legacy code)
- Fixed TS codegen bug: streaming output types from non-api proto files were imported from wrong `_pb` module
- All codegen pipelines (`make codegen` + `make protos`) clean
- All verification passes: buf lint, buf breaking, Go/TS/React/Java/Python

## Decisions Made

- **CQRS-like separation**: Events (append-only log) complement snapshots (current state), not replace them
- **Option A for production**: Events piggyback on existing `updateStatus` RPC instead of a dedicated `produceEvents` RPC — minimizes new infrastructure
- **CloudEvents semantics as native proto fields**: Internal events use proto-native fields inspired by CloudEvents; full CloudEvents JSON envelopes reserved for workflow-authored external events via `emit_event`
- **No backward compatibility**: User explicitly directed to delete (not deprecate) dead code — project is pre-beta
- **Micro-USD for costs**: Consistent with billing domain (int64 micro-USD avoids floating-point)
- **Duration in milliseconds**: Consistent with existing duration fields across the platform
- **Enum numeric gaps**: Event types grouped by category with gaps (1-9 execution, 11-19 task, etc.) for future additions

## Key Code Changes

- `apis/ai/stigmer/agentic/workflowexecution/v1/event.proto`: New — full event model
- `apis/ai/stigmer/agentic/workflowexecution/v1/query.proto`: +2 RPCs, +authorization annotations
- `apis/ai/stigmer/agentic/workflowexecution/v1/io.proto`: +3 messages, +1 field, -1 dead message, -1 dead enum
- `tools/codegen/generator/sdk_client_ts.go`: Fix streaming output type import resolution
- `tools/codegen/schemas/services/workflowexecution.json`: Regenerated with new method types
- All generated stubs across Go, Java, Python, TypeScript, Dart updated

## Learnings

- TS codegen assumed all streaming output types live in `api_pb` — broke when `subscribeEvents` returns `WorkflowExecutionEvent` from `event_pb`. Fix: look up `ProtoFile` in `schema.MethodTypes` before defaulting.
- `buf.yaml` excepts `ENUM_VALUE_UPPER_SNAKE_CASE` and `ENUM_VALUE_PREFIX` — so lowercase snake_case enum values are valid in this codebase.

## Open Questions

- None — T06 proto contract is complete

## Next Session Plan

- T07: Artifact Store (final task in Phase 0)
- Then Phase 1: Foreground MVP (UI pages, execution viewer, YAML editor)
