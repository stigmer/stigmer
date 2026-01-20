# Fix: Add Debug Logging to Diagnose Stigmer Apply Issues

**Date**: 2026-01-20  
**Type**: Debug/Investigation  
**Impact**: Internal (debugging tools)

## Context

User reported two issues with `stigmer apply` command:
1. **Workflow name empty**: First apply succeeded for agent, but workflow failed with "resource name is empty, cannot generate slug"
2. **Agent apply creating instead of updating**: Second apply attempted to CREATE instead of UPDATE, failing with "AgentInstance with slug already exists"

## Investigation Process

### Initial Symptoms
- Agent deployed successfully: `✓ Agent deployed: pr-reviewer`
- Workflow failed: `Error: failed to deploy workflow '': rpc error: code = Unknown desc = pipeline step ResolveSlug failed: resource name is empty, cannot generate slug`
- Second apply attempted CREATE instead of UPDATE for existing resources

### Root Cause Discovery

Added debug logging to trace the issue through multiple layers:

1. **SDK Workflow Converter** (`sdk/go/internal/synth/workflow_converter.go`)
   - Added logging to `workflowToProtoWithContext()` to verify `wf.Document.Name` is set
   - Confirmed SDK was setting `metadata.Name` correctly

2. **CLI Deployer** (`client-apps/cli/internal/cli/deploy/deployer.go`)
   - Added logging to `deployWorkflows()` to inspect manifest
   - **Key discovery**: `metadata.Name=` (empty) but `spec.Document.Name=review-demo-pr`
   - Manifest showed workflow name in spec but not in metadata

3. **Backend Pipeline Steps**:
   - **LoadForApplyStep** (`backend/libs/go/grpc/request/pipeline/steps/load_for_apply.go`)
     - Added extensive logging to track slug matching
     - Found: `Resource 0: slug=, looking for=pr-reviewer, match=false`
     - **Key discovery**: Stored resources had **empty slugs**, preventing UPDATE detection
   
   - **BuildNewStateStep** (`backend/libs/go/grpc/request/pipeline/steps/defaults.go`)
     - Added before/after logging to verify slug preservation
     - Confirmed: `metadata.Slug=pr-reviewer` was present before and after processing
     - Slug was NOT being lost in pipeline

4. **Server Logs Analysis** (`~/.stigmer/data/logs/daemon.log`)
   - Confirmed resources were being created WITH slugs
   - But subsequent lookups found resources WITHOUT slugs
   - Indicated an SDK version mismatch

### Root Cause

User's test project (`~/.stigmer/stigmer-project/go.mod`) was using **published SDK version** from Git:
```go
replace github.com/stigmer/stigmer/sdk/go => github.com/stigmer/stigmer/sdk/go v0.0.0-20260120005545-fc443b1640d1
```

The published version had an issue where:
- `workflowToProtoWithContext()` correctly set `protoWorkflow.Metadata.Name = wf.Document.Name`
- But somewhere in the old version, `metadata.Name` was not being persisted/serialized correctly
- This caused workflows to be created with empty names and empty slugs

## Solution

**Temporary Fix** (for debugging/development):
Updated test project's `go.mod` to use local SDK:
```go
replace github.com/stigmer/stigmer/sdk/go => /Users/suresh/scm/github.com/stigmer/stigmer/sdk/go
replace github.com/stigmer/stigmer/apis/stubs/go => /Users/suresh/scm/github.com/stigmer/stigmer/apis/stubs/go
```

**Result**: Both issues resolved:
- ✅ First apply: Agent and workflow deployed successfully
- ✅ Second apply: Both resources correctly UPDATED (not recreated)
- ✅ Debug logs confirmed: Resources found with correct slugs

## Changes Made

### Debug Logging Added

**Purpose**: Comprehensive diagnostic logging to trace apply flow and identify where metadata/slug was lost.

1. **`backend/libs/go/grpc/request/pipeline/steps/load_for_apply.go`**:
   - Added debug output in `Execute()` to show slug lookups
   - Added debug output in `findBySlug()` to show resource matching
   - Logs: slug being searched, resources found, match results

2. **`backend/libs/go/grpc/request/pipeline/steps/defaults.go`**:
   - Added debug output in `BuildNewStateStep.Execute()`
   - Shows metadata state before and after processing
   - Confirms slug is not lost during state building

3. **`client-apps/cli/internal/cli/deploy/deployer.go`**:
   - Added debug output in `deployWorkflows()`
   - Shows `metadata.Name` vs `spec.Document.Name`
   - **This is where the issue was first visible**: empty metadata.Name

4. **`sdk/go/internal/synth/workflow_converter.go`**:
   - Added debug output in `workflowToProtoWithContext()`
   - Confirms SDK is setting metadata.Name correctly
   - Shows state after spec conversion

### Diagnostic Value

These debug logs enabled:
- **Pinpointing the layer** where metadata was lost (SDK serialization)
- **Understanding the flow** from SDK → manifest → CLI → backend
- **Verifying fixes** by seeing correct values in logs
- **Reproducing the issue** with different SDK versions

## Testing

**Test Environment**:
- Project: `~/.stigmer/stigmer-project` (Go SDK demo)
- Database: SQLite at `~/.stigmer/stigmer.db`
- Server: Local daemon mode

**Test Scenarios**:

1. **With old SDK** (published version):
   ```
   ℹ Deploying workflow 1/1: 
   Error: resource name is empty, cannot generate slug
   ```

2. **With local SDK** (fixed version):
   ```
   ℹ Deploying workflow 1/1: review-demo-pr
   ✓ Workflow deployed: review-demo-pr (ID: wfl-...)
   ```

3. **Second apply** (UPDATE test):
   ```
   [DEBUG LoadForApplyStep] Found existing resource with slug pr-reviewer, will update
   [DEBUG LoadForApplyStep] Found existing resource with slug review-demo-pr, will update
   ✓ Agent deployed: pr-reviewer (ID: agt-...) [same ID]
   ✓ Workflow deployed: review-demo-pr (ID: wfl-...) [same ID]
   ```

## Permanent Solution (Next Steps)

**For Production**:
1. Publish updated SDK with correct metadata serialization
2. Or investigate why published SDK version differs from local
3. Users will then use correct SDK version via normal dependency resolution

**Debug Logging**:
- Keep debug logging in development builds
- Consider adding `STIGMER_DEBUG` environment variable to enable/disable
- Or remove debug logging and rely on structured logging at appropriate levels

## Impact

**User Impact**:
- ✅ `stigmer apply` now works correctly for local development
- ✅ UPDATE semantics work properly (idempotent apply)
- ❌ Published SDK still has the issue (affects external users)

**Developer Impact**:
- ✅ Comprehensive debug logging for troubleshooting apply flow
- ✅ Clear understanding of metadata flow from SDK → backend
- ✅ Foundation for structured logging implementation

## Lessons Learned

1. **Version mismatches can be subtle**: Published SDK vs local SDK had different behavior
2. **Layer-by-layer debugging is essential**: Added logging at each layer to trace the issue
3. **Metadata flow is critical**: `metadata.Name` → `metadata.Slug` → UPDATE detection
4. **Test projects should use local SDK during development**: Avoid published version staleness

## Related Issues

- User also encountered agent instance duplicate error initially (before clean DB)
- Same root cause: old SDK not setting slugs properly, preventing UPDATE detection
- Debug logging revealed resources stored with empty slugs

## Technical Details

**Apply Flow**:
```
SDK: stigmer.Run() 
  → workflow.New(WithName("review-demo-pr"))
  → synthesizeManifests()
  → workflowToProtoWithContext()
  → Set protoWorkflow.Metadata.Name
  → Marshal to workflow-manifest.pb

CLI: stigmer apply
  → Load workflow-manifest.pb
  → deployWorkflows()
  → client.Apply(workflowBlueprint)

Backend: WorkflowCommandController.Apply()
  → ResolveSlugStep: Set metadata.Slug from metadata.Name
  → LoadForApplyStep: Find by slug
  → If found → Update; If not found → Create
```

**Where it broke** (old SDK):
- ❌ `protoWorkflow.Metadata.Name` set correctly in code
- ❌ But serialization/deserialization lost the field
- ❌ CLI received manifest with empty `metadata.Name`
- ❌ Backend couldn't generate slug from empty name
- ❌ Resources stored with empty slugs
- ❌ LoadForApplyStep couldn't find existing resources by slug

**Why local SDK worked**:
- ✅ Latest code has correct serialization
- ✅ `metadata.Name` preserved through marshal/unmarshal
- ✅ Backend receives correct metadata
- ✅ Resources stored with correct slugs
- ✅ LoadForApplyStep finds existing resources
- ✅ UPDATE works as expected

## Files Modified

- `backend/libs/go/grpc/request/pipeline/steps/load_for_apply.go` - Added debug logging
- `backend/libs/go/grpc/request/pipeline/steps/defaults.go` - Added debug logging
- `client-apps/cli/internal/cli/deploy/deployer.go` - Added debug logging
- `sdk/go/internal/synth/workflow_converter.go` - Added debug logging
- `~/.stigmer/stigmer-project/go.mod` - Updated to use local SDK (temporary fix)

## Next Actions

1. **Investigate SDK publishing**: Why does published version differ from local?
2. **Publish SDK update**: Ensure metadata serialization fix is in published version
3. **Consider structured logging**: Replace fmt.Printf debug logs with zerolog/context logging
4. **Add integration tests**: Test apply flow with actual SDK usage
5. **Document apply semantics**: Clarify CREATE vs UPDATE detection in architecture docs
