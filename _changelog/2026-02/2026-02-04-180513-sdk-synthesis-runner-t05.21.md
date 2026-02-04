# SDK Synthesis Runner - Multi-Runtime Execution Engine (T05.21)

**Date**: February 4, 2026

## Summary

Implemented T05.21 SDK Synthesis Runner - a production-ready multi-runtime execution engine that enables the `stigmer apply` command to execute user SDK programs across Go, Python, and Node.js runtimes. This is a critical foundation component for the Project Track deployment workflow, enabling declarative infrastructure-as-code patterns with automatic dependency resolution and resource synthesis.

## Problem Statement

The Stigmer platform requires a unified SDK synthesis execution layer that can:
- Execute SDK programs across multiple language runtimes (Go, Python, Node.js)
- Capture synthesized resource manifests (agents, workflows, skills)
- Parse dependency graphs for topological deployment ordering
- Provide helpful error messages with actionable guidance
- Integrate seamlessly with the existing `synthesis` package infrastructure

### Pain Points

- **No multi-runtime support**: Previous implementation (`agent/execute.go`) only supported Go
- **Manual dependency management**: No automated runtime preparation (go mod tidy, pip install, npm install)
- **Poor error messages**: Generic failures without runtime-specific troubleshooting guidance
- **Code duplication risk**: Need to reuse existing synthesis parsing infrastructure

## Solution

Created a new `client-apps/cli/internal/cli/apply` package with a comprehensive SDK synthesis runner that:

1. **Multi-Runtime Execution**: Supports Go (`go run`), Python (`python`/`python3`), and Node.js (`npx ts-node` for TS, `node` for JS)
2. **Intelligent Preparation**: Runtime-specific setup (go mod tidy, venv detection, node_modules validation)
3. **STIGMER_OUT_DIR Protocol**: Sets environment variable to trigger SDK synthesis output
4. **Manifest Collection**: Reuses `synthesis.ReadFromDirectory()` to parse `.pb` files and `dependencies.json`
5. **Actionable Error Handling**: Runtime-specific error messages with fix guidance

## Implementation Details

### Core Architecture

**File**: `client-apps/cli/internal/cli/apply/synthesize.go` (277 lines)

```go
type SynthesizeOptions struct {
    ProjectDir string                  // SDK project directory
    Runtime    projectv1.ProjectRuntime // go, python, node
    EntryPoint string                   // main.go, main.py, index.ts
    Quiet      bool                     // Suppress SDK stdout
}

type SynthesizeResult struct {
    OutputDir string              // .stigmer/ output directory
    Result    *synthesis.Result   // Parsed manifests
    Stdout    string              // SDK stdout for debugging
}
```

**Main Function**: `Synthesize(opts *SynthesizeOptions) (*SynthesizeResult, error)`

Execution flow:
1. Validate inputs (project dir, entry point, runtime)
2. Create `.stigmer/` output directory
3. Run runtime-specific preparation
4. Execute SDK entry point with `STIGMER_OUT_DIR` environment variable
5. Parse synthesized manifests using `synthesis.ReadFromDirectory()`
6. Return result with parsed resources and dependency graph

### Runtime-Specific Handlers

**Go Runtime** (`prepareGoRuntime`):
- Validates `go.mod` exists
- Runs `go mod tidy` to ensure dependencies are current
- Executes via `go run <entry_point>`

**Python Runtime** (`preparePythonRuntime`):
- Detects `python3` availability, falls back to `python`
- Validates Python 3.x version
- Checks for `requirements.txt` (doesn't auto-install to respect user environment)
- Provides pip install guidance on execution errors

**Node Runtime** (`prepareNodeRuntime`):
- Validates Node.js is installed
- Checks for `package.json` and `node_modules`
- Routes TypeScript files (`.ts`, `.tsx`, `.mts`) to `npx ts-node`
- Routes JavaScript files (`.js`, `.mjs`) to `node`

### Error Handling

**Runtime-Specific Guidance** (`formatExecutionError`):
- Go: "Check for compile errors above. Run 'go build' to see full error output."
- Python: "If you see import errors, run 'pip install -r requirements.txt' in a virtual environment."
- Node: "If you see module errors, run 'npm install' to install dependencies."

Stderr is truncated to 800 chars to prevent overwhelming output while preserving critical error context.

### Testing

**File**: `client-apps/cli/internal/cli/apply/synthesize_test.go` (443 lines, 28 tests)

Comprehensive test coverage:
- **Input Validation**: Nil options, missing dirs, missing files, invalid runtimes
- **Runtime Commands**: Correct command generation for each runtime and file type
- **Runtime Preparation**: Go module validation, Python version checking, Node package validation
- **Error Formatting**: Truncation, runtime-specific guidance, empty stderr handling
- **Integration**: Output directory creation, environment variable passing

### Build Configuration

**File**: `client-apps/cli/internal/cli/apply/BUILD.bazel` (24 lines)

Bazel target with dependencies:
- `//apis/stubs/go/ai/stigmer/agentic/project/v1:project` - ProjectRuntime enum
- `//client-apps/cli/internal/cli/synthesis` - Manifest parsing infrastructure
- `@com_github_pkg_errors//:errors` - Error wrapping

## Benefits

### 1. Multi-Runtime Support
- **Go developers**: Native Go SDK execution with automatic dependency management
- **Python developers**: Python SDK support with version validation
- **Node developers**: TypeScript and JavaScript support with proper tooling

### 2. Production-Ready Error Handling
- **Actionable guidance**: Users get specific instructions on how to fix issues
- **Context preservation**: Full stderr captured with intelligent truncation
- **Runtime awareness**: Error messages tailored to each language ecosystem

### 3. Seamless Integration
- **Reuses existing infrastructure**: `synthesis.ReadFromDirectory()` handles all manifest parsing
- **Clean architecture**: Separate `apply` package for project-level synthesis
- **Consistent patterns**: Matches existing CLI code quality standards (< 300 lines per file, < 50 lines per function)

### 4. Developer Experience
- **Fast feedback**: Immediate validation of project directory and entry point
- **Clear failures**: Runtime-specific error messages with fix instructions
- **Debug support**: SDK stdout captured for troubleshooting

## Impact

### Enables Project Track Workflow
This implementation is the foundation for the `stigmer apply` command, enabling:
- SDK synthesis from any supported language
- Automatic dependency graph generation
- Topological resource deployment ordering
- Orphan resource cleanup via reconciliation

### Unblocks T05.22 and T05.23
- **T05.22 (Manifest Collection)**: Can now collect synthesized manifests
- **T05.23 (Apply Command Integration)**: Can integrate synthesis into `stigmer apply`

### Production Readiness
- **Zero linter errors**: All code passes gofmt, go vet
- **Full test coverage**: 28 comprehensive tests, all passing
- **Bazel verified**: Successful build and test execution

## Technical Details

### File Statistics
| File | Lines | Purpose |
|------|-------|---------|
| `synthesize.go` | 277 | Core synthesis execution logic |
| `synthesize_test.go` | 443 | Comprehensive test suite |
| `BUILD.bazel` | 24 | Bazel build configuration |
| **Total** | **744** | Complete package implementation |

### Key Functions
- `Synthesize()` - Main entry point (44 lines)
- `getRuntimeCommand()` - Runtime command builder (23 lines)
- `prepareRuntime()` - Runtime preparation dispatcher (12 lines)
- `prepareGoRuntime()` - Go-specific setup (19 lines)
- `preparePythonRuntime()` - Python-specific setup (27 lines)
- `prepareNodeRuntime()` - Node-specific setup (20 lines)
- `formatExecutionError()` - Error message formatter (22 lines)

All functions are under 50 lines, maintaining excellent code readability and maintainability.

### Design Decisions

1. **Separate Package**: Created `apply` package instead of extending `agent/execute.go` for clear separation between single-file agent execution and project-level synthesis

2. **Infrastructure Reuse**: Leveraged `synthesis.ReadFromDirectory()` to avoid duplicating manifest parsing logic

3. **Proto Enum Integration**: Used `projectv1.ProjectRuntime` directly for runtime detection, maintaining type safety

4. **No Cleanup on Success**: Leave `.stigmer/` directory for debugging; users can add to `.gitignore`

5. **Defensive Preparation**: Validate runtime environment before execution to provide early, helpful error messages

## Related Work

- **Phase 5 Backend CLI Integration**: T05.21 is part of the comprehensive Phase 5 plan connecting CLI to backend reconciliation
- **T05.0-T05.20**: All prerequisite tasks complete (proto types, handlers, reconciliation engine)
- **T05.22 (Next)**: Manifest Collection - will use this synthesis runner to collect manifests
- **T05.23 (Following)**: Apply Command Integration - will integrate synthesis into root `stigmer apply` command

## Engineering Quality

- **Code Quality**: All files under 300 lines, all functions under 50 lines
- **Test Coverage**: 28 comprehensive tests covering all runtimes and error scenarios
- **Build Verification**: Bazel build and test pass successfully
- **Linter Clean**: Zero gofmt, go vet errors
- **Pattern Consistency**: Matches existing CLI package structure and conventions

---

**Status**: ✅ Production Ready
**Timeline**: Completed in 60-75 minutes (as estimated in Phase 5 plan)
**Tests**: 28/28 passing
**Build**: ✅ Verified with Bazel
