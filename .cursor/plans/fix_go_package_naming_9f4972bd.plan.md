---
name: Fix Go Package Naming
overview: The current `sdk/go/context/` directory with `package stigmer` violates Go convention. Following Pulumi's pattern, we should consolidate into a single `stigmer/` package.
todos:
  - id: move-context-files
    content: Move all files from sdk/go/context/ to sdk/go/stigmer/
    status: completed
  - id: merge-doc-files
    content: Merge context/doc.go documentation into stigmer/doc.go
    status: completed
  - id: update-imports
    content: Update all import statements across the codebase
    status: completed
  - id: delete-context-dir
    content: Delete the empty sdk/go/context/ directory
    status: completed
isProject: false
---

# Fix Go Package Naming Anti-Pattern

## The Problem

The current structure violates Go's package naming convention:

```
sdk/go/context/          <-- directory named "context"
  └── context.go         <-- package stigmer (NOT "context")
```

**Go Convention**: The directory name should match the package name. When you `import "github.com/stigmer/stigmer/sdk/go/context"`, Go developers expect to get a `context` package, not `stigmer`.

This is confusing because:

1. Import path says `context`, but you use `stigmer.Context`
2. Conflicts conceptually with Go's standard library `context` package
3. Makes code navigation unintuitive

## How Pulumi Solves This

Pulumi keeps everything in a single `pulumi` package:

```
sdk/go/pulumi/           <-- directory named "pulumi"
  ├── context.go         <-- package pulumi (defines pulumi.Context)
  ├── run.go             <-- package pulumi (defines pulumi.Run)
  └── ...                <-- all core types in same package
```

**Key patterns**:

1. Directory name matches package name: `pulumi/` contains `package pulumi`
2. `pulumi.Context` embeds standard library `context.Context` as a field
3. Accessor method `func (ctx *Context) Context() context.Context` exposes it
4. Usage: `pulumi.Run(func(ctx *pulumi.Context) error { ... })`

## Recommended Solution

Consolidate all files from `sdk/go/context/` into `sdk/go/stigmer/`:

**Current (Anti-Pattern)**:

```
sdk/go/
├── context/             # directory name doesn't match package
│   ├── context.go       # package stigmer
│   ├── refs.go
│   └── naming/
└── stigmer/
    └── doc.go           # package stigmer (duplicate!)
```

**Proposed (Pulumi-Aligned)**:

```
sdk/go/
└── stigmer/             # directory matches package name
    ├── context.go       # package stigmer
    ├── refs.go          # package stigmer
    ├── doc.go           # package stigmer (consolidated)
    └── naming/          # can be internal subpackage
        └── slug.go
```

## Files to Move

From `[sdk/go/context/](sdk/go/context/)` to `[sdk/go/stigmer/](sdk/go/stigmer/)`:


| Source File               | Destination                          |
| ------------------------- | ------------------------------------ |
| `context/context.go`      | `stigmer/context.go`                 |
| `context/context_test.go` | `stigmer/context_test.go`            |
| `context/refs.go`         | `stigmer/refs.go`                    |
| `context/refs_test.go`    | `stigmer/refs_test.go`               |
| `context/doc.go`          | Merge into existing `stigmer/doc.go` |
| `context/naming/`         | `stigmer/naming/` (internal)         |


## Import Path Changes

```go
// Before (confusing)
import "github.com/stigmer/stigmer/sdk/go/context"
ctx := &stigmer.Context{}  // package "context" gives "stigmer"???

// After (clear)
import "github.com/stigmer/stigmer/sdk/go/stigmer"
ctx := &stigmer.Context{}  // package "stigmer" gives "stigmer" ✓
```

## Alternative: Use `internal/context`

If you want to keep "context" in the path for semantic reasons, use Go's `internal` convention:

```
sdk/go/
├── stigmer/
│   └── doc.go           # public API
└── internal/
    └── context/         # internal only, no export conflict
        └── context.go   # package context (or package stigmerctx)
```

However, this adds indirection. The Pulumi-aligned single-package approach is cleaner.

## Summary

- **Root cause**: Directory name `context/` doesn't match package name `stigmer`
- **Go convention**: Directory name should match package name
- **Pulumi pattern**: Single `pulumi/` package with all core types
- **Recommendation**: Move all `context/*` files into `stigmer/` directory

