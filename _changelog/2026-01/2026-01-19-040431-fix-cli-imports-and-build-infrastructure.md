# Fix CLI Imports and Build Infrastructure

**Date**: 2026-01-19 04:04  
**Type**: Infrastructure  
**Scope**: CLI Build System  
**Impact**: Foundation for CLI feature migration

## Summary

Fixed CLI imports to use OSS protobuf stubs and resolved all compilation errors. The CLI now builds successfully with the correct module paths and dependencies. This unblocks the migration of features from Stigmer Cloud CLI to OSS CLI.

## Problem

The CLI was using incorrect import paths and had several compilation errors preventing it from building:

1. **Wrong import paths**: CLI was trying to import from `internal/gen/` which didn't exist
2. **Missing dependencies**: Build system didn't include protobuf stubs and SDK modules
3. **API mismatches**: Code used incorrect field names (`Id` vs `Value`) and non-existent methods (`List`)
4. **Field locations**: Description was in wrong struct (Metadata vs Spec)

## Solution

### 1. Enhanced `cliprint` Package

Added colored output and progress display support from Stigmer Cloud CLI:

**Files updated**:
- `internal/cli/cliprint/cliprint.go` - Added colored output (success, error, info, warning)
- `internal/cli/cliprint/progress.go` - Added TUI progress display with phases

**Dependencies added**:
- `github.com/fatih/color` - Colored terminal output
- `github.com/charmbracelet/bubbletea` - Terminal UI framework
- `github.com/charmbracelet/bubbles` - UI components (spinner)
- `github.com/charmbracelet/lipgloss` - Terminal styling

**Why**: These are needed by Cloud CLI commands (run, apply, deploy) which will be migrated next.

### 2. Fixed Module Dependencies (`go.mod`)

**Added replace directives**:
```go
replace github.com/stigmer/stigmer/sdk/go => ../../sdk/go
replace github.com/stigmer/stigmer/apis/stubs/go => ../../apis/stubs/go
```

**Added required modules**:
```go
github.com/stigmer/stigmer/apis/stubs/go v0.0.0  // Protobuf generated stubs
github.com/stigmer/stigmer/sdk/go v0.0.0          // Stigmer Go SDK
```

**Why**: Local development requires replace directives to use local modules instead of remote versions.

### 3. Fixed Import Paths

**Updated imports in all CLI files**:

Before (incorrect):
```go
agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
```

After (correct):
```go
agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
```

**Files updated**:
- `cmd/stigmer/root/agent.go`
- `cmd/stigmer/root/workflow.go`
- `internal/cli/backend/client.go`

**Why**: Protobuf stubs are generated in `apis/stubs/go/`, not `internal/gen/`.

### 4. Fixed API Mismatches

#### Field Name Corrections

**AgentId and WorkflowId** have `Value` field, not `Id`:

```go
// Before (wrong)
input := &agentv1.AgentId{Id: id}

// After (correct)
input := &agentv1.AgentId{Value: id}
```

**Why**: Generated protobuf code uses `Value` as the field name for ID wrapper messages.

#### Missing List Methods

The proto query controllers don't have `List` methods yet:

```go
func (c *Client) ListAgents(ctx context.Context) ([]*agentv1.Agent, error) {
    // TODO: List endpoint doesn't exist in proto yet
    // Return empty list for now
    return []*agentv1.Agent{}, nil
}
```

**Why**: List RPCs haven't been added to proto query controllers yet. This is documented for future implementation.

#### Description Field Location

**Description is in Spec, not Metadata**:

```go
// Before (wrong)
workflow := &workflowv1.Workflow{
    Metadata: &apiresourcev1.ApiResourceMetadata{
        Name: name,
        Description: description,  // WRONG
    },
}

// After (correct)
workflow := &workflowv1.Workflow{
    Metadata: &apiresourcev1.ApiResourceMetadata{
        Name: name,
    },
    Spec: &workflowv1.WorkflowSpec{
        Description: description,  // CORRECT
    },
}
```

**Why**: ApiResourceMetadata doesn't have Description field. It's part of the resource Spec.

### 5. Protobuf Generation

Ran `make protos` to generate stubs:
- Go stubs: `apis/stubs/go/ai/stigmer/...`
- Python stubs: `apis/stubs/python/...`

## Verification

```bash
cd client-apps/cli
go mod tidy
go build -o stigmer-cli ./main.go
# ✓ Build successful
```

## Impact

### Immediate
- ✅ CLI builds without errors
- ✅ Correct module dependencies configured
- ✅ Ready for feature migration from Cloud CLI

### Next Steps
1. **Copy critical commands** from Cloud CLI to OSS CLI:
   - `run.go` - Execute agents/workflows with streaming logs
   - `apply.go` - Deploy resources from code (Stigmer.yaml pattern)
   - `destroy.go` - Delete resources
   - `auth.go` - Authentication (cloud mode)
   - `whoami.go` - Show current user
   - `context.go` - Organization context management

2. **Copy supporting packages**:
   - `agent/` - Agent execution logic
   - `deploy/` - Deployment orchestration
   - `manifest/` - Manifest parsing
   - `converter/` - Data conversion utilities
   - `flag/` - CLI flag definitions
   - `context/` - Context management

3. **Remove admin commands** (per Pulumi model):
   - ❌ Don't migrate `organization.go` - org management should be web-only
   - ❌ Don't migrate `apikey.go` - API key management should be web-only

### Foundation Complete
This work establishes the foundation for migrating Cloud CLI features to OSS CLI. The build infrastructure is now correct and ready to accept the feature migration.

## Files Changed

**Modified**:
- `client-apps/cli/go.mod` - Added dependencies and replace directives
- `client-apps/cli/go.sum` - Updated dependencies
- `client-apps/cli/internal/cli/cliprint/cliprint.go` - Enhanced with colored output
- `client-apps/cli/cmd/stigmer/root/agent.go` - Fixed imports
- `client-apps/cli/cmd/stigmer/root/workflow.go` - Fixed imports and Description location
- `client-apps/cli/internal/cli/backend/client.go` - Fixed API calls (Value field, List TODOs)

**Created**:
- `client-apps/cli/internal/cli/cliprint/progress.go` - Progress display with TUI

## Technical Notes

### Protobuf Stub Module Structure

The generated stubs follow this structure:
```
apis/stubs/go/
├── go.mod (module: github.com/stigmer/stigmer/apis/stubs/go)
├── go.sum
└── ai/stigmer/
    ├── agentic/
    │   ├── agent/v1/*.pb.go
    │   ├── workflow/v1/*.pb.go
    │   └── ...
    └── commons/
        └── apiresource/*.pb.go
```

### SDK Module Structure

The SDK is separate from protobuf stubs:
```
sdk/go/
├── go.mod (module: github.com/stigmer/stigmer/sdk/go)
├── agent/ - Agent builder API
├── workflow/ - Workflow builder API
└── ...
```

CLI imports:
- Protobuf types: `apis/stubs/go/...`
- SDK utilities: `sdk/go/...`

### Build Requirements

- Go 1.25.0+ (required by SDK)
- Protobuf stubs must be generated first (`make protos`)
- Local development requires replace directives in `go.mod`

## Related Work

- **Checkpoint**: Phase 3 - CLI implementation blocked by proto imports (now unblocked)
- **Next**: Migrate Cloud CLI commands (run, apply, destroy, auth, whoami, context)
- **Deferred**: Organization and API key management (web console only per Pulumi model)
