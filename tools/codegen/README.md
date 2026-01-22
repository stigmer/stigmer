# Stigmer Code Generation Tools

Code generation tools for the Stigmer Go SDK.

## Overview

This directory contains tools to generate type-safe Go code from JSON schemas, eliminating manual proto-to-Go conversion logic.

**Result**: Adding a new workflow task takes 5 minutes instead of 30-60 minutes.

---

## Tools

### Code Generator (`generator/main.go`)

Generates Go code from JSON schemas.

**Usage**:
```bash
go run tools/codegen/generator/main.go \
  --schema-dir tools/codegen/schemas \
  --output-dir sdk/go/workflow \
  --package workflow
```

**Generates**:
- Config structs with proper types and tags
- Builder functions (e.g., `SetTask`, `HttpCallTask`)
- ToProto/FromProto conversion methods
- Helper utilities

**Flags**:
- `--schema-dir`: Directory containing JSON schemas (required)
- `--output-dir`: Output directory for generated Go code (required)
- `--package`: Go package name (required)

### Proto Parser (`proto2schema/main.go`)

*Status: Skeleton - not yet implemented*

Will auto-generate JSON schemas from proto files when completed.

---

## Directory Structure

```
tools/codegen/
├── generator/
│   └── main.go           # Code generator (650+ lines, self-contained)
├── proto2schema/
│   └── main.go           # Proto parser (future)
└── schemas/
    └── tasks/
        ├── set.json      # Task schemas (13 total)
        ├── http_call.json
        ├── grpc_call.json
        ├── switch.json
        ├── for.json
        ├── fork.json
        ├── try.json
        ├── listen.json
        ├── wait.json
        ├── call_activity.json
        ├── raise.json
        ├── run.json
        └── agent_call.json
```

---

## Quick Start

### Regenerate All Code

```bash
cd /path/to/stigmer

go run tools/codegen/generator/main.go \
  --schema-dir tools/codegen/schemas \
  --output-dir sdk/go/workflow \
  --package workflow
```

### Add a New Task Type

**1. Create Schema** (`schemas/tasks/my_task.json`):
```json
{
  "name": "MyTaskConfig",
  "kind": "MY_TASK",
  "description": "MY_TASK does something useful.",
  "protoType": "ai.stigmer.agentic.workflow.v1.tasks.MyTaskConfig",
  "protoFile": "apis/ai/stigmer/agentic/workflow/v1/tasks/my_task.proto",
  "fields": [
    {
      "name": "Field1",
      "jsonName": "field1",
      "protoField": "field1",
      "type": {"kind": "string"},
      "description": "Description of field",
      "required": true,
      "validation": {"required": true}
    }
  ]
}
```

**2. Add TaskKind** (`sdk/go/workflow/task.go`):
```go
const (
    // ... existing ...
    TaskKindMyTask TaskKind = "MY_TASK"
)
```

**3. Generate**:
```bash
go run tools/codegen/generator/main.go \
  --schema-dir tools/codegen/schemas \
  --output-dir sdk/go/workflow \
  --package workflow
```

**4. Verify**:
```bash
cd sdk/go/workflow && go build .
```

**Time**: ~5 minutes total

---

## Schema Format

### Basic Structure

```json
{
  "name": "TaskNameConfig",
  "kind": "TASK_NAME",
  "description": "Task description...",
  "protoType": "ai.stigmer.agentic.workflow.v1.tasks.TaskNameConfig",
  "protoFile": "apis/ai/stigmer/agentic/workflow/v1/tasks/task_name.proto",
  "fields": [...]
}
```

### Field Structure

```json
{
  "name": "FieldName",
  "jsonName": "field_name",
  "protoField": "field_name",
  "type": {...},
  "description": "Field description",
  "required": true,
  "validation": {...}
}
```

### Type Specifications

**Primitives**:
```json
{"kind": "string"}
{"kind": "int32"}
{"kind": "bool"}
```

**Maps**:
```json
{
  "kind": "map",
  "keyType": {"kind": "string"},
  "valueType": {"kind": "string"}
}
```

**Arrays**:
```json
{
  "kind": "array",
  "elementType": {"kind": "string"}
}
```

**Nested Messages**:
```json
{
  "kind": "message",
  "messageType": "HttpEndpoint"
}
```

**google.protobuf.Struct**:
```json
{"kind": "struct"}
```

### Validation Rules

```json
{
  "validation": {
    "required": true,
    "minLength": 1,
    "maxLength": 100,
    "pattern": "^[a-z]+$",
    "min": 0,
    "max": 100,
    "enum": ["GET", "POST", "PUT", "DELETE"]
  }
}
```

---

## Generated Code Example

From `schemas/tasks/set.json`:

```go
// SET tasks assign variables in workflow state.
type SetTaskConfig struct {
    // Variables to set in workflow state.
    Variables map[string]string `json:"variables,omitempty"`
}

// isTaskConfig marks SetTaskConfig as a TaskConfig implementation.
func (c *SetTaskConfig) isTaskConfig() {}

// SetTask creates a Set workflow task.
func SetTask(name string, variables map[string]string) *Task {
    return &Task{
        Name: name,
        Kind: TaskKindSet,
        Config: &SetTaskConfig{
            Variables: variables,
        },
    }
}

// ToProto converts SetTaskConfig to google.protobuf.Struct.
func (c *SetTaskConfig) ToProto() (*structpb.Struct, error) {
    data := make(map[string]interface{})
    data["variables"] = c.Variables
    return structpb.NewStruct(data)
}

// FromProto converts google.protobuf.Struct to SetTaskConfig.
func (c *SetTaskConfig) FromProto(s *structpb.Struct) error {
    fields := s.GetFields()
    if val, ok := fields["variables"]; ok {
        c.Variables = make(map[string]string)
        for k, v := range val.GetStructValue().GetFields() {
            c.Variables[k] = v.GetStringValue()
        }
    }
    return nil
}
```

---

## Troubleshooting

### Generated Code Doesn't Compile

**Check**:
1. Schema syntax is valid JSON
2. All required fields present in schema
3. Type specifications are correct
4. TaskKind constant exists in task.go

**Fix**:
1. Validate schema structure
2. Regenerate code
3. Check generator output for errors

### Import Errors

Generator automatically manages imports. If import issues occur:
1. Check generated file for missing imports
2. Verify type names match exactly
3. Regenerate

### Type Mapping Issues

If Go type doesn't match expectation:
1. Check schema type specification
2. Verify type mapping in generator
3. Update schema or generator as needed

---

## Development

### Generator Implementation

The generator is self-contained (no external dependencies):
- Single file: `generator/main.go`
- ~650 lines of Go code
- Can be run with `go run`

**Key Components**:
- Schema loading
- Type mapping
- Code generation (fmt.Fprintf)
- Import management
- Formatting (go/format)

### Testing Generated Code

```bash
# Generate code
go run tools/codegen/generator/main.go \
  --schema-dir tools/codegen/schemas \
  --output-dir sdk/go/workflow \
  --package workflow

# Test compilation
cd sdk/go/workflow && go build .

# Run tests
go test ./sdk/go/workflow/...
```

---

## Architecture Documentation

For detailed architecture and design decisions:
- **Architecture**: [docs/architecture/sdk-code-generation.md](../../docs/architecture/sdk-code-generation.md)
- **ADR**: [docs/adr/20260118-181912-sdk-code-generators.md](../../docs/adr/20260118-181912-sdk-code-generators.md)
- **Project**: [_projects/2026-01/20260122.01.sdk-code-generators-go/](../../_projects/2026-01/20260122.01.sdk-code-generators-go/)

---

**Status**: Production-ready and working! All 13 workflow task types generated and compiling.
