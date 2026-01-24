# Migration Guide: Generated Code Structure (v0.3.0)

**Effective**: v0.3.0  
**Type**: Breaking Change (Import Paths)  
**Impact**: All SDK users must update imports

## What Changed

The Stigmer Go SDK reorganized generated code into a dedicated `gen/` directory structure for clarity and maintainability.

### Before (v0.2.0 and earlier)

Generated code was intermixed with hand-written code:

```
sdk/go/
├── workflow/
│   ├── workflow.go                    # Hand-written
│   ├── task.go                        # Hand-written
│   ├── forktaskconfig_task.go         # Generated (unclear!)
│   └── httpcalltaskconfig_task.go     # Generated (unclear!)
├── agent/
│   ├── agent.go                       # Hand-written
│   └── agentspec_args.go              # Generated (unclear!)
├── types/
│   ├── agentic_types.go               # Generated
│   └── commons_types.go               # Generated
```

**Problem**: Hard to distinguish generated vs hand-written files.

### After (v0.3.0+)

All generated code lives in `gen/` subdirectories:

```
sdk/go/
├── gen/                               # ALL generated code
│   ├── workflow/
│   │   ├── forktaskconfig.go          # Generated (obvious!)
│   │   └── httpcalltaskconfig.go      # Generated
│   ├── agent/
│   │   └── agentspec_args.go          # Generated
│   ├── skill/
│   │   └── skillspec_args.go          # Generated
│   └── types/
│       ├── agentic_types.go           # Generated
│       └── commons_types.go           # Generated
├── workflow/
│   ├── workflow.go                    # Hand-written (obvious!)
│   ├── task.go                        # Hand-written
│   └── gen_types.go                   # Type aliases
├── agent/
│   └── agent.go                       # Hand-written
```

**Benefit**: Immediately clear what's generated vs hand-written.

## Migration Steps

### 1. Update Import Paths

**Change all imports from:**

```go
import "github.com/stigmer/stigmer/sdk/go/types"
```

**To:**

```go
import "github.com/stigmer/stigmer/sdk/go/gen/types"
```

### 2. No API Changes

The actual API remains identical - only import paths changed:

```go
// Before
import "github.com/stigmer/stigmer/sdk/go/types"

branches := []*types.ForkBranch{
    {Name: "branch1", Do: tasks1},
}

// After
import "github.com/stigmer/stigmer/sdk/go/gen/types"

branches := []*types.ForkBranch{  // Usage unchanged!
    {Name: "branch1", Do: tasks1},
}
```

### 3. Update Your go.mod

```bash
go get github.com/stigmer/stigmer/sdk/go@latest
go mod tidy
```

## Automated Migration

Use this shell command to update all imports in your project:

```bash
# Update types imports
find . -name "*.go" -type f -exec sed -i '' \
  's|github.com/stigmer/stigmer/sdk/go/types|github.com/stigmer/stigmer/sdk/go/gen/types|g' {} +

# Verify changes
git diff

# Test your code
go build ./...
go test ./...
```

## What Stays the Same

**These imports DON'T change** (hand-written packages):

```go
import "github.com/stigmer/stigmer/sdk/go/workflow"   // ✅ Same
import "github.com/stigmer/stigmer/sdk/go/agent"      // ✅ Same
import "github.com/stigmer/stigmer/sdk/go/skill"      // ✅ Same
import "github.com/stigmer/stigmer/sdk/go/stigmer"    // ✅ Same
```

**Only generated types changed:**

```go
import "github.com/stigmer/stigmer/sdk/go/types"      // ❌ Old
import "github.com/stigmer/stigmer/sdk/go/gen/types"  // ✅ New
```

## Why This Change?

**Developer Experience:**
- Clear visual separation: `gen/` = generated, everything else = hand-written
- Confidence when editing: Know immediately what's safe to modify
- Follows Go ecosystem conventions (many tools use `gen/` or `generated/`)

**Code Maintainability:**
- Can exclude `gen/` from code coverage metrics
- Can add to .gitignore if treating as build artifacts
- Easier to navigate and understand codebase structure

**File Naming:**
- Bonus improvement: Removed `_task` suffix
- `forktaskconfig.go` instead of `forktaskconfig_task.go`

## Examples

### Workflow with Types

**Before (v0.2.0)**:
```go
import (
    "github.com/stigmer/stigmer/sdk/go/stigmer"
    "github.com/stigmer/stigmer/sdk/go/types"       // Old import
    "github.com/stigmer/stigmer/sdk/go/workflow"
)

func main() {
    stigmer.Run(func(ctx *stigmer.Context) error {
        wf, _ := workflow.New(ctx, ...)
        
        wf.Fork("parallel", &workflow.ForkArgs{
            Branches: []*types.ForkBranch{...},      // types.ForkBranch
        })
        
        return nil
    })
}
```

**After (v0.3.0)**:
```go
import (
    "github.com/stigmer/stigmer/sdk/go/stigmer"
    "github.com/stigmer/stigmer/sdk/go/gen/types"  // New import!
    "github.com/stigmer/stigmer/sdk/go/workflow"
)

func main() {
    stigmer.Run(func(ctx *stigmer.Context) error {
        wf, _ := workflow.New(ctx, ...)
        
        wf.Fork("parallel", &workflow.ForkArgs{
            Branches: []*types.ForkBranch{...},      // Same usage!
        })
        
        return nil
    })
}
```

### Agent Execution Config

**Before (v0.2.0)**:
```go
import (
    "github.com/stigmer/stigmer/sdk/go/types"       // Old
    "github.com/stigmer/stigmer/sdk/go/workflow"
)

wf.AgentCall("process", &workflow.AgentCallArgs{
    Config: &types.AgentExecutionConfig{           // types.AgentExecutionConfig
        TimeoutSeconds: 300,
    },
})
```

**After (v0.3.0)**:
```go
import (
    "github.com/stigmer/stigmer/sdk/go/gen/types"  // New!
    "github.com/stigmer/stigmer/sdk/go/workflow"
)

wf.AgentCall("process", &workflow.AgentCallArgs{
    Config: &types.AgentExecutionConfig{           // Same usage!
        TimeoutSeconds: 300,
    },
})
```

## Verification

After migration, verify your code:

```bash
# Build succeeds
go build ./...

# Tests pass
go test ./...

# No import errors
go list ./...
```

## Troubleshooting

### Error: `cannot find package "github.com/stigmer/stigmer/sdk/go/types"`

**Cause**: Using old import path.

**Fix**: Update import to `github.com/stigmer/stigmer/sdk/go/gen/types`

### Error: `imported but not used: "github.com/stigmer/stigmer/sdk/go/gen/types"`

**Cause**: Your code doesn't use any types from this package.

**Fix**: Remove the import if you're not using types like `ForkBranch`, `AgentExecutionConfig`, etc.

### Build Still Failing After Update

**Verify you updated go.mod:**

```bash
go get github.com/stigmer/stigmer/sdk/go@latest
go mod tidy
```

**Verify all imports were updated:**

```bash
# Search for old imports
grep -r "sdk/go/types\"" .

# Should return nothing (or only comments)
```

## Benefits After Migration

Once migrated, you'll enjoy:

- ✅ **Clear codebase structure** - Obvious what's generated vs hand-written
- ✅ **Better IDE experience** - Code navigation and search improved
- ✅ **Future-proof** - Structure aligns with Go ecosystem conventions
- ✅ **Same API** - Your code logic doesn't change, only imports

## Timeline

- **v0.2.0 and earlier**: Old structure (generated code intermixed)
- **v0.3.0+**: New `gen/` structure (generated code separated)

**Recommendation**: Migrate as soon as possible - the new structure is cleaner and more maintainable.

## Need Help?

If you encounter issues during migration:

1. **Check this guide** - Most issues covered in Troubleshooting
2. **Review examples** - All 19 examples updated to v0.3.0 imports
3. **Ask in Discord** - [stigmer.ai/discord](https://stigmer.ai/discord)
4. **Open an issue** - [GitHub Issues](https://github.com/stigmer/stigmer/issues)

---

**Version**: v0.3.0  
**Last Updated**: 2026-01-24  
**Estimated Migration Time**: 5-10 minutes for most projects
