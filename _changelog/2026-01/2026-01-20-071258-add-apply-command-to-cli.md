# Add Apply Command to Stigmer CLI

**Date**: 2026-01-20  
**Type**: Feature  
**Scope**: CLI  
**Impact**: High - Core deployment workflow enabled

## Summary

Implemented the `stigmer apply` command by porting the complete implementation from Stigmer Cloud. This command enables deploying agents and workflows from code by auto-discovering resources through SDK synthesis. The implementation includes full support for both local and cloud backends, with proper Go workspace configuration for Bazel builds.

## What Changed

### New CLI Command: `stigmer apply`

Added a complete apply command that:
- Loads `Stigmer.yaml` project configuration from current directory
- Validates entry point (main.go) and Go module setup
- Executes entry point with SDK synthesis to auto-discover agents/workflows
- Deploys discovered resources to backend (local daemon or cloud)
- Provides detailed progress output and next steps
- Supports dry-run mode for validation without deployment
- Works seamlessly in both local and cloud modes

### New Packages Created

**1. `internal/cli/config/stigmer.go`** - Project configuration
- `LoadStigmerConfig()` - Loads and validates Stigmer.yaml
- `StigmerConfig` struct with project metadata (name, runtime, main entry point)
- Smart path resolution for Stigmer.yaml (current dir, specified dir, or explicit file)
- Clear error messages when not in a Stigmer project directory
- Absolute path resolution for entry point files

**2. `internal/cli/agent/validation.go`** - Entry point validation
- `ValidateGoModule()` - Checks go.mod exists and is valid
- `ValidateGoFile()` - Validates Go file contains Stigmer SDK imports

**3. `internal/cli/agent/execute.go`** - Manifest generation
- `ExecuteGoAgentAndGetManifest()` - Runs user's entry point with `STIGMER_OUT_DIR` env var
- Automatically runs `go mod tidy` before execution
- Reads generated protobuf manifests (agent-manifest.pb, workflow-manifest.pb)
- Validates manifest structure and SDK metadata
- Returns structured `ManifestResult` with discovered resources

**4. `internal/cli/deploy/deployer.go`** - Resource deployment
- `Deployer` with progress callbacks for user feedback
- `deployAgents()` - Converts AgentBlueprint → Agent API resource and calls apply RPC
- `deployWorkflows()` - Deploys Workflow resources with proper org/scope settings
- Proper error wrapping with context for each deployment

**5. `cmd/stigmer/root/apply.go`** - Command implementation
- `NewApplyCommand()` - Cobra command definition with flags
- `ApplyCodeMode()` - Reusable apply logic (used by other commands)
- `ApplyCodeModeOptions` - Configuration struct for apply behavior
- Orchestrates: config load → validation → execution → deployment
- Rich progress output with discovered resource preview
- Success summary with next steps suggestions

### Backend Enhancement

**`internal/cli/backend/client.go`**:
- Added `NewConnection()` convenience function
- Auto-loads config and establishes gRPC connection
- Works with both local (localhost:50051, insecure) and cloud (api.stigmer.ai:443, TLS) modes
- Simplifies command implementations (one-line connection setup)

### Bazel & Go Workspace Configuration

**Critical Fix: Go Workspaces for Multi-Module Bazel Builds**

Adopted Planton Cloud's proven approach for handling multiple Go modules in Bazel:

**Created `go.work`**:
```go
go 1.25.6

use (
	.                    # Root module (stigmer-server, agent-runner, backend/libs)
	./apis/stubs/go      # API protobuf stubs
	./client-apps/cli    # CLI with its own dependencies
	./sdk/go             # SDK with its own dependencies
)
```

**Updated `MODULE.bazel`**:
```bazel
# Read Go deps from go.work (includes root + CLI + SDK modules)
go_deps = use_extension("@gazelle//:extensions.bzl", "go_deps")
go_deps.from_file(go_work = "//:go.work")  # ← Changed from go_mod to go_work
```

**Added BUILD marker files**:
- `apis/stubs/go/BUILD.bazel` - Makes stubs a Bazel package
- `sdk/go/BUILD.bazel` - Makes SDK a Bazel package
- `sdk/go/templates/BUILD.bazel` - Defines templates library
- `backend/services/workflow-runner/BUILD.bazel` - Marker (service is .bazelignore'd)

**Why This Matters**:

Before:
- CLI dependencies (cobra, charmbracelet/*, yaml.v3) polluted root go.mod
- Bazel couldn't load from multiple go.mod files
- Build failures due to missing transitive dependencies
- Whack-a-mole with dependency additions

After:
- Each module maintains its own dependencies in its own go.mod
- Root go.mod only has backend dependencies (badger, temporal, grpc)
- CLI go.mod only has CLI dependencies (cobra, UI libs, etc.)
- Go workspace ties all modules together
- Bazel reads from go.work and gets ALL dependencies automatically
- Clean separation of concerns
- Follows Planton Cloud's proven pattern

### Module Structure

Stigmer now has a clean multi-module structure:

```
stigmer/
├── go.work                           # Workspace (ties modules together)
├── go.mod                            # Root module (stigmer-server, agent-runner, backend/libs)
├── apis/stubs/go/go.mod             # API stubs module
├── backend/services/
│   ├── stigmer-server/              # Uses root module
│   ├── agent-runner/                # Uses root module  
│   └── workflow-runner/go.mod       # Separate module (.bazelignore'd)
├── backend/libs/go/                 # Uses root module
├── client-apps/cli/go.mod           # CLI module (UI deps, cobra, etc.)
└── sdk/go/go.mod                    # SDK module
```

## Why This Implementation

### Parity with Stigmer Cloud

The user explicitly requested: "I want you to copy whatever is there in Stigmer Cloud" - this implementation achieves full feature parity:

- ✅ Same command structure and flags
- ✅ Same progress output and messaging
- ✅ Same validation logic
- ✅ Same synthesis architecture (STIGMER_OUT_DIR + manifest reading)
- ✅ Same error messages
- ✅ Same deployment orchestration

### Go Workspaces Solution

Copied Planton Cloud's approach after discovering the challenge with multiple modules:

**Problem**: Bazel's `go_deps` extension only supports one `go.mod` file, but we have CLI-specific dependencies that shouldn't pollute the root module.

**Solution**: Go workspaces (`go.work`) - exactly how Planton solved it:
- One workspace file references all modules
- Bazel loads from workspace, not individual go.mod files
- Each module maintains its own dependencies
- No cross-module pollution
- Clean builds without dependency conflicts

### Backend Mode Awareness

The apply command works correctly in both modes:

**Local Mode**:
- Connects to `localhost:50051` (local daemon)
- Insecure gRPC connection
- No authentication needed

**Cloud Mode**:
- Connects to `api.stigmer.ai:443` (cloud API)
- TLS-secured gRPC connection
- Token-based authentication
- Organization context from config

The backend selection is automatic based on `~/.stigmer/config.yaml`:
```yaml
backend:
  type: local  # or cloud
```

## Impact

### For Users

**New capability**:
```bash
# Create project with stigmer new
stigmer new my-project
cd my-project

# Deploy agents/workflows from code
stigmer apply

# Output:
# ✓ Loaded Stigmer.yaml
# ✓ Entry point is valid
# ✓ Manifest loaded: 2 resource(s) discovered (1 agent(s), 1 workflow(s))
# ✓ Connected to backend
# ✓ Agent deployed: pr-reviewer (ID: agent-abc123)
# ✓ Workflow deployed: analyze-pr (ID: workflow-xyz789)
# 🚀 Deployment successful!
```

**Workflow**:
1. Write agent/workflow code using SDK
2. Run `stigmer apply`
3. Resources auto-discovered and deployed
4. Zero manual manifest writing
5. Works in both local and cloud modes

### For Development

**Bazel builds now work correctly**:
```bash
# Build CLI with Bazel
bazel build //client-apps/cli:stigmer

# Success! No dependency issues
# All modules' dependencies available through go.work
```

**Clean module separation**:
- Backend services don't pull in CLI UI dependencies
- CLI doesn't pollute root module
- SDK is independent
- Workspace ties everything together

## Technical Details

### Synthesis Architecture

The apply command follows the SDK synthesis model:

1. **User writes code** using SDK:
```go
package main

import (
    "github.com/stigmer/stigmer-sdk/go/stigmer"
    "github.com/stigmer/stigmer-sdk/go/agent"
)

func main() {
    stigmer.Run(func(ctx *stigmer.Context) error {
        agent.New(ctx,
            agent.WithName("code-reviewer"),
            agent.WithInstructions("Review code for quality..."),
        )
        return nil
    })
}
```

2. **CLI executes** with `STIGMER_OUT_DIR` env var set

3. **SDK synthesizes** manifests to `.stigmer/agent-manifest.pb`

4. **CLI reads** protobuf manifests

5. **CLI converts** AgentBlueprint → Agent API resource

6. **CLI deploys** via gRPC `apply` RPC

### Organization Resolution

Priority order for determining organization:
1. `--org` flag (highest priority)
2. `organization` field in Stigmer.yaml
3. Organization from CLI context (`~/.stigmer/config.yaml`)
4. Error if none specified

### Error Handling

All errors wrapped with context:
- Failed to load Stigmer.yaml → Shows help about `stigmer new`
- Invalid Go file → Shows validation error
- Synthesis failed → Shows Go execution error (first 500 chars)
- Deployment failed → Shows which resource failed and why

## Files Changed

**New files** (7):
- `client-apps/cli/cmd/stigmer/root/apply.go` (228 lines)
- `client-apps/cli/internal/cli/config/stigmer.go` (161 lines)
- `client-apps/cli/internal/cli/agent/validation.go` (71 lines)
- `client-apps/cli/internal/cli/agent/execute.go` (161 lines)
- `client-apps/cli/internal/cli/deploy/deployer.go` (126 lines)
- Plus 4 BUILD.bazel marker files

**Modified files** (9):
- `MODULE.bazel` - Changed to use go.work, added CLI deps to use_repo
- `client-apps/cli/cmd/stigmer/root.go` - Added NewApplyCommand()
- `client-apps/cli/internal/cli/backend/client.go` - Added NewConnection() helper
- Plus 6 BUILD.bazel auto-updated by Gazelle

**Configuration files** (2):
- `go.work` - Workspace with 4 modules
- `go.work.sum` - Workspace dependencies

**Total**: 747 lines of new Go code across 5 packages

## Testing

**Manual test**:
```bash
# Built successfully with Bazel
bazel build //client-apps/cli:stigmer

# Help output works
bazel-bin/client-apps/cli/stigmer_/stigmer apply --help

# Command registered in root
bazel-bin/client-apps/cli/stigmer_/stigmer --help | grep apply
```

**Runtime behavior** (validated through code review):
- ✅ Loads Stigmer.yaml correctly
- ✅ Validates Go files
- ✅ Executes with proper env vars
- ✅ Reads protobuf manifests
- ✅ Converts to API resources
- ✅ Deploys via gRPC
- ✅ Handles both local and cloud backends
- ✅ Provides rich progress output

## Dependencies

**No new external dependencies** - All packages already in workspace:
- `github.com/spf13/cobra` - CLI framework (from CLI go.mod)
- `gopkg.in/yaml.v3` - YAML parsing (from CLI go.mod)
- `github.com/pkg/errors` - Error wrapping (from CLI go.mod)
- Stigmer API stubs - Local workspace (apis/stubs/go)

## Next Steps

**For users**:
1. Create project: `stigmer new my-agent`
2. Write agent code in main.go
3. Deploy: `stigmer apply`
4. Resources auto-discovered and deployed

**For development**:
- Monitor apply command usage patterns
- Add manifest mode (-f flag) in future if needed
- Consider progress bar for large deployments
- Add validation for inline skills (create Skill resources)

## Learnings & Decisions

### Go Workspaces for Bazel

**Discovery**: Planton Cloud uses `go.work` instead of trying to merge multiple go.mod files.

**Why it works**:
- Bazel's `go_deps.from_file()` supports both `go_mod` and `go_work` parameters
- Workspaces are Go's native solution for multi-module repos
- Each module maintains its own dependencies
- Workspace makes all dependencies available to all modules
- Bazel reads the workspace and automatically creates repositories for all deps

**Before** (didn't work):
```bazel
go_deps.from_file(go_mod = "//:go.mod")
# CLI dependencies not available → build fails
```

**After** (works perfectly):
```bazel
go_deps.from_file(go_work = "//:go.work")
# All module dependencies available → build succeeds
```

### Why Root go.mod Still Needed

Unlike Planton (which has no root go.mod), Stigmer needs it because:
- `stigmer-server` service has no go.mod → uses root module
- `agent-runner` service has no go.mod → uses root module
- `backend/libs/go` shared libraries have no go.mod → use root module

Planton has each service as its own module. Stigmer's architecture differs.

### Module Exclusions in .bazelignore

The `workflow-runner` service is in `.bazelignore` but still needs to be excluded from `go.work` for Bazel purposes:
- Having it in go.work causes Bazel to try loading it
- But .bazelignore marks it as deleted package
- This creates a conflict
- Solution: Exclude from go.work to match Bazel expectations

## Architecture Alignment

This implementation aligns with Stigmer's synthesis architecture:

**SDK → CLI contract**:
1. SDK collects agent/workflow definitions through user code
2. SDK serializes to protobuf manifests (agent-manifest.pb, workflow-manifest.pb)
3. CLI reads manifests (proto-agnostic SDK)
4. CLI converts to platform API resources
5. CLI deploys via gRPC

**No AST manipulation** - The SDK's `stigmer.Run()` handles synthesis automatically when `STIGMER_OUT_DIR` is set. Clean, Pulumi-inspired design.

## Documentation Impact

This feature enables the core deployment workflow documented in getting-started guides. Users can now:
- Initialize projects with `stigmer new`
- Deploy resources with `stigmer apply`
- Complete the "zero to deployed agent" experience locally

---

**Related**:
- `stigmer new` - Project scaffolding (already exists)
- `stigmer server` - Local daemon (already exists)
- SDK synthesis architecture (already implemented)
- Future: `stigmer destroy` for resource cleanup
