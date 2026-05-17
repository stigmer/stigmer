# emit_event and notification Task Types (T03 Batch 3)

**Date**: May 12, 2026

## Summary

Added the final two P0 task types to the workflow domain — `emit_event` (enum 18) and `notification` (enum 19) — completing T03's six new AI-native task types across three batches. emit_event closes the listen/emit duality for event-driven orchestration, while notification provides a first-class channel-based messaging primitive for operational workflows.

## Problem Statement

The workflow domain had `listen` (wait for Temporal signals) but no corresponding event emission primitive, creating an asymmetry in event-driven orchestration. Operational workflows also lacked a simple way to notify humans through channels (Slack, email, Discord) without the overhead of a full human_input approval gate.

### Pain Points

- Workflows could listen for events but had no standard way to publish them
- Sending notifications required workarounds (emit_event + downstream consumer, or http_call to Slack APIs)
- No CloudEvents-compatible event envelope in the workflow DSL
- Channel-specific metadata (Slack threading, email priority) had no structured home

## Solution

Two new proto definitions following the exact patterns established in Batch 1 (llm_call + transform) and Batch 2 (human_input + validate):

- **emit_event**: CloudEvents envelope (type, source, subject, data) via a nested `EmitEventSpec` sub-message, mirroring how listen.proto nests `ListenTo`
- **notification**: Fire-and-forget channel-based messaging with 6 fields (channel, recipients, subject, body, template, metadata), including the first `map<string, string>` field in any task config

## Implementation Details

### New Proto Files
- `apis/ai/stigmer/agentic/workflow/v1/tasks/emit_event.proto` — EmitEventSpec + EmitEventTaskConfig
- `apis/ai/stigmer/agentic/workflow/v1/tasks/notification.proto` — NotificationTaskConfig

### Modified Files
- `enum.proto` — emit_event=18, notification=19 with config schema summaries
- `spec.proto` — task_config mapping comment updated
- `unmarshal.go` — two new switch cases for Go unmarshal pipeline
- `tasks/README.md` — table updated to 19 task configs

### Design Decisions
- **No new policy enums** — structurally simplest batch; emit_event follows CloudEvents, notification uses string channel for extensibility
- **EmitEventSpec nested sub-message** — mirrors listen.proto's ListenTo pattern, enables future reuse (e.g., emit_batch)
- **notification.metadata as map<string,string>** — first map in task configs; channel-specific options like thread_ts, priority, reply_to
- **listen vs emit_event vocabulary gap is intentional** — listen is Temporal-centric (signals), emit_event is CloudEvents-centric; runtime (T13) bridges the two

### Stubs Regenerated
- `make codegen` (stigmer): Go, Java, Python, TypeScript, Dart + codegen JSON schemas + MCP server + SDK Go protos
- `make protos` (stigmer-cloud): all 5 language stubs

## Benefits

- **Event symmetry**: Workflows can now both listen for and emit events, enabling event-driven choreography between workflows
- **Operational notifications**: Simple, intuitive task for "send a message to humans" without approval gate overhead
- **CloudEvents compliance**: emit_event follows the graduated CNCF standard, enabling interop with external event systems
- **Extensible channels**: notification.channel is a string, not an enum — new notification providers added without proto changes

## Impact

- **Workflow authors**: Two new task types available in YAML DSL immediately
- **Task config count**: 13 → 19 (all 6 T03 types now in place)
- **T03 complete**: All three batches delivered — llm_call, transform, human_input, validate, emit_event, notification
- **Next**: T04 (Task Schema Registry) or T05 (Budget Primitives)

## Related Work

- [Structured Agent Output Model](2026-05-12-124751-structured-agent-output-model.md) — T02, prerequisite for T03
- [llm_call + transform Task Types](2026-05-12-140456-llm-call-transform-task-types.md) — T03 Batch 1
- [human_input + validate Task Types](2026-05-12-142951-human-input-validate-task-types.md) — T03 Batch 2

---

**Status**: ✅ Production Ready (proto definitions; runtime implementation is T13)
**Timeline**: Single session, third of three T03 batches
