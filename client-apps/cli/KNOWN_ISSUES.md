# Known Issues

## Proto Import Path Mismatch

**Issue**: Backend controllers import protos from `internal/gen/...` but protos are generated to `apis/stubs/go/...`

**Current State**:
- Proto generation outputs to: `apis/stubs/go/ai/stigmer/agentic/agent/v1/`
- Backend imports from: `github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1`
- Directory `internal/gen` doesn't exist

**Impact**:
- CLI cannot build because it needs to import the same protos as backend
- Backend code likely also broken (needs verification)

**Solution Options**:

### Option 1: Update All Backend Imports (Recommended)
Update all backend controller imports from:
```go
import agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
```

To:
```go
import agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
```

**Pros**: Clean, follows actual proto generation
**Cons**: Requires updating many files

### Option 2: Update Proto Generation
Modify `apis/buf.gen.go.yaml` to output to `internal/gen` instead of `apis/stubs/go`.

**Pros**: No code changes needed
**Cons**: Less conventional path structure

### Option 3: Symlink
Create symlink: `internal/gen -> ../apis/stubs/go`

**Pros**: Quick fix, no code changes
**Cons**: Symlinks in repos are fragile

## Recommendation

**Option 1** is cleanest. Use find/replace to update all imports:

```bash
# Find all occurrences
grep -r "internal/gen/ai/stigmer" backend/

# Replace (example with sed)
find backend/ -name "*.go" -exec sed -i '' \
  's|github.com/stigmer/stigmer/internal/gen/|github.com/stigmer/stigmer/apis/stubs/go/|g' {} \;
```

## API Method Mismatches

**Issue**: Proto services don't have `List` methods, only individual `get` RPCs.

**Current State**:
- CLI expects: `agentQuery.List(ctx, &AgentListInput{})`
- Proto defines: Only `get(AgentId)` and `getByReference(ApiResourceReference)`

**Solution**:
Either:
1. Remove list commands from CLI (not user-friendly)
2. Add List RPCs to proto definitions
3. Implement list by calling backend BadgerDB ListResources directly

**Recommendation**: Add List RPCs to proto definitions for better UX.

## Missing Proto Methods

CLI needs these RPCs (currently missing):
- `AgentQueryController.list()` → `AgentList`
- `WorkflowQueryController.list()` → `WorkflowList`

These should be added to:
- `apis/ai/stigmer/agentic/agent/v1/query.proto`
- `apis/ai/stigmer/agentic/workflow/v1/query.proto`

And implemented in backend controllers.
