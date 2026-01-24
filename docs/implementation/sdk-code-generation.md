# SDK Code Generation

This document explains the automated code generation pipeline for the Stigmer Go SDK, which generates typed Go structures from Protocol Buffer definitions.

## Overview

The SDK uses a two-stage code generation pipeline:

1. **Proto → JSON Schemas** (`proto2schema`)
2. **JSON Schemas → Go Code** (`generator`)

This separation allows proto parsing complexities to be handled separately from Go-specific code generation patterns.

## Quick Start

```bash
# Full pipeline (proto → schemas → Go code)
cd sdk/go
make codegen

# Or run stages separately:
make codegen-schemas  # Stage 1: Proto → JSON
make codegen-go       # Stage 2: JSON → Go
```

## Architecture

### Stage 1: proto2schema

**Purpose**: Convert `.proto` files to JSON schema files

**Input**: Protocol Buffer files
```
apis/ai/stigmer/agentic/workflow/v1/tasks/*.proto
```

**Output**: JSON schema files
```
tools/codegen/schemas/tasks/*.json      # Task configs
tools/codegen/schemas/types/*.json      # Shared types
```

**What it does**:
- Parses proto files using `github.com/jhump/protoreflect`
- Extracts message definitions (TaskConfig types, shared types)
- Captures field names, types, comments, and validation rules
- Detects nested message types (e.g., `SwitchCase` from `repeated SwitchCase`)
- Writes JSON schemas for code generation

**Example**: `switch.proto` → `switch.json` + `switchcase.json`

```proto
// Input: switch.proto
message SwitchTaskConfig {
  repeated SwitchCase cases = 1;
}

message SwitchCase {
  string name = 1;
  string when = 2;
  string then = 3;
}
```

```json
// Output: switch.json
{
  "name": "SwitchTaskConfig",
  "fields": [{
    "name": "Cases",
    "type": {
      "kind": "array",
      "elementType": {
        "kind": "message",
        "messageType": "SwitchCase"
      }
    }
  }]
}

// Output: types/switchcase.json
{
  "name": "SwitchCase",
  "fields": [
    {"name": "Name", "type": {"kind": "string"}},
    {"name": "When", "type": {"kind": "string"}},
    {"name": "Then", "type": {"kind": "string"}}
  ]
}
```

### Stage 2: generator

**Purpose**: Generate Go source code from JSON schemas

**Input**: JSON schema files
```
tools/codegen/schemas/tasks/*.json
tools/codegen/schemas/types/*.json
```

**Output**: Go source files
```
sdk/go/workflow/*taskconfig_task.go  # Task configs
sdk/go/types/agentic_types.go        # Shared types
```

**What it does**:
- Loads all JSON schemas
- Generates Go structs with proper types
- Creates ToProto/FromProto conversion methods
- Handles cross-package references (workflow → types)
- Deduplicates types that appear in multiple places

**Example**: `switchcase.json` → `SwitchCase` Go struct

```go
// Generated: sdk/go/types/agentic_types.go
type SwitchCase struct {
    Name string `json:"name,omitempty"`
    When string `json:"when,omitempty"`  
    Then string `json:"then,omitempty"`
}

// Generated: sdk/go/workflow/switchtaskconfig_task.go
type SwitchTaskConfig struct {
    Cases []*types.SwitchCase `json:"cases,omitempty"`
}
```

## Type System

### Primitive Types

| Proto Type | Go Type |
|------------|---------|
| `string` | `string` |
| `int32` | `int32` |
| `int64` | `int64` |
| `bool` | `bool` |
| `float` | `float32` |
| `double` | `float64` |
| `bytes` | `[]byte` |

### Complex Types

**Maps**:
```proto
map<string, string> headers = 1;
```
```go
Headers map[string]string `json:"headers,omitempty"`
```

**Arrays**:
```proto
repeated string items = 1;
```
```go
Items []string `json:"items,omitempty"`
```

**Nested Messages**:
```proto
repeated SwitchCase cases = 1;
```
```go
Cases []*types.SwitchCase `json:"cases,omitempty"`
```

**Structs** (google.protobuf.Struct):
```proto
google.protobuf.Struct data = 1;
```
```go
Data map[string]interface{} `json:"data,omitempty"`
```

### Shared Types

Shared types (used by multiple task configs) are generated in `sdk/go/types/`:

**Workflow Task Types** (`types/agentic_types.go`):
- `SwitchCase` - Switch condition cases
- `ForkBranch` - Parallel execution branches
- `WorkflowTask` - Nested workflow tasks
- `CatchBlock` - Error handling blocks
- etc.

**Agent Types** (also in `types/agentic_types.go`):
- `AgentExecutionConfig` - Agent runtime configuration
- `HttpServer` - HTTP endpoint configuration
- `DockerServer` - Docker container configuration
- etc.

**Why a separate types package?**
- Avoids circular imports between workflow task configs
- Single source of truth for shared structures
- Cleaner cross-package references

## buf/validate Dependency

**Current Solution (Temporary)**:

proto2schema requires buf/validate proto definitions for parsing validation rules. Currently uses a minimal stub at `/tmp/proto-stubs/buf/validate/validate.proto`.

**Stub Content**:
```proto
syntax = "proto3";
package buf.validate;

extend google.protobuf.FieldOptions {
  optional FieldConstraints field = 1071;
}

message FieldConstraints {
  optional StringRules string = 2;
  optional Int32Rules int32 = 3;
  optional FloatRules float = 5;
  optional RepeatedRules repeated = 8;
}
// ... additional rules
```

**Future Solutions**:
1. Bundle minimal buf/validate.proto in `tools/codegen/stubs/`
2. Download from buf.build during generation
3. Use go module for buf.validate protos

**Tracked in**: Task T07 Phase 2

## Adding New Task Types

When adding a new workflow task type:

### 1. Define Proto Message

Create proto file: `apis/ai/stigmer/agentic/workflow/v1/tasks/newtask.proto`

```proto
syntax = "proto3";

package ai.stigmer.agentic.workflow.v1.tasks;

message NewTaskTaskConfig {
  string name = 1;
  repeated string items = 2;
}
```

### 2. Regenerate Schemas and Code

```bash
cd sdk/go
make codegen
```

### 3. Verify Generated Files

Check that files were created:
```
tools/codegen/schemas/tasks/newtask.json
sdk/go/workflow/newtasktaskconfig_task.go
```

### 4. Add Helper Methods (Optional)

Create `sdk/go/workflow/newtask_options.go` for ergonomic helpers:

```go
package workflow

// NewTask creates a NewTask workflow task with common defaults
func NewTask(name string, items []string) *Task {
    return &Task{
        Name: name,
        Kind: TaskKindNewTask,
        Config: &NewTaskTaskConfig{
            Name:  name,
            Items: items,
        },
    }
}
```

### 5. Add to Workflow Builder (Optional)

Add method to `Workflow` type in `sdk/go/workflow/workflow.go`:

```go
// NewTask creates a NewTask task in this workflow
func (w *Workflow) NewTask(name string, items []string) *Task {
    task := NewTask(name, items)
    w.AddTask(task)
    return task
}
```

### 6. Update Examples

Add example usage in `sdk/go/examples/`.

## Troubleshooting

### Schema Generation Fails

**Error**: `open apis/buf/validate/validate.proto: no such file or directory`

**Solution**: Create buf/validate stub (temporary):
```bash
mkdir -p /tmp/proto-stubs/buf/validate
# Copy stub from another machine or create manually
```

**Permanent Solution**: Tracked in Task T07 Phase 2

### Duplicate Type Definitions

**Error**: `Type X redeclared in this block`

**Cause**: Type exists in both `types/` and `agent/types/` schemas

**Solution**: Deduplication is automatic in generator (loads types/, then agent/types/, skipping duplicates)

### Missing Type References

**Error**: `undefined: types.SomeType`

**Cause**: Shared type not loaded by generator

**Solution**: Ensure type schema exists in `tools/codegen/schemas/types/` and regenerate

### Old Files Conflict with Generated

**Error**: Task config redeclared

**Cause**: Old hand-written `*_task.go` files conflict with generated `*taskconfig_task.go`

**Solution**: Delete old hand-written files:
```bash
cd sdk/go/workflow
rm -f agentcall_task.go switch_task.go # etc.
```

Generator owns `*taskconfig_task.go` files. Hand-written code belongs in `*_options.go`.

## File Organization

```
stigmer/
├── apis/
│   └── ai/stigmer/agentic/workflow/v1/tasks/
│       ├── switch.proto              # Source proto
│       └── *.proto                   # Other task protos
├── tools/codegen/
│   ├── proto2schema/
│   │   └── main.go                   # Stage 1: Proto → JSON
│   ├── generator/
│   │   └── main.go                   # Stage 2: JSON → Go
│   └── schemas/
│       ├── tasks/
│       │   ├── switch.json           # Task config schemas
│       │   └── *.json
│       └── types/
│           ├── switchcase.json       # Shared type schemas
│           └── *.json
└── sdk/go/
    ├── Makefile                      # make codegen targets
    ├── types/
    │   ├── agentic_types.go          # Generated shared types
    │   └── commons_types.go
    └── workflow/
        ├── switchtaskconfig_task.go  # Generated task config
        ├── switch_options.go         # Hand-written helpers
        └── *.go
```

## Design Decisions

### Why Two Stages?

**Separation of Concerns**:
- Stage 1 handles proto parsing complexities (reflection, imports, validation rules)
- Stage 2 handles Go-specific patterns (interfaces, json tags, proto conversion)

**Intermediate Format**:
- JSON schemas are easier to inspect/debug than proto descriptors
- Can be version-controlled and reviewed
- Could support other language generators (Python, TypeScript) in future

### Why JSON Schemas?

**Human-Readable**:
- Easy to review changes
- Git diffs are meaningful
- Can be manually edited for testing

**Stable Interface**:
- Proto changes don't directly affect Go generation
- Can evolve stages independently

**Debugging**:
- Can inspect intermediate state
- Easier to troubleshoot generation issues

### Why Delete Old *_task.go Files?

**Single Source of Truth**:
- Generator owns struct definitions
- No confusion about which file to edit

**Consistency**:
- All task configs follow same pattern
- No manual/generated inconsistencies

**Hand-written Code**:
- Belongs in `*_options.go` (helpers, builders, ergonomic wrappers)
- Clear separation: generated config vs helper methods

## Related Documentation

- **Workflow DSL**: `docs/architecture/workflow-dsl.md`
- **Proto API Standards**: `docs/implementation/proto-api-standards.md`
- **SDK Development**: `sdk/go/README.md`

## Changelog

- **2026-01-24**: Initial documentation after fixing SwitchCase type generation
- **Future**: Automate buf/validate dependency handling

---

**Questions?** See related docs or check `_changelog/2026-01/` for implementation details.
