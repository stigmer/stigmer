# Remove ComponentMetadata Dead Code from Agent Execution

**Date**: April 4, 2026

## Summary

Removed the unused `ComponentMetadata` protobuf message and its field from the `ToolCall` message in the agent execution API. This was write-only dead code: the Python agent-runner populated it on every tool call, but no consumer (CLI, mobile, web, cloud backend) ever read it. Removing it eliminates unnecessary serialization overhead and simplifies the `ToolCall` schema.

## Problem Statement

The `ComponentMetadata` message was introduced early in development as a mechanism to pass UI rendering hints (component type, layout, grouping) from the agent-runner to frontend clients. However, the frontend rendering logic evolved independently and never consumed this field.

### Pain Points

- Every tool call carried a `ComponentMetadata` payload that was computed but never read
- The `component_type_inference.py` module existed solely to map tool names to UI type strings for this unused field
- The `ToolCall` proto carried an unnecessary nested message type, increasing schema complexity
- Documentation described behavior that no consumer implemented

## Solution

Removed the `ComponentMetadata` message definition, its field on `ToolCall`, all producer code in the Python agent-runner, and the dedicated inference module. Reserved field number 6 on `ToolCall` to prevent future wire-format conflicts with persisted data.

## Implementation Details

### Proto Layer

- Removed `ComponentMetadata component_metadata = 6` field from `ToolCall` in `message.proto`
- Added `reserved 6;` and `reserved "component_metadata";` to `ToolCall` for protobuf wire-format safety
- Deleted the entire `ComponentMetadata` message definition (4 fields: `component_type`, `component_group`, `layout_hint`, `metadata`)

### Python Agent-Runner

- `tool_event.py`: Removed `ComponentMetadata` import, `infer_component_type` import, and `component_metadata=` kwargs from two `ToolCall` construction sites
- `streaming_buffers.py`: Same cleanup across three `ToolCall` construction sites (`create_early_tool_call`, `start_thinking_stream`, `flush_thinking_buffer`)
- Deleted `component_type_inference.py` entirely (73-line module that mapped tool names to UI component type strings)

### Documentation

- Removed `component_metadata` row from the ToolCall fields table in `agent-execution-resource-guide.md`
- SDK reference docs regenerated automatically (ComponentMetadata section removed)

### Regenerated Stubs

Ran `make protos` to regenerate all stubs:
- Go (3 copies: `apis/stubs`, `sdk/go/proto`, `mcp-server/proto`)
- Java (`ComponentMetadata.java` and `ComponentMetadataOrBuilder.java` deleted, `ToolCall.java` updated)
- TypeScript (`message_pb.ts` updated)
- Python (`message_pb2.py` and `message_pb2.pyi` updated)
- JSON schemas (`agentexecution.json` updated)

## Benefits

- **Reduced serialization overhead**: No more computing and serializing `ComponentMetadata` for every tool call
- **Simpler schema**: `ToolCall` message is cleaner with one fewer nested type
- **Less code to maintain**: Removed ~100 lines of dead producer code and an entire module
- **Accurate documentation**: Docs no longer describe phantom behavior

## Impact

- **Agent-runner**: Slightly less work per tool call (no `ComponentMetadata` construction or `infer_component_type` call)
- **Wire format**: Existing persisted `ToolCall` protos with `component_metadata` at field 6 are silently ignored during deserialization (safe by protobuf design)
- **Consumers**: Zero impact — no consumer ever read this field

## Related Work

- Part of ongoing effort to keep the agent execution API surface clean and reflective of actual system behavior
- The reserved field (6) prevents accidental reuse if a similar concept is needed in the future under a different design

---

**Status**: Production Ready
