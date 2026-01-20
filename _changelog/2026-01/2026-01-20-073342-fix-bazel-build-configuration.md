# Fix Bazel Build Configuration Issues

**Date**: 2026-01-20  
**Type**: Bug Fix  
**Scope**: Build System  
**Impact**: Critical - Build was completely broken

## Problem

The `make build` command was failing with Bazel errors preventing any protobuf stub generation and compilation:

1. **Missing BUILD.bazel for apis/stubs/go**: Bazel's `go_deps` module extension couldn't load `//apis/stubs/go:go.mod` because the directory wasn't a valid Bazel package
2. **workflow-runner incorrectly ignored**: `backend/services/workflow-runner` was in `.bazelignore` but referenced in `go.work`, causing Bazel to treat it as a deleted package

## Root Cause

### Issue 1: Chicken-and-Egg Problem in Build Process

The `apis/Makefile` had a fundamental ordering issue:

```
go-stubs target flow:
1. go-stubs-clean → Removes entire stubs/go directory (including BUILD.bazel)
2. go-stubs-init → Creates directory only
3. buf generate → Generates Go code
4. go-stubs-ensure-gomod → Creates go.mod
5. go-stubs-generate-build-files → Runs `bazel run //:gazelle` to create BUILD files

Problem: Bazel evaluates go_deps extension from MODULE.bazel BEFORE step 5 runs
- MODULE.bazel references go.work
- go.work references ./apis/stubs/go
- Bazel tries to load go.mod from that package
- But BUILD.bazel doesn't exist yet (not created until step 5)
- Build fails before Gazelle ever runs
```

### Issue 2: Incorrect Bazel Package Exclusion

The `.bazelignore` file contained:
```
backend/services/workflow-runner
backend/services/agent-runner
```

But `go.work` referenced `backend/services/workflow-runner`, creating a conflict:
- Bazel saw it as a deleted package (ignored)
- But go_deps tried to load its go.mod (from go.work)
- Resulted in "Package is considered deleted" error

## Solution

### Fix 1: Create BUILD.bazel During Initialization

Modified `apis/Makefile` → `go-stubs-init` target to create both go.mod and BUILD.bazel **before** any Bazel commands run:

```makefile
.PHONY: go-stubs-init
go-stubs-init:
	@mkdir -p $(GO_STUBS_DIR)
	@# Create go.mod immediately for go.work reference
	@if [ ! -f "$(GO_STUBS_DIR)/go.mod" ]; then \
		echo 'module github.com/stigmer/stigmer/apis/stubs/go...' > $(GO_STUBS_DIR)/go.mod; \
	fi
	@# Create BUILD.bazel immediately to make it a valid Bazel package
	@echo '# Gazelle will automatically generate Go library rules...' > $(GO_STUBS_DIR)/BUILD.bazel
	@echo 'exports_files([' >> $(GO_STUBS_DIR)/BUILD.bazel
	@echo '    "go.mod",' >> $(GO_STUBS_DIR)/BUILD.bazel
	@echo '    "go.sum",' >> $(GO_STUBS_DIR)/BUILD.bazel
	@echo '])' >> $(GO_STUBS_DIR)/BUILD.bazel
```

**Why this works**:
- Both go.mod and BUILD.bazel exist when Bazel starts evaluating MODULE.bazel
- Bazel's go_deps extension can successfully load the package
- apis/stubs/go is a valid Bazel package from the start
- Gazelle can later regenerate/update BUILD.bazel with actual library rules

### Fix 2: Remove workflow-runner from .bazelignore

Updated `.bazelignore`:
```diff
 # Temporarily ignore these directories until we properly configure them
-backend/services/workflow-runner
 backend/services/agent-runner
```

**Why this works**:
- backend/services/workflow-runner is now a valid Bazel package
- go.work can reference it without conflict
- No more "considered deleted" errors

## Testing

After fixes, `make build` completes successfully:

```bash
$ make build
/Applications/Xcode.app/Contents/Developer/usr/bin/make -C apis build
buf lint
buf format -w
Cleaning Go stubs...
Generating Go stubs...
Fixing nested Go stubs directory structure...
✓ Directory structure fixed
go.mod exists, running go mod tidy...
✓ go.mod updated
Generating BUILD.bazel files for Go stubs...
# ... Bazel successfully loads packages and builds ...
✓ BUILD.bazel files generated
✓ Go stubs generated successfully
# ... Python stubs, CLI build all succeed ...
Build complete: bin/stigmer
```

## Impact

**Before**: Build completely broken - no development possible  
**After**: Clean build with all stubs and binaries generated successfully

## Files Modified

1. `apis/Makefile` - Updated `go-stubs-init` target to create BUILD.bazel and go.mod upfront
2. `.bazelignore` - Removed `backend/services/workflow-runner` entry

## Lessons Learned

### Bazel Module Extension Evaluation Timing

Bazel evaluates module extensions during the loading phase, **before** any build targets run. If a module extension references packages via go.work:
- Those packages MUST have BUILD files already present
- Cannot rely on build targets to create BUILD files "just in time"
- Initialization must create minimal BUILD files before invoking Bazel

### .bazelignore vs go.work Coherence

If a directory is in go.work, it cannot be in .bazelignore:
- go.work says "this is a Go module"
- .bazelignore says "this isn't a Bazel package"
- Bazel sees conflict and treats as deleted package
- Always ensure .bazelignore and go.work are coherent

### Chicken-and-Egg Problems in Build Systems

Build orchestration tools (Make, scripts) must be careful about ordering:
1. Identify what the build system needs during initialization
2. Create those artifacts first (minimal versions OK)
3. Then invoke build system to generate/update

Cannot rely on build system to create its own prerequisites.

## Related Issues

This resolves the user-reported build failure captured in `_cursor/error.md`.

## Future Considerations

**Potential Improvement**: The `go-stubs-init` target now creates a minimal BUILD.bazel that gets overwritten by Gazelle later. Consider:
- Documenting this pattern for other stub directories
- Adding comments explaining why BUILD.bazel is created twice (minimal → full)
- Ensuring Gazelle preserves any manual configurations in BUILD.bazel

**Monitoring**: Watch for similar issues if we add more stub directories or modify go.work

---

**Technical Debt**: None - this is the correct long-term solution

**Breaking Changes**: None - build now works as originally intended

**Migration Notes**: None required - existing checkouts just need `make build`
