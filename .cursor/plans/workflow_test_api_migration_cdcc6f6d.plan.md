---
name: Workflow Test API Migration
overview: Migrate 4 workflow test files from the deprecated functional options environment API to the new Pulumi-aligned struct-args pattern, ensuring consistency with already-migrated agent tests and maintaining world-class code quality.
todos:
  - id: add-mock-context
    content: Add mockEnvContext type to each workflow test file that needs it
    status: completed
  - id: migrate-benchmarks
    content: Migrate benchmarks_test.go - 1 instance in BenchmarkWorkflowToProto_WithEnvironmentVariables
    status: completed
  - id: migrate-edge-cases
    content: Migrate edge_cases_test.go - 1 instance in TestWorkflowToProto_MaximumFields
    status: completed
  - id: migrate-error-cases
    content: Migrate error_cases_test.go - 3 instances across 2 test functions
    status: completed
  - id: migrate-proto-integration
    content: Migrate proto_integration_test.go - 4 instances across 2 test functions
    status: completed
  - id: verify-compile
    content: "Verify all files compile: go build ./sdk/go/workflow/..."
    status: completed
  - id: run-tests
    content: Run all workflow tests to ensure they pass
    status: completed
  - id: run-benchmarks
    content: Run benchmarks to verify performance tests work correctly
    status: completed
isProject: false
---

# Workflow Test Files - Environment API Migration

## Problem Statement

The workflow package test files use a **deprecated environment API** that no longer exists. The functional options pattern (`environment.WithName()`, `environment.WithSecret()`, etc.) has been completely removed from the codebase. These files currently will not compile.

**Old API (deprecated, removed):**

```go
env, _ := environment.New(
    environment.WithName("API_KEY"),
    environment.WithSecret(true),
    environment.WithDefaultValue("value"),
)
```

**New API (Pulumi-aligned struct-args):**

```go
ctx := &mockEnvContext{}
env, _ := environment.New(ctx, "API_KEY", &environment.VariableArgs{
    IsSecret:     true,
    DefaultValue: "value",
})
```

## Scope

**4 files, 9 instances to migrate:**

| File | Lines | Instances | Affected Functions |

|------|-------|-----------|-------------------|

| [benchmarks_test.go](sdk/go/workflow/benchmarks_test.go) | 612 | 1 | `BenchmarkWorkflowToProto_WithEnvironmentVariables` |

| [edge_cases_test.go](sdk/go/workflow/edge_cases_test.go) | 626 | 1 | `TestWorkflowToProto_MaximumFields` |

| [error_cases_test.go](sdk/go/workflow/error_cases_test.go) | 710 | 3 | `TestWorkflowToProto_InvalidEnvironmentVariables`, `TestWorkflowToProto_NestedErrorPropagation` |

| [proto_integration_test.go](sdk/go/workflow/proto_integration_test.go) | 534 | 4 | `TestWorkflowToProto_Complete`, `TestWorkflowToProto_MultipleEnvVars` |

## Reference Implementation

The agent package tests have already been migrated and serve as the canonical reference. See [agent/benchmarks_test.go](sdk/go/agent/benchmarks_test.go):

```14:sdk/go/agent/benchmarks_test.go
type mockEnvContext struct{}
```
```38:40:sdk/go/agent/benchmarks_test.go
	env1, _ := environment.New(ctx, "API_KEY", &environment.VariableArgs{
		IsSecret: true,
	})
```

## Migration Pattern

For each instance, apply this transformation:

**Before:**

```go
env, _ := environment.New(
    environment.WithName("VAR_NAME"),
    environment.WithSecret(true),
    environment.WithDescription("desc"),
    environment.WithDefaultValue("default"),
)
// Used as: []environment.Variable{env}
```

**After:**

```go
ctx := &mockEnvContext{}  // Add once per file
env, _ := environment.New(ctx, "VAR_NAME", &environment.VariableArgs{
    IsSecret:     true,
    Description:  "desc",
    DefaultValue: "default",
})
// Used as: []environment.Variable{*env}  // Note: dereference pointer
```

## Key Changes

1. **Add mock context type** - Each file needs `type mockEnvContext struct{}` (implements `environment.Context` interface)
2. **Change function signature** - `environment.New(options...)` becomes `environment.New(ctx, name, &VariableArgs{})`
3. **Handle pointer return** - New API returns `*Variable`, must dereference with `*env` when adding to slices
4. **Map option fields to struct fields:**

   - `WithName("X")` -> second parameter `"X"`
   - `WithSecret(true)` -> `IsSecret: true`
   - `WithDescription("D")` -> `Description: "D"`
   - `WithDefaultValue("V")` -> `DefaultValue: "V"`

## Detailed File Changes

### 1. benchmarks_test.go (Line 211-216)

Current code in `BenchmarkWorkflowToProto_WithEnvironmentVariables`:

```go
env, _ := environment.New(
    environment.WithName("ENV_VAR_"+string(rune('0'+i%10))),
    environment.WithDefaultValue("value"+string(rune('0'+i%10))),
    environment.WithSecret(i%2 == 0),
)
envVars[i] = env
```

### 2. edge_cases_test.go (Line 124-128)

Current code in `TestWorkflowToProto_MaximumFields`:

```go
env, _ := environment.New(
    environment.WithName(fmt.Sprintf("ENV_VAR_%d", i)),
    environment.WithDefaultValue(fmt.Sprintf("value%d", i)),
)
envVars[i] = env
```

### 3. error_cases_test.go (Lines 264-273, 471-473)

Three instances:

- `TestWorkflowToProto_InvalidEnvironmentVariables` - 2 env vars
- `TestWorkflowToProto_NestedErrorPropagation` - 1 env var (tests empty name validation)

### 4. proto_integration_test.go (Lines 13-17, 444-455)

Four instances:

- `TestWorkflowToProto_Complete` - 1 env var
- `TestWorkflowToProto_MultipleEnvVars` - 3 env vars

## Verification Steps

1. **Compile check**: `go build ./sdk/go/workflow/...`
2. **Test execution**: `go test ./sdk/go/workflow/... -v`
3. **Full SDK build**: `go build ./sdk/go/...`
4. **Benchmark verification**: `go test ./sdk/go/workflow/... -bench=. -benchtime=100ms`

## Quality Standards

- Maintain consistency with agent test patterns
- Preserve test semantics and coverage
- Use descriptive variable names
- Follow existing code formatting
- Zero compiler warnings
- All tests pass