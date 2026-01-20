# Fix Bazel Build Error in apis/stubs/go

**Date:** 2026-01-20  
**Scope:** Build Infrastructure  
**Type:** Bug Fix  
**Impact:** Unblocks proto stub generation and build process

## Problem

The `make build` command was failing with a Bazel error during proto stub generation:

```
ERROR: /private/var/tmp/_bazel_suresh/c184e094062f7624a18484347313d530/external/gazelle+/internal/bzlmod/go_mod.bzl:169:34: Traceback (most recent call last):
...
Error in path: Unable to load package for //apis/stubs/go:go.mod: BUILD file not found in any of the following directories. Add a BUILD file to a directory to mark it as a package.
 - apis/stubs/go
```

**Root cause**: The `apis/stubs/go` directory contained generated Go stub files and a `go.mod` file, but lacked a `BUILD.bazel` file. Bazel requires a BUILD file to recognize a directory as a valid package, even if it only contains generated code.

The build system was trying to reference `//apis/stubs/go:go.mod` during Gazelle's go_deps module extension evaluation, but couldn't resolve the package because no BUILD file existed to export the go.mod file.

## Solution

Created a minimal `BUILD.bazel` file in `apis/stubs/go/` that:

1. **Makes the directory a valid Bazel package** - Allows Bazel to recognize and reference it
2. **Exports go.mod and go.sum** - Makes these files available to other Bazel rules via `exports_files()`
3. **Enables Gazelle auto-generation** - Allows Gazelle to automatically generate Go library rules for the stub code

**File created**: `apis/stubs/go/BUILD.bazel`

```bazel
# Gazelle will automatically generate Go library rules for this directory
# This BUILD file makes the directory a valid Bazel package

exports_files([
    "go.mod",
    "go.sum",
])
```

## Why This Fix Works

**Bazel package system**:
- Bazel organizes code into packages (directories with BUILD files)
- To reference a file like `//apis/stubs/go:go.mod`, Bazel needs a BUILD file in that directory
- `exports_files()` makes files available to other Bazel targets

**Integration with build process**:
- The proto generation Makefile creates the `go.mod` file
- Gazelle needs to reference this go.mod to understand Go dependencies
- The BUILD file exports go.mod so Gazelle can access it
- Gazelle then generates additional Go library rules for the proto stubs

## Files Changed

**Created**:
- `apis/stubs/go/BUILD.bazel` - Minimal BUILD file to make directory a valid Bazel package

**Modified** (automatic by proto generation):
- `apis/stubs/go/go.mod` - Generated Go module definition
- `apis/stubs/go/go.sum` - Generated Go module checksums

## Verification

After adding the BUILD file, `make build` succeeds:

1. Proto compilation runs successfully
2. Go stubs are generated
3. Gazelle can reference `//apis/stubs/go:go.mod`
4. Build completes without errors

## Pattern for Future

**Rule**: Any directory that needs to be referenced as a Bazel package MUST have a BUILD.bazel file.

**For generated code directories**:
- Create a minimal BUILD.bazel with `exports_files()` for any files that need to be referenced
- Include a comment explaining that Gazelle will auto-generate library rules
- This pattern applies to all stub directories (Python, Java, TypeScript, etc.)

## Impact

- ✅ Unblocks `make build` and proto generation
- ✅ Enables Gazelle to manage Go dependencies for proto stubs
- ✅ Establishes pattern for other generated code directories
- ✅ No changes to generated code required
- ✅ Minimal maintenance (BUILD file is small and stable)

## Related

- **Build system**: Bazel + Gazelle
- **Proto generation**: `apis/Makefile`
- **Go module**: `apis/stubs/go/go.mod`
- **Similar pattern needed for**: `apis/stubs/python/`, `apis/stubs/java/`, etc. (if they become Bazel-referenced)
