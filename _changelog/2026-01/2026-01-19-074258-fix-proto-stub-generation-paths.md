# Fix Proto Stub Generation Paths and Add Release-Local Command

**Date:** 2026-01-19  
**Type:** Fix + Feature  
**Scope:** Build System, Proto Generation, CLI

## Summary

Fixed proto stub generation path from `apis/stubs/go` → `internal/gen` to match backend import statements, eliminating gazelle errors during `make protos`. Also added `release-local` Make target for rapid local CLI testing.

## Problem

Running `make protos` produced numerous gazelle warnings about missing packages:

```
gazelle: finding module path for import github.com/stigmer/stigmer/internal/gen/ai/stigmer/...
go: module github.com/stigmer/stigmer@upgrade found (...), but does not contain package ...
```

**Root cause:** Proto generation was moved from `internal/gen` to `apis/stubs/go`, but backend code still imported from `internal/gen`, creating a mismatch.

Additionally, there was no quick way to rebuild and install the CLI for local testing without regenerating protos (which is slow).

## Solution

### 1. Proto Generation Path Fix

**Changed proto generation to output to `internal/gen`:**

- `apis/buf.gen.go.yaml`: Updated `go_package_prefix` and output paths
- `apis/Makefile`: Updated `GO_STUBS_DIR` from `stubs/go` to `../internal/gen`
- Fixed directory structure cleanup paths
- Updated go.mod module name to match new path

**Updated all import statements across codebase:**

Files updated (6 files):
- `client-apps/cli/cmd/stigmer/root/workflow.go`
- `client-apps/cli/cmd/stigmer/root/agent.go`
- `client-apps/cli/internal/cli/backend/client.go`
- `sdk/go/internal/synth/converter.go`
- `sdk/go/internal/synth/workflow_converter.go`
- `sdk/go/examples/examples_test.go`

Changed from:
```go
import agentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/agent/v1"
```

To:
```go
import agentv1 "github.com/stigmer/stigmer/internal/gen/ai/stigmer/agentic/agent/v1"
```

**Updated CLI module configuration:**

`client-apps/cli/go.mod`:
- Updated replace directive from `apis/stubs/go` → `internal/gen`
- Updated dependency import path
- Ran `go mod tidy`

### 2. CLI Build Fixes

**Root Makefile (`Makefile`):**

Fixed build command to run from CLI directory since it's a separate Go module:

```makefile
# Before:
go build -o bin/stigmer ./cmd/stigmer

# After:
cd client-apps/cli && go build -o ../../bin/stigmer .
```

Also updated `dev` target similarly.

**Why:** The CLI is in a separate Go module (`client-apps/cli/`), so `go build` must run from that directory, not the repo root.

### 3. Added `release-local` Command

**New Make target for fast local CLI installation:**

```makefile
release-local: ## Build and install CLI for local testing (fast rebuild without protos)
    # 1. Remove old binaries
    # 2. Build fresh CLI binary
    # 3. Install to ~/bin (no sudo required!)
    # 4. Verify installation
```

**Key features:**
- ⚡ **Fast** - Skips proto generation (use `make protos` separately if needed)
- 🔒 **No sudo** - Installs to `~/bin` instead of `/usr/local/bin`
- 🧪 **Perfect for testing** - Quick rebuild and replace workflow
- 📝 **Helpful output** - Shows installation status and instructions

**Usage:**
```bash
make release-local
```

**Output:**
```
============================================
Building and Installing Stigmer CLI Locally
============================================

Step 1: Removing old binaries...
✓ Old binaries removed

Step 2: Building fresh CLI binary...
✓ Build complete: bin/stigmer

Step 3: Installing to ~/bin...
✓ Installed: /Users/suresh/bin/stigmer

============================================
✓ Release Complete!
============================================

✓ CLI ready! Run: stigmer --help

Note: Run 'make protos' first if you need to regenerate proto stubs
```

Also updated `install` target to use `sudo` for system-wide installation to `/usr/local/bin`.

## Technical Details

### Proto Generation Flow

**Before:**
```
make protos
  ↓
buf generate
  ↓
Output: apis/stubs/go/ai/stigmer/**/*.pb.go
  ↓
go_package_prefix: github.com/stigmer/stigmer/apis/stubs/go
```

Backend imports: `github.com/stigmer/stigmer/internal/gen/...` ❌ Mismatch!

**After:**
```
make protos
  ↓
buf generate
  ↓
Output: internal/gen/ai/stigmer/**/*.pb.go
  ↓
go_package_prefix: github.com/stigmer/stigmer/internal/gen
```

Backend imports: `github.com/stigmer/stigmer/internal/gen/...` ✅ Match!

### CLI Build Architecture

The CLI is a **separate Go module** in `client-apps/cli/`:

```
stigmer/                          (main module: github.com/stigmer/stigmer)
├── go.mod
├── client-apps/cli/              (separate module: github.com/stigmer/stigmer/client-apps/cli)
│   ├── go.mod                    (with replace directives to parent)
│   ├── main.go                   (package main)
│   └── cmd/stigmer/
│       └── root.go               (package stigmer - not main!)
```

**Why separate module:**
- CLI has different dependencies than backend services
- Uses replace directives to reference parent module and generated stubs
- Allows independent versioning and dependency management

**Build must run from CLI directory:**
```bash
cd client-apps/cli && go build -o ../../bin/stigmer .
```

Not from root:
```bash
go build -o bin/stigmer ./client-apps/cli/cmd/stigmer  # ❌ Fails!
```

### Gazelle BUILD.bazel Updates

All BUILD.bazel files automatically updated by gazelle to reference new import paths:

```python
# Before:
go_library(
    deps = [
        "//apis/stubs/go/ai/stigmer/agentic/agent/v1:agent",
    ],
)

# After:
go_library(
    deps = [
        "//internal/gen/ai/stigmer/agentic/agent/v1:agent",
    ],
)
```

## Impact

### Positive
- ✅ **Build system fixed** - `make protos` completes without gazelle errors
- ✅ **Import consistency** - All code uses `internal/gen` path uniformly
- ✅ **Faster local testing** - `release-local` command enables rapid iteration
- ✅ **No sudo prompts** - `release-local` installs to `~/bin` without sudo
- ✅ **Clear documentation** - Make targets have helpful output and instructions

### Changes Required
- ⚠️ **Developers must regenerate stubs** - Run `make protos` after pulling
- ⚠️ **PATH configuration** - Ensure `~/bin` is in PATH for `release-local`
- ⚠️ **Git cleanup** - Old `apis/stubs/go/` directory removed (in .gitignore)

## Files Changed

### Proto Generation (4 files)
- `apis/buf.gen.go.yaml` - Output paths and go_package_prefix
- `apis/Makefile` - GO_STUBS_DIR and directory cleanup logic

### Import Path Updates (6 files)
- `client-apps/cli/cmd/stigmer/root/workflow.go`
- `client-apps/cli/cmd/stigmer/root/agent.go`
- `client-apps/cli/internal/cli/backend/client.go`
- `sdk/go/internal/synth/converter.go`
- `sdk/go/internal/synth/workflow_converter.go`
- `sdk/go/examples/examples_test.go`

### CLI Module (1 file)
- `client-apps/cli/go.mod` - Replace directive and dependency path

### Build System (1 file)
- `Makefile` - CLI build commands and release-local target

### Auto-Generated (33 BUILD.bazel files)
- All BUILD.bazel files updated by gazelle with new import paths

## Testing

### Verification Steps

1. **Proto generation:**
```bash
make protos
# ✓ BUILD.bazel files generated
# ✓ Go stubs generated successfully
# ✓ Python stubs generated successfully
```

2. **CLI build:**
```bash
make build
# ✓ Build complete: bin/stigmer
```

3. **CLI execution:**
```bash
./bin/stigmer --help
# ✓ CLI runs successfully
```

4. **Local release:**
```bash
make release-local
# ✓ Installed: ~/bin/stigmer
# ✓ CLI ready!
```

### Known Warnings

Remaining gazelle warnings (non-critical):
```
gazelle: finding module path for import github.com/stigmer/stigmer/backend/libs/go/store/badger
gazelle: finding module path for import github.com/stigmer/stigmer/backend/libs/go/prototime
```

These are expected - local packages not in the published module. Does not affect proto generation.

## Rationale

**Why `internal/gen` instead of `apis/stubs/go`?**

1. **Convention** - `internal/` is Go convention for non-exported packages
2. **Backend alignment** - All backend services already import from `internal/gen`
3. **Simplicity** - One consistent path across entire codebase
4. **Bazel compatibility** - Works better with bazel's import path resolution

**Why `release-local` command?**

1. **Iteration speed** - Developers need quick CLI rebuilds for testing
2. **Proto independence** - Most CLI changes don't require proto regeneration
3. **No sudo friction** - Installing to `~/bin` avoids password prompts
4. **Developer UX** - Similar to stigmer-cloud's `release-cli-local` command

## Migration Notes

**For developers pulling this change:**

1. Clean old generated code:
```bash
rm -rf apis/stubs/go/
```

2. Regenerate proto stubs:
```bash
make protos
```

3. Rebuild CLI:
```bash
make build
```

Or use new quick command:
```bash
make release-local
```

**Ensure `~/bin` is in PATH:**
```bash
export PATH="$HOME/bin:$PATH"
```

Add to `.zshrc` or `.bashrc` for persistence.

## Related Work

- Issue #TBD - Gazelle errors during proto generation
- PR #TBD - Fix proto stub generation paths

## Future Improvements

- [ ] Consider adding `internal/gen/` to .gitignore (currently tracked)
- [ ] Add pre-commit hook to verify proto stubs are up-to-date
- [ ] Document proto generation architecture in `docs/`
- [ ] Add `make clean-protos` target to remove generated stubs

---

**Work completed:** 2026-01-19  
**Next steps:** Continue with zero-config local daemon implementation
