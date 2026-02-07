# Remove WorkflowRunner gRPC Interface - Eliminate Dual Control Plane

**Date**: February 7, 2026

## Summary

Removed the WorkflowRunnerServiceController gRPC interface entirely, eliminating the dual control plane architecture. The workflow-runner is now a pure Temporal worker, with all lifecycle control (cancel, terminate, recover) delegated to the Stigmer service level via direct Temporal API calls. This cleanup removes ~4,900 lines of code and simplifies the architecture in preparation for implementing user-facing execution lifecycle controls.

## Problem Statement

The codebase had two parallel control planes for workflow execution lifecycle:

1. **WorkflowRunner gRPC Service**: Exposed `cancelExecution`, `pauseExecution`, `resumeExecution` RPCs
2. **Stigmer Service**: User-facing API (future implementation)

This created architectural confusion:
- Unclear responsibility boundaries between services
- Redundant control mechanisms
- WorkflowRunner acting as both executor AND controller
- Complicated the path to implementing user-facing lifecycle controls

### Pain Points

- Dual control plane made it unclear where lifecycle operations should be invoked
- gRPC server in workflow-runner was only used for isolated testing (not production)
- Three execution modes (`grpc`, `temporal`, `dual`) added unnecessary complexity
- The gRPC interface competed with the planned Stigmer service-level controls
- Developers had to understand both control planes to reason about workflow lifecycle

## Solution

**Complete removal of the WorkflowRunner gRPC interface**:

1. Deleted the entire `workflowrunner/v1` proto package
2. Removed generated Go and Python stubs
3. Deleted the gRPC server implementation
4. Removed the gRPC-mode executor
5. Simplified `main.go` to Temporal-only mode
6. Removed standalone `cmd/grpc-server` binary

The architecture now has a single, clear control flow:

```
User/CLI → Stigmer Service → Temporal API → WorkflowRunner (Worker)
```

## Implementation Details

### Files Deleted

| Component | Description | Lines Removed |
|-----------|-------------|---------------|
| `apis/ai/stigmer/agentic/workflowrunner/v1/` | Proto definitions (interface.proto, io.proto) | ~830 |
| `apis/stubs/go/ai/stigmer/agentic/workflowrunner/v1/` | Generated Go stubs | ~1,800 |
| `apis/stubs/python/stigmer/ai/stigmer/agentic/workflowrunner/v1/` | Generated Python stubs | ~630 |
| `backend/services/workflow-runner/pkg/grpc/` | gRPC server implementation | ~480 |
| `backend/services/workflow-runner/pkg/executor/workflow_executor.go` | gRPC-mode executor | ~380 |
| `backend/services/workflow-runner/cmd/grpc-server/` | Standalone gRPC server | ~130 |

### Files Modified

**main.go**: Simplified from 342 lines to 102 lines (70% reduction)
- Removed `ModeGrpc` and `ModeDual` execution modes
- Removed `startGrpcServer()` and `startBothModes()` functions
- Removed port configuration and gRPC server startup
- Removed `grpcserver` package import
- Pure Temporal worker mode only

**pkg/executor/BUILD.bazel**: Removed dependencies
- Removed `workflow_executor.go` from sources
- Removed `workflowrunner/v1` stubs dependency
- Removed `workflowexecution/v1` dependency (no longer needed for gRPC mode)
- Removed `grpc_client` dependency

**cmd/worker/BUILD.bazel**: Fixed visibility
- Changed from `//visibility:private` to `//backend/services/workflow-runner:__subpackages__`
- Allows internal `pkg/runner` to call worker functions

### Verification

- Production build succeeds: `//backend/services/workflow-runner:workflow-runner`
- Worker build succeeds: `//backend/services/workflow-runner/worker:worker`
- All relevant tests pass:
  - `//backend/services/workflow-runner/pkg/zigflow/...` ✅
  - `//backend/services/workflow-runner/pkg/utils:utils_test` ✅
  - `//backend/services/workflow-runner/pkg/claimcheck:claimcheck_test` ✅
  - `//backend/services/workflow-runner/pkg/validation:validation_test` ✅

**Note**: One pre-existing broken test found (`integration_test.go`) - broken before these changes (imports from wrong package). Not related to this cleanup.

## Benefits

### Code Simplification
- **~4,900 lines removed** (26 files deleted, 4 files modified)
- main.go reduced by 70% (342 → 102 lines)
- Eliminated 3 execution modes down to 1
- Removed entire gRPC server infrastructure

### Architectural Clarity
- Single control plane (Stigmer service → Temporal)
- Clear separation of concerns (workflow-runner = executor only)
- Simplified mental model (no dual control paths)
- Easier to reason about lifecycle operations

### Preparation for User-Facing Controls
- Clean foundation for implementing cancel/terminate/recover RPCs at Stigmer service level
- No competing control mechanisms
- Clear path forward for T1-T7 tasks (execution lifecycle control)

### Developer Experience
- Simpler local development (only Temporal mode)
- Less code to maintain and test
- Clearer error messages (no mode confusion)
- Easier onboarding (one control flow to understand)

## Impact

### Breaking Changes

**Local development workflow**:
- `EXECUTION_MODE=grpc` no longer supported
- `EXECUTION_MODE=dual` no longer supported
- Developers must run local Temporal for workflow testing

**Migration**: This is intentional - production uses Temporal, so local development should mirror production. No user-facing functionality affected.

### Who Is Affected

**Internal developers**: Must use Temporal for local workflow testing (already required for production-like testing)

**End users**: No impact - this is internal architecture cleanup

### Related Work

**Next steps** (from `20260207.04.execution-lifecycle-control` project):
- T1: Add `EXECUTION_TERMINATED` phase enum
- T2: Add `cancel`, `terminate`, `recover` RPCs to WorkflowExecutionCommandController
- T3: Add IO messages for lifecycle operations
- T4: Implement backend handlers (Java/Kotlin)
- T5: Add CLI commands
- T6-T7: Enhance wait task configuration

## Technical Decisions

### Why Remove (Not Refactor)?

**Decision**: Complete deletion vs keeping for "debugging"

**Rationale**:
- gRPC mode was rarely (if ever) used in practice
- Temporal provides better debugging tools (Temporal UI, tctl CLI)
- Having two modes creates maintenance burden
- Production always uses Temporal - dev should match

### Why No Gradual Migration?

**Decision**: Remove all at once vs phased approach

**Rationale**:
- No active users of gRPC mode
- Clean break is clearer than gradual deprecation
- Removes ambiguity immediately
- Enables faster progress on T1-T7

---

**Status**: ✅ Production Ready  
**Code Reduction**: ~4,900 lines  
**Project**: [20260207.04.execution-lifecycle-control](../_projects/2026-02/20260207.04.execution-lifecycle-control/)  
**Next Task**: T1 - Add EXECUTION_TERMINATED phase enum
