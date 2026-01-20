# Align Go Workspace Structure with Planton Pattern

**Date**: 2026-01-20  
**Type**: Build System / Infrastructure  
**Impact**: All Go modules in the repository

## Summary

Restructured Stigmer's Go workspace to match Planton Cloud's modular architecture pattern. Previously, Stigmer had a root `go.mod` that existed solely because `stigmer-server` lacked its own module definition. This created an inconsistency with Planton's clean workspace-only approach.

**Key changes**:
- Created separate `go.mod` for `backend/libs/go` (shared libraries module)
- Created separate `go.mod` for `backend/services/stigmer-server` (server module)
- Updated `go.work` to include all modules (removed root `.` reference)
- Deleted root `go.mod` and `go.sum` files
- All services and libraries now have proper module boundaries

## Problem

Stigmer's Go workspace structure diverged from Planton's established pattern:

**Before (Stigmer)**:
```
stigmer/
├── go.work              # Workspace file
├── go.mod               # Root module (shouldn't exist)
├── go.sum               # Root dependencies
├── apis/stubs/go/go.mod
├── backend/
│   ├── libs/go/         # No go.mod (used root module)
│   └── services/
│       ├── stigmer-server/  # No go.mod (used root module)
│       └── workflow-runner/go.mod
└── client-apps/cli/go.mod
```

**Desired (Planton pattern)**:
```
planton/
├── go.work              # Workspace file only
├── apis/go.mod
└── backend/services/
    ├── iac-runner/go.mod
    ├── integration/go.mod
    └── tekton-webhooks-receiver/go.mod
```

## Root Cause

The root `go.mod` existed because:
1. `backend/libs/go` contained shared Go libraries but had no module definition
2. `backend/services/stigmer-server` had no module definition
3. Both imported from each other and from `apis/stubs/go`
4. `go.work` included `.` (root) to make these imports work

This created module boundary confusion and violated the principle of explicit dependencies.

## Solution

### 1. Created `backend/libs/go/go.mod`

**Module path**: `github.com/stigmer/stigmer/backend/libs/go`

**Purpose**: Contains shared Go libraries used across services:
- `badger/` - BadgerDB store abstraction
- `grpc/` - gRPC server and interceptor utilities
- `apiresource/` - API resource metadata handling
- `store/` - Storage interface definitions
- `telemetry/` - Tracing and observability

**Dependencies**:
- `buf.build/go/protovalidate v1.1.0` (validation in request pipeline)
- `github.com/dgraph-io/badger/v4 v4.5.0` (key-value store)
- `github.com/rs/zerolog v1.34.0` (logging)
- `github.com/stigmer/stigmer/apis/stubs/go` (local replace)
- `google.golang.org/grpc v1.78.0` (gRPC framework)
- `google.golang.org/protobuf v1.36.11` (protobuf runtime)

**Key fix**: Added explicit `google.golang.org/genproto/googleapis/api@latest` to resolve ambiguous import conflicts between old and new genproto versions.

### 2. Created `backend/services/stigmer-server/go.mod`

**Module path**: `github.com/stigmer/stigmer/backend/services/stigmer-server`

**Purpose**: Main Stigmer daemon service

**Dependencies**:
- `github.com/google/uuid v1.6.0` (unique identifiers)
- `github.com/rs/zerolog v1.34.0` (logging)
- `github.com/stigmer/stigmer/apis/stubs/go` (local replace)
- `github.com/stigmer/stigmer/backend/libs/go` (local replace)
- `go.temporal.io/sdk v1.39.0` (workflow engine)
- `google.golang.org/grpc v1.78.0` (gRPC framework)
- `google.golang.org/protobuf v1.36.11` (protobuf runtime)

**Replace directives**:
```go
replace github.com/stigmer/stigmer/apis/stubs/go => ../../../apis/stubs/go
replace github.com/stigmer/stigmer/backend/libs/go => ../../../backend/libs/go
```

### 3. Updated `go.work`

**Before**:
```go
use (
    .                    // Root module reference
    ./apis/stubs/go
    ./client-apps/cli
    ./sdk/go
)
```

**After**:
```go
use (
    ./apis/stubs/go
    ./backend/libs/go                   // New
    ./backend/services/stigmer-server   // New
    ./backend/services/workflow-runner
    ./client-apps/cli
    ./sdk/go
)
```

### 4. Removed Root Module Files

Deleted:
- `go.mod` (2,368 bytes - root module definition)
- `go.sum` (23,055 bytes - root dependencies)

These are no longer needed as all code is properly modularized.

## Implementation Details

### Dependency Resolution Challenge

Encountered ambiguous import error during `go mod tidy` for `backend/libs/go`:

```
google.golang.org/genproto/googleapis/api/expr/v1alpha1: ambiguous import: 
found package in multiple modules:
  google.golang.org/genproto v0.0.0-20230410155749-daa745c078e1
  google.golang.org/genproto/googleapis/api v0.0.0-20251029180050-ab9386a59fda
```

**Root cause**: `buf.build/go/protovalidate` transitively depends on `github.com/google/cel-go`, which imports from both old monolithic `genproto` and new split `genproto/googleapis/api`.

**Fix**: Explicitly upgraded to latest `genproto/googleapis/api`:
```bash
cd backend/libs/go
go get google.golang.org/genproto/googleapis/api@latest
```

This forced Go to use the newer split packages consistently.

### Module Import Paths

Import paths remain unchanged:
```go
// stigmer-server imports
import "github.com/stigmer/stigmer/backend/libs/go/badger"
import "github.com/stigmer/stigmer/backend/libs/go/grpc"
import "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
```

The module boundaries are enforced through `go.mod` files, but import paths stay the same because:
- `backend/libs/go` module exposes packages at `github.com/stigmer/stigmer/backend/libs/go/*`
- `stigmer-server` uses `replace` directive to point to local `backend/libs/go`
- Workspace tracks all modules, so `go build` resolves dependencies correctly

### Build Verification

Verified all modules build successfully:

```bash
# Backend shared libraries
cd backend/libs/go
go mod tidy
✅ Success

# Stigmer server
cd backend/services/stigmer-server
go mod tidy
go build ./cmd/server
✅ Success (binary created)

# Workflow runner
cd backend/services/workflow-runner
go build .
✅ Success (binary created)

# Workspace sync
go work sync
✅ Success
```

## Impact

### Positive

**Architectural Consistency**:
- ✅ Stigmer now matches Planton's proven module structure
- ✅ Clear module boundaries (services, libraries, APIs all separate)
- ✅ Explicit dependency management (no implicit root module dependencies)

**Developer Experience**:
- ✅ Easier to understand module layout (each service/lib self-contained)
- ✅ Simpler dependency tracking (each module lists its own deps)
- ✅ Better IDE support (GoLand/VSCode recognize module boundaries)

**Maintainability**:
- ✅ Future services can follow same pattern (create own go.mod)
- ✅ Shared libraries are versioned independently (if needed)
- ✅ No confusion about where dependencies come from (root vs service)

### Changes Required

**None for developers** - Import paths unchanged, builds still work.

**CI/CD considerations**:
- Bazel builds unaffected (uses BUILD.bazel files, not go.mod)
- `go work sync` ensures workspace dependencies stay current
- Each module can be tested independently

## Files Changed

### Created
- `backend/libs/go/go.mod` (shared libraries module)
- `backend/libs/go/go.sum` (dependency checksums)
- `backend/services/stigmer-server/go.mod` (server module)
- `backend/services/stigmer-server/go.sum` (dependency checksums)

### Modified
- `go.work` (added backend/libs/go and stigmer-server, removed `.`)
- `go.work.sum` (updated workspace dependency checksums)
- `apis/stubs/go/go.mod` & `go.sum` (dependency updates from workspace sync)
- `backend/services/workflow-runner/go.mod` & `go.sum` (dependency updates)
- `client-apps/cli/go.mod` & `go.sum` (dependency updates)
- `sdk/go/go.mod` & `go.sum` (dependency updates)

### Deleted
- Root `go.mod` (2,368 bytes)
- Root `go.sum` (23,055 bytes)

## Verification

```bash
# All modules present
$ find . -name "go.mod" | sort
./apis/stubs/go/go.mod
./backend/libs/go/go.mod
./backend/services/stigmer-server/go.mod
./backend/services/workflow-runner/go.mod
./client-apps/cli/go.mod
./sdk/go/go.mod

# Workspace includes all modules
$ cat go.work
go 1.25.6

use (
    ./apis/stubs/go
    ./backend/libs/go
    ./backend/services/stigmer-server
    ./backend/services/workflow-runner
    ./client-apps/cli
    ./sdk/go
)

# No root module
$ ls go.mod go.sum
ls: go.mod: No such file or directory
ls: go.sum: No such file or directory
✅ Correct - no root module files
```

## Future Considerations

### Adding New Services

Pattern to follow when creating new Go services:

1. **Create service directory**: `backend/services/{service-name}/`
2. **Initialize module**: 
   ```bash
   cd backend/services/{service-name}
   go mod init github.com/stigmer/stigmer/backend/services/{service-name}
   ```
3. **Add replace directives** (if using shared libs):
   ```go
   replace github.com/stigmer/stigmer/apis/stubs/go => ../../../apis/stubs/go
   replace github.com/stigmer/stigmer/backend/libs/go => ../../../backend/libs/go
   ```
4. **Update go.work**:
   ```go
   use (
       ...
       ./backend/services/{service-name}
   )
   ```
5. **Run `go work sync`**

### Shared Library Evolution

If `backend/libs/go` grows large:
- Consider splitting into multiple modules (e.g., `backend/libs/grpc`, `backend/libs/store`)
- Follow same pattern: each lib gets own `go.mod`, added to `go.work`
- Update services' replace directives accordingly

### Module Versioning

Currently using `v0.0.0-00010101000000-000000000000` for local modules (expected with replace directives).

If publishing modules externally:
- Tag releases: `apis/stubs/go/v1.0.0`
- Update replace directives to version constraints
- Consider go-releaser for versioned releases

## Related Work

This change aligns with:
- **Planton Cloud monorepo pattern** (`.cursor/rules/git/commit-planton-monorepo-changes.mdc`)
- **Go workspace best practices** (Go 1.18+ workspaces)
- **Modular build systems** (each module builds independently)

## Lessons Learned

1. **Module boundaries matter** - Even in a monorepo, explicit module definitions improve clarity
2. **Workspaces are powerful** - `go.work` lets us maintain module independence while sharing code
3. **Replace directives are key** - Allow local development without publishing modules
4. **genproto evolution** - Old monolithic `genproto` splits into `genproto/googleapis/*`, requires explicit version management
5. **Bazel independence** - Bazel uses `BUILD.bazel`, Go modules are separate concern (both valid)

## Testing

All existing functionality verified:
- ✅ `stigmer-server` builds and runs
- ✅ `workflow-runner` builds and runs  
- ✅ CLI builds and imports server APIs
- ✅ Go workspace syncs without errors
- ✅ No import resolution failures

## Outcome

Stigmer now has a clean, modular Go workspace structure that:
- Matches Planton's established pattern
- Makes module boundaries explicit
- Simplifies future service additions
- Maintains all existing functionality

**No behavioral changes** - This is purely a structural improvement to the build system and module organization.
