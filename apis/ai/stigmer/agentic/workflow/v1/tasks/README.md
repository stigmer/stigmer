# Workflow Task Configuration Definitions

This folder contains proto definitions for all workflow task configurations.

## Purpose

These proto files define the **expected schema** for each `WorkflowTaskKind`. While the main `WorkflowTask` message uses `google.protobuf.Struct` for flexibility, these definitions serve as:

1. **Source of Truth** - Canonical schemas for each task type
2. **Type Safety** - Generated classes in all 5 languages (Go, Java, Python, TS, Dart)
3. **Validation** - buf-validate rules enforce correctness
4. **Documentation** - Self-documenting schemas with examples

## Architecture Pattern

**Proto Layer** (Flexible):
```protobuf
message WorkflowTask {
  string name = 1;
  WorkflowTaskKind kind = 2;
  google.protobuf.Struct task_config = 3;  // Dynamic typed
}
```

**Backend Logic** (Type-Safe):
```go
// Unmarshal based on kind
switch task.Kind {
case WorkflowTaskKind_HTTP_CALL:
    var config tasks.HttpCallTaskConfig
    if err := unmarshalStruct(task.TaskConfig, &config); err != nil {
        return fmt.Errorf("invalid HTTP_CALL config: %w", err)
    }
    // Use type-safe config
    client := http.NewClient()
    resp, err := client.Do(config.Method, config.Endpoint.Uri, ...)
}
```

## Task Definitions

| Task Kind | Proto File | Config Message | Description |
|-----------|-----------|----------------|-------------|
| `SET` | `set.proto` | `SetTaskConfig` | Variable assignment |
| `HTTP_CALL` | `http_call.proto` | `HttpCallTaskConfig` | HTTP requests |
| `GRPC_CALL` | `grpc_call.proto` | `GrpcCallTaskConfig` | gRPC requests |
| `SWITCH` | `switch.proto` | `SwitchTaskConfig` | Conditional branching |
| `FOR` | `for.proto` | `ForTaskConfig` | Iteration/loops |
| `FORK` | `fork.proto` | `ForkTaskConfig` | Parallel execution |
| `TRY` | `try.proto` | `TryTaskConfig` | Error handling |
| `LISTEN` | `listen.proto` | `ListenTaskConfig` | Wait for signals |
| `WAIT` | `wait.proto` | `WaitTaskConfig` | Sleep/delay |
| `CALL_ACTIVITY` | `call_activity.proto` | `CallActivityTaskConfig` | Temporal activities |
| `RAISE` | `raise.proto` | `RaiseTaskConfig` | Raise errors |
| `RUN` | `run.proto` | `RunTaskConfig` | Sub-workflows |
| `AGENT_CALL` | `agent_call.proto` | `AgentCallTaskConfig` | AI agent invocation |
| `LLM_CALL` | `llm_call.proto` | `LlmCallTaskConfig` | Direct LLM calls |
| `TRANSFORM` | `transform.proto` | `TransformTaskConfig` | Data transformation |
| `HUMAN_INPUT` | `human_input.proto` | `HumanInputTaskConfig` | Workflow-level approval gate |
| `VALIDATE` | `validate.proto` | `ValidateTaskConfig` | Schema and rules validation |
| `EMIT_EVENT` | `emit_event.proto` | `EmitEventTaskConfig` | CloudEvents event emission |
| `NOTIFICATION` | `notification.proto` | `NotificationTaskConfig` | Channel-based notifications |

## Generated Stubs

After running `make protos`, stubs are generated in:

- **Go**: `apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks/*.pb.go`
- **Java**: `apis/stubs/java/src/main/java/protos/ai/stigmer/agentic/workflow/v1/tasks/*.java`
- **Python**: `apis/stubs/python/stigmer/ai/stigmer/agentic/workflow/v1/tasks/*_pb2.py`
- **TypeScript**: `apis/stubs/ts/ai/stigmer/agentic/workflow/v1/tasks/*_pb.ts`
- **Dart**: `client-apps/mobile/lib/gen/ai/stigmer/agentic/workflow/v1/tasks/*.pb.dart`

## Usage Examples

### Go (stigmer-server)

Validation-side consumption — the OSS control plane parses typed task
configs when validating workflow definitions
(`pkg/domain/workflow/validation/`):

```go
import (
    "google.golang.org/protobuf/encoding/protojson"
    pb "stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
    "stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
)

func processTask(task *pb.WorkflowTask) error {
    switch task.Kind {
    case commons.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL:
        var config tasks.HttpCallTaskConfig
        
        // Unmarshal Struct to typed config
        jsonBytes, _ := protojson.Marshal(task.TaskConfig)
        if err := protojson.Unmarshal(jsonBytes, &config); err != nil {
            return fmt.Errorf("invalid HTTP_CALL config: %w", err)
        }
        
        // Validate
        if config.Method == "" {
            return fmt.Errorf("method is required")
        }
        
        // Use typed fields
        fmt.Printf("Making %s request to %s\n", config.Method, config.Endpoint.Uri)
        
    case commons.WorkflowTaskKind_WORKFLOW_TASK_KIND_SWITCH:
        var config tasks.SwitchTaskConfig
        // ... similar pattern
    }
    return nil
}
```

### Java (stigmer-service)

```java
import protos.ai.stigmer.agentic.workflow.v1.WorkflowTask;
import protos.ai.stigmer.agentic.workflow.v1.tasks.HttpCallTaskConfig;
import protos.ai.stigmer.commons.apiresource.WorkflowTaskKind;
import com.google.protobuf.util.JsonFormat;

public class TaskProcessor {
    public void processTask(WorkflowTask task) throws Exception {
        switch (task.getKind()) {
            case WORKFLOW_TASK_KIND_HTTP_CALL:
                // Convert Struct to JSON
                String json = JsonFormat.printer().print(task.getTaskConfig());
                
                // Parse to typed config
                HttpCallTaskConfig.Builder builder = HttpCallTaskConfig.newBuilder();
                JsonFormat.parser().merge(json, builder);
                HttpCallTaskConfig config = builder.build();
                
                // Use typed fields
                System.out.printf("Making %s request to %s%n", 
                    config.getMethod(), 
                    config.getEndpoint().getUri());
                break;
        }
    }
}
```

Execution-side note: the TypeScript runner (`backend/services/runner`)
interprets workflow definitions through its own engine types
(`src/workflow-engine/types.ts`) rather than these stubs — the stubs
serve control-plane validation, SDKs, and tooling.

## Benefits

### 1. Flexibility + Type Safety
- Proto stays flexible (can evolve without breaking changes)
- Backend gets type-safe structs (compile-time checks)

### 2. Autogenerated Documentation
Each proto file is self-documenting with:
- Field descriptions
- Validation rules
- YAML examples
- Reference to pattern catalog

### 3. Multi-Language Support
Same schema definitions work across all backend services:
- stigmer-server (Go, OSS control plane)
- stigmer-service (Java, cloud control plane)
- SDKs and tooling (TypeScript, Python, Dart stubs)

### 4. Better Error Messages
Backend can provide specific validation errors:
```
Error: invalid HTTP_CALL config: field 'method' is required
Error: invalid SWITCH config: must have at least 1 case
Error: invalid FOR config: field 'in' must be a valid expression
```

## Validation Strategy

Each task config has **two layers** of validation:

1. **Proto Validation** (buf-validate rules)
   - Runs at proto generation time
   - Enforces required fields, enums, ranges
   - Example: `method` must be one of GET, POST, PUT, DELETE, PATCH

2. **Runtime Validation** (backend logic)
   - Runs when unmarshaling Struct → typed config
   - Checks expression syntax
   - Validates references (task names, etc.)
   - Example: `${ $context.value > 5 }` has valid syntax

## Reference Documentation

- **Pattern Catalog**: `_projects/2026-01/20260115.01.workflow-orchestration-proto-redesign/reference/zigflow-dsl-pattern-catalog.md`
- **Main Spec**: `../spec.proto`
- **Enum Definition**: `ai/stigmer/commons/apiresource/enum.proto`

## Regenerating Stubs

After modifying any `.proto` file:

```bash
# From repo root
make protos
```

This regenerates all stubs for Go, Java, Python, TypeScript, and Dart.

---

**Status**: ✅ All 19 task configs defined and stubs generated  
**Last Updated**: 2026-05-12
