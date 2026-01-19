# Proto Generation Fix - Aligning with Stigmer Cloud

## Problem

Go protocol buffer stubs were being generated in `internal/gen` instead of `apis/stubs/go`, which was inconsistent with the Stigmer Cloud project and causing build errors.

## Root Cause

The proto generation configuration had multiple issues:

1. **buf.gen.go.yaml** - Configured to output to `../internal/gen` with package prefix `github.com/stigmer/stigmer/internal/gen`
2. **apis/Makefile** - Hardcoded `GO_STUBS_DIR := ../internal/gen`
3. **Go imports** - 195+ import statements across the codebase referenced `github.com/stigmer/stigmer/internal/gen`
4. **Missing go.mod** - No separate go.mod in the stubs directory (Stigmer Cloud has one)

## Solution

### 1. Updated buf.gen.go.yaml

Changed the Go package prefix and output directory to match Stigmer Cloud:

```yaml
# Before
go_package_prefix: github.com/stigmer/stigmer/internal/gen
out: ../internal/gen

# After  
go_package_prefix: github.com/stigmer/stigmer/apis/stubs/go
out: stubs/go
```

### 2. Updated apis/Makefile

Changed three key sections:

**GO_STUBS_DIR variable:**
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

### 3. Created go.mod for stubs

Added `apis/stubs/go/go.mod` with correct module path:

```go
module github.com/stigmer/stigmer/apis/stubs/go

go 1.24.0

require (
	buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go v1.36.11-20251209175733-2a1774d88802.1
	google.golang.org/grpc v1.78.0
	google.golang.org/protobuf v1.36.11
)
```

### 4. Updated all Go imports

Replaced 195+ import statements across the codebase:

```go
// Before
import "github.com/stigmer/stigmer/internal/gen/ai/stigmer/commons/apiresource"

// After
import "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
```

## Files Changed

### Configuration Files
- `apis/buf.gen.go.yaml` - Updated go_package_prefix and out paths
- `apis/Makefile` - Updated GO_STUBS_DIR and related targets
- `apis/stubs/go/go.mod` - Created (new file)
- `apis/stubs/go/go.sum` - Created (new file)

### Go Source Files (195 imports updated)
- `backend/libs/go/**/*.go` - Updated imports
- `backend/services/stigmer-server/**/*.go` - Updated imports
- `client-apps/cli/**/*.go` - Updated imports
- `sdk/go/**/*.go` - Updated imports

## Verification

After changes:

```bash
# Regenerate protos
make protos

# Verify directory structure
$ ls -la apis/stubs/go/
drwxr-xr-x  5 suresh  staff   160 Jan 19 08:04 .
drwxr-xr-x  4 suresh  staff   128 Jan 19 08:04 ..
drwxr-xr-x  3 suresh  staff    96 Jan 19 08:04 ai/
-rw-r--r--  1 suresh  staff   458 Jan 19 08:04 go.mod
-rw-r--r--  1 suresh  staff  3421 Jan 19 08:04 go.sum

# Verify internal/gen is empty
$ ls -la internal/
total 0
drwxr-xr-x   2 suresh  staff    64 Jan 19 08:04 .
drwxr-xr-x  40 suresh  staff  1280 Jan 19 07:51 ..

# Verify import paths in generated files
$ head -30 apis/stubs/go/ai/stigmer/commons/apiresource/io.pb.go
import (
	apiresourcekind "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"
	rpc "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/rpc"
	...
)
```

## Result

✅ Go stubs now generated at `apis/stubs/go/` matching Stigmer Cloud pattern
✅ Separate go.mod in stubs directory prevents nested path issues
✅ All imports updated to use new path
✅ `internal/gen` directory eliminated
✅ Proto generation works without errors
✅ Alignment with Stigmer Cloud project structure

## Why This Matters

1. **Consistency** - Both Stigmer OSS and Stigmer Cloud now use the same proto generation pattern
2. **Clarity** - `apis/stubs/go` makes it clear these are generated API stubs, not internal code
3. **Modularity** - Separate go.mod allows the stubs to be a distinct Go module
4. **Maintainability** - Easier to understand and update proto generation process
5. **Bazel Integration** - Gazelle can properly generate BUILD.bazel files for the stubs

## Future Maintenance

When updating proto generation:

1. Run `make protos` from the root directory
2. Verify stubs are generated in `apis/stubs/go/ai/stigmer/...`
3. Verify `internal/gen` is NOT created
4. Run Gazelle to update BUILD.bazel files
5. Verify imports are `github.com/stigmer/stigmer/apis/stubs/go/...`
