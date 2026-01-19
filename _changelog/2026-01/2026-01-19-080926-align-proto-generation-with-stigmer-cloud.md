# Align Proto Generation with Stigmer Cloud

**Date**: 2026-01-19
**Type**: Build System / Proto Generation
**Scope**: apis/, backend/, client-apps/, sdk/
**Impact**: Major - Unified proto generation across Stigmer projects

## Problem

Go protocol buffer stubs were being generated in `internal/gen` instead of `apis/stubs/go`, causing:
- Inconsistency with Stigmer Cloud project structure
- Build errors and compilation failures
- Confusion about where generated code lives
- Maintenance overhead from different patterns

## Root Cause Analysis

The proto generation system had multiple interconnected issues:

1. **buf.gen.go.yaml Configuration**
   - Output directory: `../internal/gen` (wrong)
   - Package prefix: `github.com/stigmer/stigmer/internal/gen` (wrong)
   - Should match Stigmer Cloud pattern: `stubs/go`

2. **Makefile Hardcoding**
   - `GO_STUBS_DIR := ../internal/gen` hardcoded in `apis/Makefile`
   - Fix structure target referenced old nested path
   - go.mod creation target used wrong module path

3. **Missing go.mod**
   - No separate go.mod in stubs directory
   - Stigmer Cloud has `apis/stubs/go/go.mod` as separate module
   - This separation prevents nested directory issues

4. **Codebase Imports**
   - 409 import statements across codebase used old path
   - Some incorrect imports added during development:
     - `apis/stubs/go/ai/stigmer/commons/apiresource/v1` (wrong - no `/v1`)
     - `backend/libs/go/store/badger` (wrong - should be `backend/libs/go/badger`)
     - `backend/libs/go/prototime` (doesn't exist - should use `timestamppb`)

## Solution

### 1. Updated buf.gen.go.yaml

Changed configuration to match Stigmer Cloud:

**Before:**
```yaml
go_package_prefix: github.com/stigmer/stigmer/internal/gen
plugins:
  - remote: buf.build/protocolbuffers/go:v1.36.6
    out: ../internal/gen
  - remote: buf.build/grpc/go:v1.5.1
    out: ../internal/gen
```

**After:**
```yaml
go_package_prefix: github.com/stigmer/stigmer/apis/stubs/go
plugins:
  - remote: buf.build/protocolbuffers/go:v1.36.6
    out: stubs/go
  - remote: buf.build/grpc/go:v1.5.1
    out: stubs/go
```

### 2. Updated apis/Makefile

Changed three critical variables and targets:

**GO_STUBS_DIR:**
```makefile
# Before
GO_STUBS_DIR := ../internal/gen

# After
GO_STUBS_DIR := stubs/go
```

**go-stubs-fix-structure target:**
```makefile
# Before
mv $(GO_STUBS_DIR)/github.com/stigmer/stigmer/internal/gen/* $(GO_STUBS_DIR)/

# After
mv $(GO_STUBS_DIR)/github.com/stigmer/stigmer/apis/stubs/go/* $(GO_STUBS_DIR)/
```

**go-stubs-ensure-gomod target:**
```makefile
# Before
module github.com/stigmer/stigmer/internal/gen

# After
module github.com/stigmer/stigmer/apis/stubs/go
```

### 3. Created Separate go.mod for Stubs

Added `apis/stubs/go/go.mod`:

```go
module github.com/stigmer/stigmer/apis/stubs/go

go 1.24.0

require (
	buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go v1.36.11-20251209175733-2a1774d88802.1
	google.golang.org/grpc v1.78.0
	google.golang.org/protobuf v1.36.11
)
```

This makes `apis/stubs/go` a separate Go module, preventing buf from creating nested directory structures.

### 4. Updated All Imports

Global find-and-replace across codebase:

```bash
# Updated 409 import statements
s|github.com/stigmer/stigmer/internal/gen|github.com/stigmer/stigmer/apis/stubs/go|g
```

### 5. Fixed Incorrect Imports

**Fixed incorrect proto import:**
```go
// Before
import apiresourcev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/v1"

// After
import apiresourcev1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
```

**Fixed badger store import:**
```go
// Before
import "github.com/stigmer/stigmer/backend/libs/go/store/badger"

// After
import "github.com/stigmer/stigmer/backend/libs/go/badger"
```

**Fixed prototime usage:**
```go
// Before
import "github.com/stigmer/stigmer/backend/libs/go/prototime"
updated.Status.Audit.StatusAudit.UpdatedAt = prototime.Now()

// After
import "google.golang.org/protobuf/types/known/timestamppb"
updated.Status.Audit.StatusAudit.UpdatedAt = timestamppb.Now()
```

### 6. Updated Root go.mod

Added replace directive to point to local stubs module:

```go
replace github.com/stigmer/stigmer/apis/stubs/go => ./apis/stubs/go
```

## Changes

### Configuration Files
- `apis/buf.gen.go.yaml` - Updated output paths and package prefix
- `apis/Makefile` - Updated GO_STUBS_DIR and related targets
- `apis/stubs/go/go.mod` - Created (new file)
- `apis/stubs/go/go.sum` - Created (new file)
- `go.mod` - Added replace directive

### Go Source Files (409 imports updated)

**Backend Libraries:**
- `backend/libs/go/apiresource/*.go`
- `backend/libs/go/badger/*.go`
- `backend/libs/go/grpc/interceptors/apiresource/*.go`
- `backend/libs/go/grpc/request/pipeline/steps/*.go`
- `backend/libs/go/sqlite/*.go`

**Backend Services:**
- `backend/services/stigmer-server/cmd/server/*.go`
- `backend/services/stigmer-server/pkg/controllers/**/*.go`
- `backend/services/stigmer-server/pkg/downstream/**/*.go`

**Client Apps:**
- `client-apps/cli/cmd/stigmer/root/*.go`
- `client-apps/cli/internal/cli/backend/*.go`

**SDK:**
- `sdk/go/examples/*.go`
- `sdk/go/internal/synth/*.go`

## Verification

After regenerating protos:

```bash
# Directory structure
$ ls -la apis/stubs/go/
drwxr-xr-x  5 suresh  staff   160 Jan 19 08:05 .
drwxr-xr-x  4 suresh  staff   128 Jan 19 08:05 ..
drwxr-xr-x  3 suresh  staff    96 Jan 19 08:05 ai/
-rw-r--r--  1 suresh  staff   458 Jan 19 08:05 go.mod
-rw-r--r--  1 suresh  staff  3421 Jan 19 08:05 go.sum

# internal/gen eliminated
$ ls -la internal/
total 0
drwxr-xr-x   2 suresh  staff    64 Jan 19 08:04 .
drwxr-xr-x  40 suresh  staff  1280 Jan 19 07:51 ..

# Import counts
Old internal/gen imports: 0
New apis/stubs/go imports: 409

# Build verification
$ go mod tidy
# Exit code 0 - success
```

## Impact

### Benefits

1. **Consistency** - Stigmer OSS and Stigmer Cloud now use identical proto generation pattern
2. **Clarity** - `apis/stubs/go` clearly indicates generated API stubs, not internal code
3. **Modularity** - Separate go.mod allows stubs to be a distinct Go module
4. **Maintainability** - Single source of truth for proto generation configuration
5. **Bazel Integration** - Gazelle can properly generate BUILD.bazel files for stubs
6. **Developer Experience** - Clear separation between source protos and generated stubs

### Migration

No manual migration needed. Developers just need to:
1. Run `make protos` to regenerate stubs
2. Imports are already updated in this change
3. `internal/gen` directory will not be created anymore

### Future Maintenance

When updating proto generation:
1. Run `make protos` from root directory
2. Verify stubs generated in `apis/stubs/go/ai/stigmer/...`
3. Verify `internal/gen` is NOT created
4. Run Gazelle to update BUILD.bazel files
5. Verify imports are `github.com/stigmer/stigmer/apis/stubs/go/...`

## Files Changed

**Configuration (5 files):**
- apis/buf.gen.go.yaml
- apis/Makefile
- apis/stubs/go/go.mod (new)
- apis/stubs/go/go.sum (new)
- go.mod (added replace directive)

**Source Code (130+ files):**
- All files with proto imports updated from internal/gen to apis/stubs/go
- Fixed incorrect imports (apiresource/v1, store/badger, prototime)

## Documentation

Created comprehensive documentation:
- `_projects/2026-01/20260119.05.managed-local-temporal-runtime/PROTO_GENERATION_FIX.md`

This document provides:
- Problem analysis and root cause
- Detailed solution with before/after comparisons
- Verification steps
- Why this matters for project consistency
- Future maintenance guidelines

## Related

- **Stigmer Cloud Pattern**: This change aligns with github.com/leftbin/stigmer-cloud/apis/buf.gen.go.yaml
- **Buf Documentation**: https://buf.build/docs/generate/managed-mode
- **Go Modules**: Separate module at `apis/stubs/go` enables clean package structure
