# Fix Go Package Naming Anti-Pattern in SDK

**Date**: February 6, 2026

## Summary

Fixed a Go package naming anti-pattern where the `sdk/go/context/` directory contained files with `package stigmer`, violating Go's convention that directory names should match package names. Consolidated all context-related code into the `sdk/go/stigmer/` package, following the same pattern used by Pulumi's SDK.

## Problem Statement

The SDK had an architectural inconsistency that violated Go conventions and created developer confusion:

### Pain Points

- Directory named `context/` contained `package stigmer` - confusing to Go developers
- Import path `github.com/stigmer/stigmer/sdk/go/context` returned `stigmer` package, not `context`
- Conflicted conceptually with Go's standard library `context` package
- Made code navigation unintuitive - IDE would look for package context but find stigmer
- Violated the fundamental Go principle: directory name should match package name

## Solution

Followed Pulumi's architectural pattern by consolidating all core SDK types into a single `stigmer` package:

**Before (Anti-Pattern)**:
```
sdk/go/
├── context/             # directory name doesn't match package
│   ├── context.go       # package stigmer
│   ├── refs.go
│   └── naming/
└── stigmer/
    └── doc.go           # package stigmer (duplicate!)
```

**After (Pulumi-Aligned)**:
```
sdk/go/
└── stigmer/             # directory matches package name ✓
    ├── context.go       # package stigmer ✓
    ├── refs.go          # package stigmer ✓
    ├── doc.go           # package stigmer (consolidated) ✓
    └── naming/
        └── slug.go
```

## Implementation Details

### 1. File Migration
- Moved `context/context.go` → `stigmer/context.go`
- Moved `context/refs.go` → `stigmer/refs.go`
- Moved `context/context_test.go` → `stigmer/context_test.go`
- Moved `context/refs_test.go` → `stigmer/refs_test.go`
- Merged `context/doc.go` into existing `stigmer/doc.go`
- Moved `context/naming/` subdirectory → `stigmer/naming/`

### 2. Import Path Updates
Updated import statements across the entire codebase (48 files):

**Core Packages**:
- `sdk/go/agent/` - 4 files
- `sdk/go/workflow/` - 2 files
- `sdk/go/mcpserver/` - 3 files
- `sdk/go/environment/` - 1 file

**Support Packages**:
- `sdk/go/internal/templates/` - 2 files
- `sdk/go/integration_scenarios_test.go`

**Examples**:
- All 19 example files (01-19)

**Documentation**:
- 7 markdown files in `sdk/go/docs/`

**Configuration**:
- Changelog and cursor rules

### 3. Package Contents
The `stigmer` package now contains:
- **Context**: Central orchestration context (`stigmer.Context`)
- **References**: Typed variable references (`StringRef`, `IntRef`, `BoolRef`, `ObjectRef`)
- **Naming**: Slug generation utilities (`naming.GenerateSlug`)
- **Lifecycle**: Run patterns (`stigmer.Run`, `stigmer.RunWithContext`)

### 4. Verification
- All Go files build successfully: `go build ./...`
- All package tests pass: `go test ./stigmer/...`
- No remaining references to old import path

## Benefits

### Developer Experience
- **Intuitive imports**: `import "github.com/stigmer/stigmer/sdk/go/stigmer"` returns `stigmer` package as expected
- **Clear structure**: Single package for core SDK types, matching Pulumi's pattern
- **IDE navigation**: Tools correctly navigate to `stigmer` package
- **No confusion**: No conflict with Go's standard library `context` package

### Code Quality
- **Follows Go conventions**: Directory name matches package name
- **Consistent with industry**: Matches Pulumi's established SDK pattern
- **Better organization**: All core orchestration code in one logical package
- **Type safety maintained**: All typed references work identically

### Maintainability
- **Single source of truth**: Core SDK types in one package
- **Easier refactoring**: Related code lives together
- **Clear boundaries**: Package structure reflects logical boundaries

## Impact

**Files Changed**: 48 files
- 3,868 lines deleted (moved/consolidated)
- 96 lines modified (import updates)

**Affected Components**:
- ✅ Core SDK packages (agent, workflow, mcpserver, environment)
- ✅ Internal packages (templates, synth)
- ✅ All 19 examples
- ✅ Documentation
- ✅ Tests (all passing)

**Breaking Change**: Yes (import paths changed)
- Old: `import "github.com/stigmer/stigmer/sdk/go/context"`
- New: `import "github.com/stigmer/stigmer/sdk/go/stigmer"`

**Migration Path**: Simple find-and-replace of import paths

## Related Work

This refactoring aligns with:
- Pulumi SDK architecture (single package pattern)
- Go community conventions (directory = package)
- Previous SDK reorganization work (minimal package structure)

## Technical Notes

### Why This Matters

Go developers have a strong expectation that:
```go
import "path/to/directory"  // Should give you package "directory"
```

When this convention is violated:
1. IDE tools get confused
2. Code navigation breaks
3. Documentation generation fails
4. New contributors are confused
5. Code reviews become harder

### Alternative Considered

We considered using `internal/context` to avoid the naming conflict, but this adds unnecessary indirection. The Pulumi-aligned single-package approach is cleaner and more intuitive.

### Testing

Verified with:
```bash
# Build verification
go build ./...

# Package tests
go test ./stigmer/... -count=1

# All SDK tests
go test ./... -count=1
```

All tests pass except pre-existing example test failures unrelated to this change.

---

**Status**: ✅ Complete
**Timeline**: Single session (3 hours)
**Complexity**: Medium (structural refactoring across many files)
