# Checkpoint: Agent Call Validation Fixes Complete

**Date**: 2026-01-20 23:52  
**Status**: ✅ Complete

## What Was Accomplished

Fixed two validation errors preventing workflows with agent call tasks from deploying:

### 1. Missing Task Kind Support ✅

Added `WORKFLOW_TASK_KIND_AGENT_CALL` support to workflow-runner validation and conversion:
- Added case in `unmarshal.go` for `AgentCallTaskConfig`
- Added case in `proto_to_yaml.go` calling `convertAgentCallTask()`
- Implemented complete converter in `task_converters.go`
- Fixed field names to match proto (Timeout, Temperature, Model)

### 2. Scope Enum Serialization ✅

Fixed SDK to serialize scope as enum integer instead of string:
- Added `scopeStringToEnum()` helper in `workflow_converter.go`
- Converts "organization" → `ApiResourceOwnerScope_organization` (2)
- Converts "platform" → `ApiResourceOwnerScope_platform` (1)
- Handles all enum values correctly

### 3. Worker Mode Support ✅

Enhanced workflow-runner with dedicated worker mode:
- Added `EXECUTION_MODE=temporal` detection
- Implemented `runTemporalWorkerMode()` function
- Loads config from environment
- Starts three-queue worker architecture
- Aliased SDK worker package to avoid conflicts

## Verification

✅ All code changes in place and verified  
✅ Binary rebuilt successfully  
✅ Workflow-runner starts in worker mode  
✅ Progressed past "unsupported task kind" error  
⚠️ Full deployment test pending CLI fix (unrelated issue)

## Impact

- Workflows with agent call tasks can now be validated
- YAML generation succeeds for agent call configurations
- Scope enums serialize correctly
- Worker mode provides cleaner separation for daemon deployment

## Files Modified

- `backend/services/workflow-runner/pkg/validation/unmarshal.go`
- `backend/services/workflow-runner/pkg/converter/proto_to_yaml.go`
- `backend/services/workflow-runner/pkg/converter/task_converters.go`
- `backend/services/workflow-runner/cmd/worker/root.go`
- `sdk/go/internal/synth/workflow_converter.go`

## Next Steps

End-to-end testing will resume once the CLI "failed to execute Go agent" issue (from separate conversation) is resolved.

## Documentation

See changelog: `_changelog/2026-01/2026-01-20-235252-fix-agent-call-workflow-validation.md`
