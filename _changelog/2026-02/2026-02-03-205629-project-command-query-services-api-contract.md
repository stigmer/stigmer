# Project Command/Query Services - API Contract Complete

**Date**: February 3, 2026

## Summary

Completed the Project entity API contract by adding `command.proto` and `query.proto` service definitions with full IAM authorization. This defines the gRPC interface for project lifecycle operations (create, read, update, delete), making Project a complete aggregate root ready for backend implementation in Phase 5.

This work completes subtask T04.1a of Phase 4 (Project Entity & stigmer.yaml Foundation).

## Problem Statement

The Project entity was designed as an aggregate root for resource lifecycle management in Task T04.1. However, the initial implementation created an incomplete API contract - it defined the entity structure (api.proto, spec.proto, status.proto, enum.proto, io.proto) without the operations that make it functional.

### Pain Points

- Project proto had status fields (`audit`, `reconciliation`) that implied backend persistence, but no mechanism to persist or retrieve this state
- No way to create or update projects through the backend
- Inconsistent with Agent/Workflow patterns which have complete command/query service definitions
- Backend controller implementation would be blocked without API contract

## Solution

Added two new proto files following the established Agent/Workflow service patterns exactly:

1. **command.proto**: Defines `ProjectCommandController` with write operations (apply, create, update, delete)
2. **query.proto**: Defines `ProjectQueryController` with read operations (get, getByReference)

Additionally, extended the IAM permission enum with `can_create_project` to support project creation authorization.

## Implementation Details

### Files Created

**`apis/ai/stigmer/agentic/project/v1/command.proto`** (47 lines)
- `ProjectCommandController` service with 4 RPCs
- `apply(Project) → Project` - Upsert operation (authorization determined at runtime)
- `create(Project) → Project` - Organization-scoped with `can_create_project` permission
- `update(Project) → Project` - Project-scoped with `can_edit` permission
- `delete(ProjectId) → Project` - Project-scoped with `can_delete` permission
- Full IAM authorization options with field paths and error messages

**`apis/ai/stigmer/agentic/project/v1/query.proto`** (25 lines)
- `ProjectQueryController` service with 2 RPCs
- `get(ProjectId) → Project` - Project-scoped with `can_view` permission
- `getByReference(ApiResourceReference) → Project` - Custom authorization in handler

### Files Modified

**`apis/ai/stigmer/iam/iampolicy/v1/rpcauthorization/iam_permission.proto`**
- Added `can_create_project = 23` permission
- Follows same pattern as `can_create_agent` and `can_create_workflow`
- Enables organization-level authorization for project creation

### Generated Stubs

**Go stubs** (4 new files):
- `command.pb.go`, `command_grpc.pb.go` - Command controller interfaces
- `query.pb.go`, `query_grpc.pb.go` - Query controller interfaces
- Includes `ProjectCommandControllerClient/Server` interfaces
- Includes `ProjectQueryControllerClient/Server` interfaces

**Python stubs** (6 new files):
- `command_pb2.py`, `command_pb2.pyi`, `command_pb2_grpc.py`
- `query_pb2.py`, `query_pb2.pyi`, `query_pb2_grpc.py`

**Updated BUILD.bazel**:
- Added command/query proto sources to build targets
- All stubs compile successfully with Bazel

### Authorization Patterns

Followed exact patterns from Agent/Workflow:

| RPC | Resource Kind | Permission | Field Path | Use Case |
|-----|---------------|------------|------------|----------|
| create | organization | can_create_project | metadata.org | Create in org |
| update | project | can_edit | metadata.id | Update existing |
| delete | project | can_delete | value | Delete by ID |
| get | project | can_view | value | Get by ID |
| getByReference | - | (custom) | - | Get by org/name |

## Benefits

1. **Complete API Contract**: Project entity now has full CRUD operations defined
2. **Pattern Consistency**: Exact structural match with Agent/Workflow services (indistinguishable style)
3. **IAM Authorization**: Full permission model with actionable error messages
4. **Type Safety**: Generated client/server interfaces provide compile-time safety
5. **Backend Ready**: Clear contract for Phase 5 backend controller implementation
6. **Documentation**: Comprehensive service and RPC comments for API consumers

## Impact

### Architecture After This Task

```
apis/ai/stigmer/agentic/project/v1/
  api.proto       # Project message              (T04.1 - existing)
  spec.proto      # ProjectSpec                  (T04.1 - existing)
  status.proto    # ProjectStatus                (T04.1 - existing)
  enum.proto      # ProjectRuntime enum          (T04.1 - existing)
  io.proto        # ProjectId wrapper            (T04.1 - existing)
  command.proto   # ProjectCommandController     (T04.1a - NEW)
  query.proto     # ProjectQueryController       (T04.1a - NEW)
```

### Who/What Is Affected

- **Backend Team**: Can now implement `ProjectCommandControllerImpl` and `ProjectQueryControllerImpl` in Phase 5
- **CLI Team**: Next task (T04.5) can proceed with track detection logic knowing the API is stable
- **SDK Team**: Project will be available in SDK synthesis after backend implementation
- **IAM System**: New permission `can_create_project` added to authorization model

### Next Phase Dependency

Phase 5 (Backend Integration) will:
1. Implement `ProjectCommandController` in Java backend
2. Implement `ProjectQueryController` in Java backend  
3. Add CLI commands that communicate with backend (`project get`, `project apply`)
4. Integrate with SDK Unification work

## Related Work

- **Phase 4 Task T04.1** (2026-02-03): Created Project proto schema (api, spec, status, enum, io)
- **Phase 4 Task T04.2** (2026-02-03): Project Loader Foundation (156 lines, protovalidate integration)
- **Phase 4 Task T04.3** (2026-02-03): Project Validator (166 lines, 3 validation rules, 51 tests)
- **Phase 4 Task T04.4** (2026-02-03): Project Display (214 lines, table/yaml/json formats)
- **Phase 4 Next**: T04.5 - Track Detection Logic (walk-up algorithm for stigmer.yaml)

## Engineering Standards Met

✅ Exact structural match with Agent/Workflow patterns  
✅ Comprehensive documentation comments on services and RPCs  
✅ Consistent permission naming: `can_create_project`, `can_edit`, `can_delete`, `can_view`  
✅ Actionable error messages with clear context  
✅ Zero deviation from established patterns  
✅ All generated stubs compile successfully  
✅ Buf lint passes  

---

**Status**: ✅ Complete - API Contract Defined (Backend Implementation Deferred to Phase 5)  
**Task**: T04.1a - Project Command/Query Services  
**Phase**: 4 - Project Entity & stigmer.yaml Foundation  
**Completion Time**: ~45 minutes  
