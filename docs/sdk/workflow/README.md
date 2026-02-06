# Workflow Package

The `workflow` package provides a type-safe, fluent API for creating Stigmer workflows in Go.

## Overview

Workflows are orchestration definitions that execute a series of tasks sequentially or in parallel. They support various task types including HTTP calls, gRPC calls, conditional logic, loops, error handling, and more.

## Features

- **12 Task Types**: SET, HTTP_CALL, GRPC_CALL, SWITCH, FOR, FORK, TRY, LISTEN, WAIT, CALL_ACTIVITY, RAISE, RUN
- **Fluent API**: Chain methods for readable workflow definitions
- **Type Safety**: Compile-time validation of workflow configurations
- **Builder Pattern**: Flexible functional options for task configuration
- **Environment Variables**: Declare required environment variables with secrets support
- **Flow Control**: Export task outputs and control execution flow
- **Auto-Registration**: Workflows automatically register for synthesis
- **Comprehensive Validation**: Validates workflow structure, task names, and configurations

## Quick Start

```go
package main

import (
    "log"
    "github.com/leftbin/stigmer-sdk/go/workflow"
    "github.com/leftbin/stigmer-sdk/go/synthesis"
)

func main() {
    defer synthesis.AutoSynth()

    wf, err := workflow.New(
        workflow.WithNamespace("data-processing"),
        workflow.WithName("daily-sync"),
        workflow.WithVersion("1.0.0"),
        workflow.WithDescription("Sync data from external API"),
    )
    if err != nil {
        log.Fatal(err)
    }

    // Add tasks
    wf.AddTask(workflow.SetTask("init",
        workflow.SetVar("apiURL", "https://api.example.com"),
    ))

    wf.AddTask(workflow.HttpCallTask("fetchData",
        workflow.WithMethod("GET"),
        workflow.WithURI("${apiURL}/data"),
    ).Export("${.}"))
}
```

## Task Types

### 1. SET - Variable Assignment

```go
workflow.SetTask("initialize",
    workflow.SetVar("x", "1"),
    workflow.SetVar("y", "2"),
)
```

### 2. HTTP_CALL - HTTP Requests

```go
workflow.HttpCallTask("fetchData",
    workflow.WithMethod("GET"),
    workflow.WithURI("https://api.example.com/data"),
    workflow.WithHeader("Authorization", "Bearer ${TOKEN}"),
    workflow.WithTimeout(30),
)
```

### 3. GRPC_CALL - gRPC Calls

```go
workflow.GrpcCallTask("callService",
    workflow.WithService("UserService"),
    workflow.WithGrpcMethod("GetUser"),
    workflow.WithGrpcBody(map[string]any{"userId": "${.userId}"}),
)
```

### 4. SWITCH - Conditional Branching

```go
workflow.SwitchTask("checkStatus",
    workflow.WithCase("${.status == 200}", "handleSuccess"),
    workflow.WithCase("${.status == 404}", "handleNotFound"),
    workflow.WithDefault("handleError"),
)
```

### 5. FOR - Iteration

```go
workflow.ForTask("processItems",
    workflow.WithIn("${.items}"),
    workflow.WithDo(
        workflow.SetTask("process", workflow.SetVar("item", "${.}")),
    ),
)
```

### 6. FORK - Parallel Execution

```go
workflow.ForkTask("parallel",
    workflow.WithBranch("branch1",
        workflow.SetTask("task1", workflow.SetVar("x", "1")),
    ),
    workflow.WithBranch("branch2",
        workflow.SetTask("task2", workflow.SetVar("y", "2")),
    ),
)
```

### 7. TRY - Error Handling

```go
workflow.TryTask("handleErrors",
    workflow.WithTry(
        workflow.HttpCallTask("risky", workflow.WithMethod("GET"), workflow.WithURI("${.url}")),
    ),
    workflow.WithCatch([]string{"NetworkError"}, "err",
        workflow.SetTask("logError", workflow.SetVar("error", "${err}")),
    ),
)
```

### 8. LISTEN - Wait for Events

```go
workflow.ListenTask("waitForApproval",
    workflow.WithEvent("approval.granted"),
)
```

### 9. WAIT - Delay Execution

```go
workflow.WaitTask("delay",
    workflow.WithDuration("5s"),
)
```

### 10. CALL_ACTIVITY - Execute Activities

```go
workflow.CallActivityTask("processData",
    workflow.WithActivity("DataProcessor"),
    workflow.WithActivityInput(map[string]any{"data": "${.data}"}),
)
```

### 11. RAISE - Throw Errors

```go
workflow.RaiseTask("throwError",
    workflow.WithError("ValidationError"),
    workflow.WithErrorMessage("Invalid input"),
)
```

### 12. RUN - Execute Sub-Workflows

```go
workflow.RunTask("executeSubWorkflow",
    workflow.WithWorkflow("data-processor"),
    workflow.WithWorkflowInput(map[string]any{"data": "${.data}"}),
)
```

## Flow Control

### Export Task Outputs

```go
task := workflow.HttpCallTask("fetch",
    workflow.WithMethod("GET"),
    workflow.WithURI("${.url}"),
)
task.Export("${.}") // Export entire response
```

### Control Execution Flow

```go
task.Then("nextTask") // Jump to specific task
task.End()            // Terminate workflow
```

### Fluent API Chaining

```go
workflow.HttpCallTask("fetch",
    workflow.WithMethod("GET"),
    workflow.WithURI("${.url}"),
).Export("${.}").Then("processData")
```

## Environment Variables

```go
import "github.com/leftbin/stigmer-sdk/go/environment"

apiToken, _ := environment.New(
    environment.WithName("API_TOKEN"),
    environment.WithSecret(true),
    environment.WithDescription("Authentication token"),
)

wf, _ := workflow.New(
    workflow.WithNamespace("my-app"),
    workflow.WithName("workflow"),
    workflow.WithVersion("1.0.0"),
    workflow.WithEnvironmentVariable(apiToken),
)
```

## Validation

Workflows are validated at creation time:

- **Document**: namespace, name, and version are required (semver)
- **Tasks**: must have at least one task
- **Task Names**: must be unique within workflow
- **Task Configs**: validated based on task type

```go
wf, err := workflow.New(
    workflow.WithNamespace("test"),
    workflow.WithName("test"),
    workflow.WithVersion("1.0.0"),
    workflow.WithTask(workflow.SetTask("init", workflow.SetVar("x", "1"))),
)
if err != nil {
    // Handle validation error
    log.Fatal(err)
}
```

## Examples

See the `examples/` directory for complete workflow examples:

- **07_basic_workflow.go** - Basic workflow with HTTP calls
- **08_workflow_with_conditionals.go** - Conditional logic with SWITCH
- **09_workflow_with_loops.go** - Iteration with FOR tasks
- **10_workflow_with_error_handling.go** - Error handling with TRY/CATCH
- **11_workflow_with_parallel_execution.go** - Parallel processing with FORK

## Testing

```bash
# Run all tests
go test ./workflow/...

# Run with coverage
go test -cover ./workflow/...

# Run specific test
go test -run TestWorkflow_New ./workflow
```

## Architecture

The workflow package follows the same patterns as the agent package:

- **Builder Pattern**: Functional options for flexible configuration
- **Fluent API**: Method chaining for readable code
- **Type Safety**: Compile-time validation
- **Auto-Registration**: Workflows register in global registry
- **Synthesis Model**: Automatic conversion to proto manifests

## Package Structure

```
workflow/
├── workflow.go           # Main Workflow struct and builders
├── task.go              # Task types and builders
├── document.go          # Workflow document metadata
├── validation.go        # Validation logic
├── errors.go            # Error types
├── doc.go               # Package documentation
├── workflow_test.go     # Workflow tests
├── task_test.go         # Task tests
├── document_test.go     # Document validation tests
├── validation_test.go   # Validation tests
└── README.md           # This file
```

## Integration

Workflows integrate with the synthesis system:

1. Create workflows using `workflow.New()`
2. Workflows auto-register in global registry
3. Call `defer synthesis.AutoSynth()` in main()
4. On exit, workflows convert to proto and write to manifest
5. CLI reads manifest and deploys workflows

## Related Packages

- **environment** - Environment variable configuration
- **synthesis** - Manifest synthesis and auto-synth
- **internal/registry** - Global resource registry
- **internal/synth** - Proto conversion logic

## Future Enhancements

- [ ] Workflow templates
- [ ] Dynamic task generation
- [ ] Workflow composition
- [ ] Advanced validation rules
- [ ] Workflow visualization
- [ ] Debug mode
- [ ] Workflow testing utilities
