# Workflow Task Validation Package

This package provides type-safe validation for workflow task configurations, establishing a contract between SDK, CLI, and Workflow Runner.

## Overview

The validation package unmarshals `google.protobuf.Struct` task configurations to typed proto messages and validates them using `buf validate` rules. This ensures that workflows are validated against proto-defined contracts before execution.

```
┌─────────────────────────────────────────────────────────────┐
│                    Workflow Runner                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Input: WorkflowTask (kind + task_config Struct)          │
│         ↓                                                   │
│  [1] validation.UnmarshalTaskConfig()                      │
│         ↓                                                   │
│  Output: Typed Proto Message (SetTaskConfig, etc.)        │
│         ↓                                                   │
│  [2] validation.ValidateTaskConfig()                       │
│         ↓                                                   │
│  Output: Validation Errors (if any)                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## API

### UnmarshalTaskConfig

Unmarshals `google.protobuf.Struct` to typed proto message based on `WorkflowTaskKind`.

```go
func UnmarshalTaskConfig(
    kind apiresourcev1.WorkflowTaskKind,
    config *structpb.Struct,
) (proto.Message, error)
```

**Supported Task Types** (12 total):
- `SET` → `SetTaskConfig`
- `HTTP_CALL` → `HttpCallTaskConfig`
- `GRPC_CALL` → `GrpcCallTaskConfig`
- `SWITCH` → `SwitchTaskConfig`
- `FOR` → `ForTaskConfig`
- `FORK` → `ForkTaskConfig`
- `TRY` → `TryTaskConfig`
- `LISTEN` → `ListenTaskConfig`
- `WAIT` → `WaitTaskConfig`
- `CALL_ACTIVITY` → `CallActivityTaskConfig`
- `RAISE` → `RaiseTaskConfig`
- `RUN` → `RunTaskConfig`

**Example:**

```go
msg, err := validation.UnmarshalTaskConfig(
    apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL,
    task.TaskConfig,
)
if err != nil {
    return fmt.Errorf("failed to unmarshal task config: %w", err)
}

httpConfig := msg.(*tasksv1.HttpCallTaskConfig)
```

### ValidateTaskConfig

Validates a proto message using buf validate rules.

```go
func ValidateTaskConfig(msg proto.Message) error
```

**Example:**

```go
config := &tasksv1.HttpCallTaskConfig{
    Method: "GET",
    Endpoint: &tasksv1.HttpEndpoint{
        Uri: "https://api.example.com/data",
    },
    TimeoutSeconds: 30,
}

err := validation.ValidateTaskConfig(config)
if err != nil {
    // Handle validation errors
    if valErrs, ok := err.(*validation.ValidationErrors); ok {
        for _, e := range valErrs.Errors {
            log.Printf("Field '%s': %s", e.FieldPath, e.Message)
        }
    }
}
```

### ValidateTask

Convenience function that combines unmarshal and validation in one call.

```go
func ValidateTask(task *workflowv1.WorkflowTask) error
```

**Example:**

```go
err := validation.ValidateTask(task)
if err != nil {
    return fmt.Errorf("task '%s' is invalid: %w", task.Name, err)
}
```

### ValidateWorkflow

Validates all tasks in a workflow.

```go
func ValidateWorkflow(spec *workflowv1.WorkflowSpec) error
```

**Example:**

```go
err := validation.ValidateWorkflow(workflowSpec)
if err != nil {
    return fmt.Errorf("workflow validation failed: %w", err)
}
```

## Error Handling

The package provides structured error types for detailed error reporting:

### ValidationError

Represents a single validation failure:

```go
type ValidationError struct {
    TaskName  string  // Name of the task that failed
    TaskKind  string  // Type of task (e.g., "HTTP_CALL")
    FieldPath string  // Path to the field that failed (e.g., "method")
    Message   string  // Human-readable error message
}
```

**Example Error:**

```
validation failed for task 'fetchData' (WORKFLOW_TASK_KIND_HTTP_CALL): 
  field 'method' value must be one of [GET, POST, PUT, DELETE, PATCH]
```

### ValidationErrors

Represents multiple validation failures:

```go
type ValidationErrors struct {
    Errors []ValidationError
}
```

**Example Error:**

```
validation failed with 2 errors:
  1. validation failed for task 'fetchData' (HTTP_CALL): field 'method' ...
  2. validation failed for task 'fetchData' (HTTP_CALL): field 'endpoint.uri' ...
```

## Integration

### With Converter

The converter package can use validation before converting to YAML:

```go
import "github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/validation"

func (c *Converter) ConvertTask(task *workflowv1.WorkflowTask) (string, error) {
    // Validate before conversion
    if err := validation.ValidateTask(task); err != nil {
        return "", fmt.Errorf("invalid task: %w", err)
    }
    
    // Continue with conversion...
}
```

### With CLI

The CLI can validate workflows before sending to backend:

```go
import "github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/validation"

func DeployWorkflow(spec *workflowv1.WorkflowSpec) error {
    // Validate entire workflow
    if err := validation.ValidateWorkflow(spec); err != nil {
        return fmt.Errorf("workflow validation failed: %w", err)
    }
    
    // Send to backend...
}
```

## Validation Rules

Validation rules are defined in proto files using `buf.validate.field` annotations:

### Required Fields

```protobuf
string method = 1 [
    (buf.validate.field).required = true
];
```

### Enum Constraints

```protobuf
string method = 1 [
    (buf.validate.field).string = {
        in: ["GET", "POST", "PUT", "DELETE", "PATCH"]
    }
];
```

### Range Constraints

```protobuf
int32 timeout_seconds = 5 [
    (buf.validate.field).int32 = {
        gte: 1
        lte: 300
    }
];
```

### Min Length

```protobuf
string uri = 1 [
    (buf.validate.field).string.min_len = 1
];
```

### Repeated Field Constraints

```protobuf
repeated SwitchCase cases = 1 [
    (buf.validate.field).repeated.min_items = 1
];
```

## Testing

The package includes comprehensive tests for all 12 task types:

```bash
# Run all validation tests
cd backend/services/workflow-runner
go test ./pkg/validation/...

# Run with verbose output
go test -v ./pkg/validation/...

# Run specific test
go test -v ./pkg/validation/... -run TestValidateHttpCallTaskConfig
```

## Test Coverage

**Unmarshal Tests** (`unmarshal_test.go`):
- Valid configs unmarshal correctly
- Invalid configs return errors
- Nested structures handled properly
- Nil config handling

**Validation Tests** (`validate_test.go`):
- Valid configs pass validation
- Missing required fields caught
- Invalid enum values caught
- Range violations caught
- Pattern violations caught
- Task and workflow-level validation

**Coverage**: 6 task types with comprehensive test cases (expandable to all 12)

## Dependencies

- `buf.build/go/protovalidate` - Runtime validation library
- `google.golang.org/protobuf` - Protocol Buffers
- `github.com/leftbin/stigmer-cloud/apis/stubs/go` - Generated proto stubs

## Example: Complete Validation Flow

```go
package main

import (
    "fmt"
    workflowv1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
    apiresourcev1 "github.com/leftbin/stigmer-cloud/apis/stubs/go/ai/stigmer/commons/apiresource"
    "github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/validation"
    "google.golang.org/protobuf/types/known/structpb"
)

func main() {
    // Create workflow spec
    httpConfig, _ := structpb.NewStruct(map[string]interface{}{
        "method": "GET",
        "endpoint": map[string]interface{}{
            "uri": "https://api.example.com/data",
        },
        "timeout_seconds": 30,
    })

    task := &workflowv1.WorkflowTask{
        Name:       "fetchData",
        Kind:       apiresourcev1.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL,
        TaskConfig: httpConfig,
    }

    // Validate task
    if err := validation.ValidateTask(task); err != nil {
        if valErrs, ok := err.(*validation.ValidationErrors); ok {
            fmt.Println("Validation failed:")
            for _, e := range valErrs.Errors {
                fmt.Printf("  - %s\n", e.Error())
            }
        } else {
            fmt.Printf("Error: %v\n", err)
        }
        return
    }

    fmt.Println("✅ Task is valid!")
}
```

## Design Principles

1. **Proto as Contract**: Proto definitions are the single source of truth for validation
2. **Type Safety**: Unmarshal to typed protos, not map[string]interface{}
3. **Clear Errors**: Validation errors include field path, task name, and context
4. **Composability**: Functions can be used independently or combined
5. **Zero Configuration**: Validation rules defined in proto, no external config needed

## Future Enhancements

1. **Additional Task Types**: Add validation for remaining task types as they're implemented
2. **Custom Validators**: Support for custom validation logic beyond proto rules
3. **Performance**: Optimize unmarshaling for large workflows
4. **Caching**: Cache validators for frequently used task types
5. **Better Error Messages**: Enhanced error messages with suggestions

## Related Documentation

- [Task Proto Definitions](../../../apis/ai/stigmer/agentic/workflow/v1/tasks/)
- [Workflow Spec Proto](../../../apis/ai/stigmer/agentic/workflow/v1/spec.proto)
- [Proto to YAML Converter](../converter/)
- [Buf Validate Documentation](https://buf.build/bufbuild/protovalidate)
