# Fix List Operations: protojson Unmarshal Mismatch Across Domain Controllers

**Date**: February 24, 2026

## Summary

Fixed a systemic serialization format mismatch across 5 domain controller files where `protojson.Unmarshal` (JSON) was used to deserialize data stored as binary protobuf (`proto.Marshal`). This caused `stigmer list sessions`, agent execution listing, agent instance lookup, session-by-agent filtering, and workflow execution listing to silently return empty results.

## Problem Statement

After completing the fix for `ListBySession` (see 2026-02-24-230339), the same serialization mismatch was discovered in 5 additional files across the domain layer. The SQLite store persists all resources as binary protobuf via `proto.Marshal`, but these controllers attempted to deserialize with `protojson.Unmarshal` (JSON protobuf format). Since the formats are incompatible, every record failed to parse and was silently skipped.

### Pain Points

- `stigmer list sessions` always returned "No sessions found" despite sessions existing in the database
- `stigmer list executions` returned empty results
- Agent instance lookup by agent ID returned no matches
- Session filtering by agent instance returned no sessions
- Workflow execution listing returned empty results
- All failures were silent: errors logged as warnings, records skipped, empty lists returned with no user-visible error

## Solution

Changed `protojson.Unmarshal` to `proto.Unmarshal` in all 5 affected files, matching the binary protobuf format used by the SQLite store's `SaveResource` method. Updated imports from `google.golang.org/protobuf/encoding/protojson` to `google.golang.org/protobuf/proto`.

## Implementation Details

### Affected Files (identical fix pattern in each)

1. **session/controller/list.go** - `listAllSessionsStep.Execute()` - Direct cause of `stigmer list sessions` failure
2. **session/controller/steps/filter_by_agent_instance.go** - `filterByAgentInstanceStep.Execute()` - Used by `listByAgent` RPC
3. **agentinstance/controller/get_by_agent.go** - `loadByAgentStep.Execute()` - Agent instance lookup by agent ID
4. **agentexecution/controller/list.go** - `queryAllExecutionsStep.Execute()` - Agent execution listing
5. **workflowexecution/controller/list.go** - `WorkflowExecutionController.List()` - Workflow execution listing

## Benefits

- All list operations now correctly return stored resources
- Session management is fully functional (`stigmer list sessions` returns sessions as expected)
- Agent instance, execution, and workflow execution queries are restored

## Impact

- **Users**: `stigmer list sessions`, `stigmer list executions`, and all list-based CLI commands now work correctly
- **Developers**: Highlights the importance of auditing for the same bug pattern across the codebase when fixing a serialization mismatch in one location

## Related Work

- Fix session resume unmarshal bug in ListBySession (2026-02-24-230339)
- Session abstraction and conversational TUI (2026-02-18, 2026-02-19)

---

**Status**: Production Ready
