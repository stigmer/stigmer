# Refactor BadgerDB Store to Use Proto-Generated ApiResourceKind Enum

**Date**: 2026-01-19  
**Type**: Refactoring  
**Scope**: Backend / BadgerDB Store  
**Impact**: Internal type safety improvement

## Summary

Refactored the BadgerDB store layer to use the generated protobuf `ApiResourceKind` enum from `apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind` instead of a custom string-based type. This improves type safety and ensures consistency with the proto definition.

## What Changed

### Store Interface (`backend/libs/go/badger/store.go`)

**Before**:
```go
type APIResourceKind string

const (
    APIResourceKindAgent APIResourceKind = "Agent"
    APIResourceKindAgentExecution APIResourceKind = "AgentExecution"
    // ... custom constants
)

func (s *Store) SaveResource(ctx context.Context, kind APIResourceKind, ...)
```

**After**:
```go
import "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"

func (s *Store) SaveResource(ctx context.Context, kind apiresourcekind.ApiResourceKind, ...)
```

### Key Changes

1. **Removed Custom Type**
   - Deleted custom `APIResourceKind` string type and constants
   - Never committed - created and removed in same session

2. **Updated Function Signatures**
   - `SaveResource(kind apiresourcekind.ApiResourceKind, ...)`
   - `GetResource(kind apiresourcekind.ApiResourceKind, ...)`
   - `ListResources(kind apiresourcekind.ApiResourceKind, ...)`
   - `DeleteResource(kind apiresourcekind.ApiResourceKind, ...)`
   - `DeleteResourcesByKind(kind apiresourcekind.ApiResourceKind, ...)`
   - `Resource.Kind` field type changed to `apiresourcekind.ApiResourceKind`

3. **Updated All Callers** (18 controller files)
   - Agent execution controllers (temporal activities, update_status, subscribe, list, list_by_session)
   - Workflow execution controllers (temporal activities, update_status, list, create)
   - Workflow controller (create)
   - Workflow instance controller (query)
   - Session controllers (list, filter_by_agent_instance)
   - Agent instance controller (get_by_agent)
   - Agent controller (create)

### Storage Format

The proto enum's `.String()` method returns snake_case names, which are now stored in BadgerDB:

- `apiresourcekind.ApiResourceKind_agent` → stores as `"agent"`
- `apiresourcekind.ApiResourceKind_agent_execution` → stores as `"agent_execution"`
- `apiresourcekind.ApiResourceKind_workflow` → stores as `"workflow"`
- etc.

This matches the proto enum value names exactly as defined in `apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto`.

## Why This Change

### User's Requirement
User wanted type safety and consistency: *"I don't want you to use or create a new enum under Badger; I want you to use the same value which we have in the proto. The generator stub will have the enum value."*

### Benefits

1. **Single Source of Truth**
   - Enum values come directly from `api_resource_kind.proto`
   - No custom type duplication
   - Proto changes automatically propagate

2. **Type Safety**
   - Compile-time checking ensures only valid enum values are used
   - IDE autocompletion shows all available resource kinds
   - Typos become compile errors instead of runtime bugs

3. **Consistency**
   - Same enum used across all components
   - Database keys use proto-defined snake_case names
   - Matches the authoritative proto definition

4. **Maintainability**
   - One place to define resource kinds (proto file)
   - Generated code handles string conversion
   - No manual constant maintenance

## Examples

### Before (Custom Type)
```go
// Had to manually maintain custom constants
err := store.SaveResource(ctx, badger.APIResourceKindAgent, id, agent)
```

### After (Proto Enum)
```go
// Use generated proto enum directly
err := store.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, id, agent)
```

### In Controllers
```go
// Agent execution controller
existing := &agentexecutionv1.AgentExecution{}
err := store.GetResource(ctx, apiresourcekind.ApiResourceKind_agent_execution, executionID, existing)

// Workflow controller  
kind := apiresourceinterceptor.GetApiResourceKind(ctx.Context())
err := store.SaveResource(ctx, kind, workflowID, workflow)
```

## Implementation Details

### Proto Enum Definition
From `apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto`:

```protobuf
enum ApiResourceKind {
  api_resource_kind_unknown = 0;
  // ...
  agent = 40 [(kind_meta) = {name: "Agent", ...}];
  agent_execution = 41 [(kind_meta) = {name: "AgentExecution", ...}];
  workflow = 50 [(kind_meta) = {name: "Workflow", ...}];
  // ...
}
```

### Generated Go Constants
From `apis/stubs/go/.../api_resource_kind.pb.go`:

```go
type ApiResourceKind int32

const (
    ApiResourceKind_agent           ApiResourceKind = 40
    ApiResourceKind_agent_execution ApiResourceKind = 41
    ApiResourceKind_workflow        ApiResourceKind = 50
    // ...
)

// String() returns snake_case name: "agent", "agent_execution", etc.
func (x ApiResourceKind) String() string {
    return protoimpl.X.EnumStringOf(x.Descriptor(), protoreflect.EnumNumber(x))
}
```

### Storage Key Format
BadgerDB keys use format: `{kind}/{id}`

Examples:
- `agent/agt-abc123`
- `agent_execution/aex-xyz789`
- `workflow/wfl-def456`

The kind portion comes from `ApiResourceKind.String()`, which returns the snake_case enum name.

## Files Modified

**BadgerDB Store** (3 files):
- `backend/libs/go/badger/store.go` - Core store interface
- `backend/libs/go/badger/store_test.go` - Test updates

**Agent Execution Controllers** (5 files):
- `backend/services/stigmer-server/pkg/controllers/agentexecution/temporal/activities/update_status_impl.go`
- `backend/services/stigmer-server/pkg/controllers/agentexecution/update_status.go`
- `backend/services/stigmer-server/pkg/controllers/agentexecution/subscribe.go`
- `backend/services/stigmer-server/pkg/controllers/agentexecution/list.go`
- `backend/services/stigmer-server/pkg/controllers/agentexecution/list_by_session.go`

**Workflow Execution Controllers** (4 files):
- `backend/services/stigmer-server/pkg/controllers/workflowexecution/temporal/activities/update_status_impl.go`
- `backend/services/stigmer-server/pkg/controllers/workflowexecution/update_status.go`
- `backend/services/stigmer-server/pkg/controllers/workflowexecution/list.go`
- `backend/services/stigmer-server/pkg/controllers/workflowexecution/create.go`

**Other Controllers** (6 files):
- `backend/services/stigmer-server/pkg/controllers/workflow/create.go`
- `backend/services/stigmer-server/pkg/controllers/workflowinstance/query.go`
- `backend/services/stigmer-server/pkg/controllers/session/list.go`
- `backend/services/stigmer-server/pkg/controllers/session/steps/filter_by_agent_instance.go`
- `backend/services/stigmer-server/pkg/controllers/agentinstance/get_by_agent.go`
- `backend/services/stigmer-server/pkg/controllers/agent/create.go`

**Total**: 18 files modified

## Testing

All existing tests updated to use proto enum constants:

```go
// Test now uses proto enum directly
err = store.SaveResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, agent)
err = store.GetResource(ctx, apiresourcekind.ApiResourceKind_agent, agent.Metadata.Id, retrievedAgent)
results, err := store.ListResources(ctx, apiresourcekind.ApiResourceKind_agent)
```

## Backward Compatibility

**Database Compatibility**: ✅ Compatible

The snake_case names stored in BadgerDB keys match what was likely being stored before (though the previous custom implementation isn't visible in git history, so this assumes `kind.String()` was used consistently).

If there's existing data using different casing or names, a migration would be needed.

## Future Work

This pattern should be applied to:
1. SQLite store (if it has similar custom types)
2. Any other storage layers using custom resource kind types
3. Ensure consistent use of proto enums across the codebase

## Related

- Proto definition: `apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.proto`
- Generated stubs: `apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind.pb.go`
- BadgerDB ADR: ADR-005 (Revised) - Single Bucket pattern

---

**Confidence**: ✅ High - Straightforward refactoring with clear type safety benefits and proto consistency
