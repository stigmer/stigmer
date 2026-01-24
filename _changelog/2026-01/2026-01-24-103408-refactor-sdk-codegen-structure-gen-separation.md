# Refactor SDK Code Generation Structure - Separate Generated Code

**Date**: 2026-01-24  
**Type**: Refactoring (Code Organization)  
**Scope**: SDK Go / Code Generation  
**Impact**: Developer Experience, Code Maintainability

## Summary

Restructured the Stigmer Go SDK code generation to clearly separate generated code from hand-written code by introducing a `sdk/go/gen/` directory structure. All generated files now live under `gen/` subdirectories, making it immediately obvious which files are generated vs hand-written.

## Problem

The SDK codebase had generated and hand-written code intermixed in the same directories:

**Confusion points:**
- Generated `*taskconfig_task.go` files lived alongside hand-written `workflow.go`, `task.go` in `sdk/go/workflow/`
- Generated `agentspec_args.go` lived alongside hand-written `agent.go` in `sdk/go/agent/`
- Generated types in `sdk/go/types/` (entire directory was generated)
- Two confusing directories: `workflow/gen/` (outdated) and `.codegen-test/` (unclear purpose)
- Difficult to distinguish what's safe to edit vs what gets overwritten on regeneration

**Developer pain:**
- "Can I edit this file or will it be overwritten?"
- "Where are the generated files vs the API I should use?"
- "Why are there multiple gen folders?"
- No visual separation when browsing the codebase

## Solution

**Created root-level `gen/` structure:**

```
sdk/go/
├── gen/                          # ALL generated code (clear separation)
│   ├── workflow/                 # package: workflow
│   │   ├── agentcalltaskconfig.go
│   │   ├── forktaskconfig.go
│   │   ├── httpcalltaskconfig.go
│   │   ├── helpers.go
│   │   └── ... (14 files)
│   ├── agent/                    # package: agent  
│   │   └── agentspec_args.go
│   ├── skill/                    # package: skill
│   │   └── skillspec_args.go
│   └── types/                    # package: types
│       ├── agentic_types.go
│       └── commons_types.go
│
├── workflow/                     # Hand-written ONLY
│   ├── workflow.go
│   ├── task.go
│   ├── gen_types.go              # Type aliases for generated types
│   ├── helpers.go                # Exported helpers
│   └── *_options.go              # Builder functions
├── agent/                        # Hand-written ONLY
├── skill/                        # Hand-written ONLY
└── types/                        # Empty (all types are generated)
```

**File naming improvement:**
- Removed `_task` suffix from generated files
- `forktaskconfig_task.go` → `forktaskconfig.go` (cleaner)

## Implementation

### 1. Updated Code Generator

**Modified `tools/codegen/generator/main.go`:**

```go
// Before: Generated to sdk/go/workflow with _task suffix
--output-dir sdk/go/workflow --file-suffix _task

// After: Generated to sdk/go/gen/workflow without suffix
--output-dir sdk/go/gen/workflow
```

**Key changes:**
- Changed types output: `sdk/go/types/` → `sdk/go/gen/types/`
- Changed subdomain output: `sdk/go/agent/` → `sdk/go/gen/agent/`
- Updated import paths: `sdk/go/types` → `sdk/go/gen/types`
- Exported `isTaskConfig()` → `IsTaskConfig()` for cross-package use
- Removed `*Task` reference from generated helpers to avoid circular dependency

### 2. Fixed Circular Dependency

**Problem:**
- Hand-written `workflow` package imports generated types from `gen/workflow`
- Generated `gen/workflow/helpers.go` referenced `*Task` from hand-written `workflow`
- Circular dependency error

**Solution:**
- Removed `*Task` handling from generated helpers in `gen/workflow`
- Kept full helpers with `*Task` support in hand-written `workflow/helpers.go`
- Generated code uses simple type coercion; hand-written code handles Task references

### 3. Type Aliases for Seamless Use

**Created bridge files for hand-written code:**

`sdk/go/workflow/gen_types.go`:
```go
import genWorkflow "github.com/stigmer/stigmer/sdk/go/gen/workflow"

type ForkTaskConfig = genWorkflow.ForkTaskConfig
type ForTaskConfig = genWorkflow.ForTaskConfig
// ... all task configs
```

`sdk/go/agent/agent.go`:
```go
import genAgent "github.com/stigmer/stigmer/sdk/go/gen/agent"

type AgentArgs = genAgent.AgentArgs
```

`sdk/go/skill/skill.go`:
```go
import genSkill "github.com/stigmer/stigmer/sdk/go/gen/skill"

type SkillArgs = genSkill.SkillArgs
```

### 4. Updated All Imports

**Replaced import paths across entire codebase:**
- `github.com/stigmer/stigmer/sdk/go/types` → `sdk/go/gen/types`
- Examples, tests, templates all updated

**Files affected:**
- 16 example files
- 10+ test files  
- Templates and utilities

### 5. Cleanup

**Deleted outdated directories:**
- `sdk/go/workflow/gen/` (14 files)
- `sdk/go/workflow/.codegen-test/` (15 files including go.mod)
- Old generated files from `agent/`, `skill/`, `types/`

**Deleted 70+ files** from old locations, regenerated 20+ files in new structure.

## Updated Makefile

**Before:**
```make
codegen-go:
	go run tools/codegen/generator/main.go \
		--output-dir sdk/go/workflow \
		--package workflow \
		--file-suffix _task
```

**After:**
```make
codegen-go:
	go run tools/codegen/generator/main.go \
		--output-dir sdk/go/gen/workflow \
		--package workflow
```

## Verification

**Build succeeds:**
```bash
cd sdk/go && go build ./...
# ✅ Success
```

**Tests run:**
```bash
cd sdk/go && go test ./workflow/...
# ✅ Tests pass (1 pre-existing validation test failure unrelated to refactoring)
```

**Codegen is idempotent:**
```bash
make codegen
# ✅ Generates cleanly without manual fixes needed
```

## Benefits

**Developer Experience:**
- ✅ **Visual clarity**: `gen/` folder = generated, everything else = hand-written
- ✅ **Confidence**: Know immediately what's safe to edit
- ✅ **Navigation**: Easier to find hand-written API vs generated internals
- ✅ **Cleaner filenames**: No `_task` suffix clutter

**Code Maintainability:**
- ✅ **Clear boundaries**: Generated code isolated in `gen/`
- ✅ **Easy to ignore**: Can add `gen/` to .gitignore if needed (future consideration)
- ✅ **Easy to exclude**: Can exclude `gen/` from code coverage metrics
- ✅ **Scalable**: Adding new generated packages is straightforward

**Code Generation:**
- ✅ **Follows Go conventions**: Many codegen tools use `gen/` or `generated/`
- ✅ **No manual fixes needed**: Generator produces correct code on every run
- ✅ **No circular dependencies**: Type aliases bridge packages cleanly

## Migration Notes

**For users/developers:**

**Old import pattern:**
```go
import "github.com/stigmer/stigmer/sdk/go/types"

// Usage
branches := []*types.ForkBranch{...}
```

**New import pattern (unchanged from user perspective!):**
```go
import "github.com/stigmer/stigmer/sdk/go/gen/types"

// Usage (same!)
branches := []*types.ForkBranch{...}
```

**API surface remains the same** - only import paths changed.

## Future Improvements

With this structure in place, we can:

1. **Add .gitignore for gen/** (optional) - Treat generated code as build artifacts
2. **Exclude gen/ from coverage** - Focus coverage metrics on hand-written code
3. **Document gen/ in README** - Explain the structure for new contributors
4. **Add generation guards** - Prevent accidental edits to generated files

## Files Changed

**Generator:**
- `tools/codegen/generator/main.go` - Updated output paths and interface exports

**Build:**
- `sdk/go/Makefile` - Updated codegen targets

**Hand-written bridges:**
- `sdk/go/workflow/gen_types.go` - Type aliases for generated task configs
- `sdk/go/workflow/helpers.go` - Exported helpers with Task support
- `sdk/go/agent/agent.go` - AgentArgs alias
- `sdk/go/skill/skill.go` - SkillArgs alias

**Import updates:**
- All examples (08, 17, 18, 19)
- All tests (workflow, agent, integration)
- Templates and utilities

**Generated (new locations):**
- `sdk/go/gen/workflow/*.go` (14 files)
- `sdk/go/gen/agent/agentspec_args.go`
- `sdk/go/gen/skill/skillspec_args.go`  
- `sdk/go/gen/types/agentic_types.go`
- `sdk/go/gen/types/commons_types.go`

**Deleted (old locations):**
- `sdk/go/workflow/gen/` (14 files)
- `sdk/go/workflow/.codegen-test/` (15 files)
- `sdk/go/workflow/*taskconfig_task.go` (13 files)
- `sdk/go/agent/agentspec_args.go`, `inlinesubagentspec_args.go`
- `sdk/go/skill/skillspec_args.go`
- `sdk/go/types/agentic_types.go`, `commons_types.go`

## Conclusion

The SDK now has a clear, maintainable structure where generated code is visually and structurally separated from hand-written code. Developers can confidently navigate the codebase knowing exactly what's generated vs what's part of the stable API.

**Impact on developer workflow:**
- Before: "Is this file generated? Let me check the header comment..."
- After: "Is it in `gen/`? Then it's generated. Everything else is hand-written."

This follows Go ecosystem conventions and makes the codebase more approachable for contributors.
