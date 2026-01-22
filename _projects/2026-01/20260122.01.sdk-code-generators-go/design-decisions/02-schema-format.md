# Stigmer Schema Format Design

**Phase**: Research & Design  
**Date**: 2026-01-22  
**Status**: 🟢 IN PROGRESS

---

## Overview

This document defines the JSON schema format for Stigmer SDK code generation.

**Purpose**: Intermediate representation between Protocol Buffers and generated Go code.

**Design Principles**:
1. Language-agnostic (could support Python, TypeScript later)
2. Contains all info needed for code generation
3. Simple to parse and validate
4. Preserves proto metadata (comments, validations)

---

## Schema Structure

### Top-Level Package Schema

```json
{
  "name": "workflow",
  "version": "1.0.0",
  "description": "Stigmer Workflow SDK",
  "goPackage": "github.com/stigmer/stigmer/sdk/go/workflow",
  
  "taskConfigs": [
    {
      "name": "SetTaskConfig",
      "kind": "SET",
      "description": "SET tasks assign variables in workflow state",
      "protoType": "ai.stigmer.agentic.workflow.v1.tasks.SetTaskConfig",
      "fields": [...]
    }
  ],
  
  "sharedTypes": [
    {
      "name": "HttpEndpoint",
      "description": "HTTP endpoint configuration",
      "protoType": "ai.stigmer.agentic.workflow.v1.tasks.HttpEndpoint",
      "fields": [...]
    }
  ]
}
```

### Task Config Schema

```json
{
  "name": "SetTaskConfig",
  "kind": "SET",
  "description": "SET tasks assign variables in workflow state.\n\nYAML Example:\n  - taskName:\n      set:\n        variable1: value\n        variable2: ${ expression }",
  "protoType": "ai.stigmer.agentic.workflow.v1.tasks.SetTaskConfig",
  "protoFile": "apis/ai/stigmer/agentic/workflow/v1/tasks/set.proto",
  
  "fields": [
    {
      "name": "Variables",
      "jsonName": "variables",
      "protoField": "variables",
      "type": {
        "kind": "map",
        "keyType": "string",
        "valueType": "string"
      },
      "description": "Variables to set in workflow state. Keys are variable names, values can be literals or expressions.",
      "required": true,
      "validation": {
        "required": true
      }
    }
  ]
}
```

### Field Type System

#### Primitive Types

```json
{
  "type": {
    "kind": "string"
  }
}
```

Supported primitives:
- `"string"` → `string`
- `"int32"` → `int32`
- `"int64"` → `int64`
- `"bool"` → `bool`
- `"float"` → `float32`
- `"double"` → `float64`
- `"bytes"` → `[]byte`

#### Map Types

```json
{
  "type": {
    "kind": "map",
    "keyType": "string",
    "valueType": "string"
  }
}
```

Maps to: `map[string]string`

#### Array Types

```json
{
  "type": {
    "kind": "array",
    "elementType": {
      "kind": "string"
    }
  }
}
```

Maps to: `[]string`

#### Message Types (Nested Structs)

```json
{
  "type": {
    "kind": "message",
    "messageType": "HttpEndpoint"
  }
}
```

Maps to: `*HttpEndpoint` (pointer for proto compatibility)

#### Struct Type (google.protobuf.Struct)

```json
{
  "type": {
    "kind": "struct"
  }
}
```

Maps to: `map[string]interface{}`

#### Enum Types

```json
{
  "type": {
    "kind": "enum",
    "enumType": "HttpMethod",
    "values": ["GET", "POST", "PUT", "DELETE", "PATCH"]
  }
}
```

Maps to: `string` (for simplicity in SDK, validation in proto)

---

## Complete Example: SetTaskConfig

```json
{
  "name": "SetTaskConfig",
  "kind": "SET",
  "description": "SET tasks assign variables in workflow state.\n\nYAML Example:\n  - taskName:\n      set:\n        variable1: value\n        variable2: ${ expression }\n        computed: ${ .a + .b }",
  "protoType": "ai.stigmer.agentic.workflow.v1.tasks.SetTaskConfig",
  "protoFile": "apis/ai/stigmer/agentic/workflow/v1/tasks/set.proto",
  
  "fields": [
    {
      "name": "Variables",
      "jsonName": "variables",
      "protoField": "variables",
      "type": {
        "kind": "map",
        "keyType": "string",
        "valueType": "string"
      },
      "description": "Variables to set in workflow state. Keys are variable names, values can be literals or expressions. Expressions use ${...} syntax, e.g., \"${.a + .b}\" or \"${now}\"",
      "required": true,
      "validation": {
        "required": true
      }
    }
  ]
}
```

---

## Complete Example: HttpCallTaskConfig

```json
{
  "name": "HttpCallTaskConfig",
  "kind": "HTTP_CALL",
  "description": "HTTP_CALL tasks make HTTP requests (GET, POST, PUT, DELETE, PATCH).",
  "protoType": "ai.stigmer.agentic.workflow.v1.tasks.HttpCallTaskConfig",
  "protoFile": "apis/ai/stigmer/agentic/workflow/v1/tasks/http_call.proto",
  
  "fields": [
    {
      "name": "Method",
      "jsonName": "method",
      "protoField": "method",
      "type": {
        "kind": "string"
      },
      "description": "HTTP method (GET, POST, PUT, DELETE, PATCH)",
      "required": true,
      "validation": {
        "required": true,
        "enum": ["GET", "POST", "PUT", "DELETE", "PATCH"]
      }
    },
    {
      "name": "Endpoint",
      "jsonName": "endpoint",
      "protoField": "endpoint",
      "type": {
        "kind": "message",
        "messageType": "HttpEndpoint"
      },
      "description": "HTTP endpoint configuration",
      "required": true,
      "validation": {
        "required": true
      }
    },
    {
      "name": "Headers",
      "jsonName": "headers",
      "protoField": "headers",
      "type": {
        "kind": "map",
        "keyType": "string",
        "valueType": "string"
      },
      "description": "HTTP headers (optional). Values can contain expressions: \"Bearer ${TOKEN}\"",
      "required": false
    },
    {
      "name": "Body",
      "jsonName": "body",
      "protoField": "body",
      "type": {
        "kind": "struct"
      },
      "description": "Request body (optional). Can be any JSON structure. Supports expressions in string values.",
      "required": false
    },
    {
      "name": "TimeoutSeconds",
      "jsonName": "timeout_seconds",
      "protoField": "timeout_seconds",
      "type": {
        "kind": "int32"
      },
      "description": "Request timeout in seconds (optional, default: 30)",
      "required": false,
      "validation": {
        "min": 1,
        "max": 300
      }
    }
  ]
}
```

---

## Complete Example: SwitchTaskConfig

```json
{
  "name": "SwitchTaskConfig",
  "kind": "SWITCH",
  "description": "SWITCH tasks provide conditional branching based on expressions.",
  "protoType": "ai.stigmer.agentic.workflow.v1.tasks.SwitchTaskConfig",
  "protoFile": "apis/ai/stigmer/agentic/workflow/v1/tasks/switch.proto",
  
  "fields": [
    {
      "name": "Cases",
      "jsonName": "cases",
      "protoField": "cases",
      "type": {
        "kind": "array",
        "elementType": {
          "kind": "message",
          "messageType": "SwitchCase"
        }
      },
      "description": "List of switch cases (at least one required). Cases are evaluated in order. First matching case executes.",
      "required": true,
      "validation": {
        "required": true,
        "minItems": 1
      }
    }
  ]
}
```

### Shared Type: SwitchCase

```json
{
  "name": "SwitchCase",
  "description": "A single case in a switch statement",
  "protoType": "ai.stigmer.agentic.workflow.v1.tasks.SwitchCase",
  "protoFile": "apis/ai/stigmer/agentic/workflow/v1/tasks/switch.proto",
  
  "fields": [
    {
      "name": "Name",
      "jsonName": "name",
      "protoField": "name",
      "type": {
        "kind": "string"
      },
      "description": "Case name/identifier",
      "required": true,
      "validation": {
        "required": true,
        "minLength": 1
      }
    },
    {
      "name": "When",
      "jsonName": "when",
      "protoField": "when",
      "type": {
        "kind": "string"
      },
      "description": "Condition expression (optional). If empty, this is the default case. Example: \"${ $context.value > 5 }\"",
      "required": false
    },
    {
      "name": "Then",
      "jsonName": "then",
      "protoField": "then",
      "type": {
        "kind": "string"
      },
      "description": "Target task name to execute if condition matches",
      "required": true,
      "validation": {
        "required": true,
        "minLength": 1
      }
    }
  ]
}
```

---

## Validation Rules Schema

Validations from buf.validate annotations:

```json
{
  "validation": {
    "required": true,
    "minLength": 1,
    "maxLength": 100,
    "pattern": "^[a-zA-Z0-9_-]+$",
    "min": 1,
    "max": 300,
    "minItems": 1,
    "maxItems": 10,
    "enum": ["VALUE1", "VALUE2", "VALUE3"]
  }
}
```

---

## Generated Code Structure

For each task config schema, generate:

### 1. Config Struct

```go
// SetTaskConfig defines the configuration for SET tasks.
//
// SET tasks assign variables in workflow state.
//
// YAML Example:
//   - taskName:
//       set:
//         variable1: value
//         variable2: ${ expression }
//         computed: ${ .a + .b }
type SetTaskConfig struct {
    // Variables to set in workflow state.
    // Keys are variable names, values can be literals or expressions.
    // Expressions use ${...} syntax, e.g., "${.a + .b}" or "${now}"
    Variables map[string]string `json:"variables"`
}
```

### 2. Builder Function

```go
// SetTask creates a SET workflow task.
//
// Parameters:
//   - name: Task name (must be unique within workflow)
//   - variables: Variables to set in workflow state
//
// Example:
//   task := workflow.SetTask("init", map[string]string{
//       "userId": "12345",
//       "timestamp": "${now}",
//   })
func SetTask(name string, variables map[string]string) *WorkflowTask {
    return &WorkflowTask{
        Name: name,
        Kind: WorkflowTaskKindSet,
        TaskConfig: &SetTaskConfig{
            Variables: variables,
        },
    }
}
```

### 3. ToProto Method

```go
// ToProto converts SetTaskConfig to google.protobuf.Struct for proto marshaling.
func (c *SetTaskConfig) ToProto() (*structpb.Struct, error) {
    data := map[string]interface{}{
        "variables": c.Variables,
    }
    return structpb.NewStruct(data)
}
```

### 4. FromProto Method

```go
// FromProto converts google.protobuf.Struct to SetTaskConfig.
func (c *SetTaskConfig) FromProto(s *structpb.Struct) error {
    fields := s.GetFields()
    
    if vars, ok := fields["variables"]; ok {
        c.Variables = make(map[string]string)
        for k, v := range vars.GetStructValue().GetFields() {
            c.Variables[k] = v.GetStringValue()
        }
    }
    
    return nil
}
```

---

## Schema Storage

Schemas will be stored in:

```
tools/codegen/schemas/
├── package.json              # Top-level package schema
├── tasks/
│   ├── set.json             # SetTaskConfig schema
│   ├── http_call.json       # HttpCallTaskConfig schema
│   ├── switch.json          # SwitchTaskConfig schema
│   └── ...                  # Other task configs
└── types/
    ├── http_endpoint.json   # Shared HttpEndpoint type
    ├── switch_case.json     # Shared SwitchCase type
    └── ...                  # Other shared types
```

---

## Schema Generation Tool

**Tool**: `tools/codegen/proto2schema/`

**Input**: Proto files
**Output**: JSON schema files

```bash
# Generate schemas for all workflow tasks
go run tools/codegen/proto2schema \
  --proto-dir apis/ai/stigmer/agentic/workflow/v1/tasks \
  --output-dir tools/codegen/schemas/tasks
```

---

## Next Steps

1. ✅ Define schema format (this document)
2. ⏭️ Implement proto2schema converter
3. ⏭️ Generate schemas for all 13 task types
4. ⏭️ Validate schemas
5. ⏭️ Build code generator using schemas

---

## References

- Pulumi Schema: `pkg/codegen/schema/schema.go`
- Stigmer Task Protos: `apis/ai/stigmer/agentic/workflow/v1/tasks/*.proto`
- Protocol Buffers: https://protobuf.dev/

---

**Status**: ✅ Schema format designed, ready to implement converter
