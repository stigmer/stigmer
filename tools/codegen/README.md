# Stigmer Code Generation Tools

Automated code generation for the Stigmer Go SDK, inspired by Pulumi.

**Result**: Adding a new workflow task type takes **5 minutes** instead of 30-60 minutes.

---

## Overview

This directory contains a two-stage code generation pipeline:

1. **Proto Parser** (`proto2schema`) - Automatically generates JSON schemas from `.proto` files
2. **Code Generator** (`generator`) - Generates type-safe Go code from JSON schemas

Together, they eliminate manual proto-to-Go conversion logic and reduce development time dramatically.

---

## Quick Start

### Full Pipeline: Proto → Schema → Go Code

```bash
# Stage 1: Generate schemas from proto files
go run tools/codegen/proto2schema/main.go \
  --proto-dir apis/ai/stigmer/agentic/workflow/v1/tasks \
  --output-dir tools/codegen/schemas/tasks \
  --include-dir apis

# Stage 2: Generate Go code from schemas
go run tools/codegen/generator/main.go \
  --schema-dir tools/codegen/schemas \
  --output-dir sdk/go/workflow/gen \
  --package gen

# Verify compilation
cd sdk/go/workflow && go build .
```

---

## Dependency Management

**How proto dependencies (like `buf/validate`) are handled:**

1. **Dependencies declared in `apis/buf.yaml`**:
   ```yaml
   deps:
     - buf.build/bufbuild/protovalidate
   ```

2. **Version-locked in `apis/buf.lock`**:
   - Ensures reproducible builds
   - Updated via `cd apis && buf dep update`

3. **Buf CLI manages the cache**:
   - When you run `make protos` (or any buf command), buf downloads dependencies to `~/.cache/buf/v3/modules/`
   - The proto2schema tool automatically finds and uses this cache

4. **No manual dependency management needed**:
   - ✅ No stub files to maintain
   - ✅ No version drift
   - ✅ Automatic updates when buf.lock changes
   - ✅ Integrates with existing `make protos` workflow

**TL;DR:** Just run `make protos` once, and all dependencies are handled automatically by buf!

---

## Tools

### 1. Proto Parser (`proto2schema/main.go`)

**Status**: ✅ Production-ready (Option B complete)

Automatically generates JSON schemas from Protocol Buffer definitions.

#### What It Does

- Parses `.proto` files using `jhump/protoreflect`
- Extracts message definitions, field types, and documentation
- Recursively collects nested type dependencies
- Generates JSON schemas compatible with the code generator
- Handles primitives, maps, arrays, messages, and `google.protobuf.Struct`

#### Usage

```bash
go run tools/codegen/proto2schema/main.go \
  --proto-dir <path-to-protos> \
  --output-dir <output-path> \
  [--include-dir <import-path>] \
  [--stub-dir <stub-path>]
```

**Flags**:
- `--proto-dir`: Directory containing `.proto` files to parse (required)
- `--output-dir`: Output directory for JSON schemas (required)
- `--include-dir`: Directory containing proto imports (default: `apis`)
- `--use-buf-cache`: Use buf's module cache for dependencies (default: `true`)

#### Example Output

From `apis/ai/stigmer/agentic/workflow/v1/tasks/set.proto`:

```json
{
  "name": "SetTaskConfig",
  "kind": "SET",
  "description": "SET tasks assign variables in workflow state.",
  "protoType": "ai.stigmer.agentic.workflow.v1.tasks.SetTaskConfig",
  "protoFile": "apis/ai/stigmer/agentic/workflow/v1/tasks/set.proto",
  "fields": [
    {
      "name": "Variables",
      "jsonName": "variables",
      "protoField": "variables",
      "type": {
        "kind": "map",
        "keyType": {"kind": "string"},
        "valueType": {"kind": "string"}
      },
      "description": "Variables to set in workflow state.",
      "required": false
    }
  ]
}
```

#### What It Extracts

✅ **Core Functionality**:
- Message definitions and field structures
- All primitive types (string, int32, int64, bool, float, double, bytes)
- Map fields with correct key/value types
- Array/repeated fields
- Nested message type references
- `google.protobuf.Struct` as `map[string]interface{}`
- Leading comments and documentation
- JSON field names

✅ **Nested Type Handling**:
- Recursively extracts dependencies (3+ levels deep)
- Generates shared type schemas to `types/` subdirectory
- Avoids duplicates and infinite recursion
- Properly handles cross-file type references

⚠️ **Known Limitations**:
- `buf.validate` extension parsing is partial (required fields work, numeric/string constraints unreliable)
- Not critical - validation can be added manually if needed

#### Performance

- Parses 13 proto files in ~2 seconds
- Full pipeline (proto → schema → code) in ~5 seconds

---

### 2. Code Generator (`generator/main.go`)

**Status**: ✅ Production-ready (Phase 2 complete)

Generates type-safe Go code from JSON schemas.

#### What It Generates

- **Config Structs**: Type-safe structs with proper JSON tags
- **ToProto Methods**: Converts Go structs to `google.protobuf.Struct`
- **FromProto Methods**: Converts `google.protobuf.Struct` to Go structs
- **Interface Markers**: `isTaskConfig()` methods for type safety
- **Helper Utilities**: Shared functions like `isEmpty()`

**Note**: Builder functions (like `SetTask()`, `HttpCallTask()`) are **NOT** generated. They belong in the ergonomic API layer (`workflow.go` and `*_options.go`), not generated code, because they reference manual SDK types like `*Task`.

#### Usage

```bash
go run tools/codegen/generator/main.go \
  --schema-dir <schema-directory> \
  --output-dir <output-directory> \
  --package <package-name>
```

**Flags**:
- `--schema-dir`: Directory containing JSON schemas (required)
- `--output-dir`: Output directory for generated Go code (required)
- `--package`: Go package name for generated code (required)

#### Example Output

From `schemas/tasks/set.json`:

```go
// Code generated by stigmer-codegen. DO NOT EDIT.

package gen

import "google.golang.org/protobuf/types/known/structpb"

// SET tasks assign variables in workflow state.
type SetTaskConfig struct {
    // Variables to set in workflow state.
    Variables map[string]string `json:"variables,omitempty"`
}

// isTaskConfig marks SetTaskConfig as a TaskConfig implementation.
func (c *SetTaskConfig) isTaskConfig() {}

// ToProto converts SetTaskConfig to google.protobuf.Struct for proto marshaling.
func (c *SetTaskConfig) ToProto() (*structpb.Struct, error) {
    data := make(map[string]interface{})
    if !isEmpty(c.Variables) {
        data["variables"] = c.Variables
    }
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

#### Generated Files

For 13 workflow task types:

```
sdk/go/workflow/gen/
├── helpers.go              # Utility functions (isEmpty, etc.)
├── types.go                # Shared types (HttpEndpoint, AgentExecutionConfig, etc.)
├── set_task.go             # SET task config + methods
├── httpcall_task.go        # HTTP_CALL task config + methods
├── grpccall_task.go        # GRPC_CALL task config + methods
├── agentcall_task.go       # AGENT_CALL task config + methods
├── switch_task.go          # SWITCH task config + methods
├── for_task.go             # FOR task config + methods
├── fork_task.go            # FORK task config + methods
├── try_task.go             # TRY task config + methods
├── listen_task.go          # LISTEN task config + methods
├── wait_task.go            # WAIT task config + methods
├── callactivity_task.go    # CALL_ACTIVITY task config + methods
├── raise_task.go           # RAISE task config + methods
└── run_task.go             # RUN task config + methods
```

---

## Directory Structure

```
tools/codegen/
├── proto2schema/
│   ├── main.go              # Proto parser (~585 lines)
│   └── BUILD.bazel
├── generator/
│   ├── main.go              # Code generator (~735 lines)
│   └── BUILD.bazel
├── schemas/
│   ├── tasks/               # 13 task config schemas
│   │   ├── set.json
│   │   ├── http_call.json
│   │   ├── grpc_call.json
│   │   ├── agent_call.json
│   │   ├── switch.json
│   │   ├── for.json
│   │   ├── fork.json
│   │   ├── try.json
│   │   ├── listen.json
│   │   ├── wait.json
│   │   ├── call_activity.json
│   │   ├── raise.json
│   │   └── run.json
│   └── types/               # Shared type schemas (auto-generated)
│       ├── httpendpoint.json
│       ├── agentexecutionconfig.json
│       ├── signalspec.json
│       └── ... (10 total)
├── README.md                # This file
└── go.mod                   # Go module for tools
```

---

## Workflows

### Adding a New Task Type (From Scratch)

**Time**: ~5 minutes (vs 30-60 minutes manual)

**Steps**:

1. **Write Proto Definition** (`apis/ai/stigmer/agentic/workflow/v1/tasks/my_task.proto`):
   ```protobuf
   message MyTaskConfig {
     string field1 = 1 [(buf.validate.field).string.min_len = 1];
     int32 field2 = 2;
   }
   ```

2. **Generate Schema**:
   ```bash
   go run tools/codegen/proto2schema/main.go \
     --proto-dir apis/ai/stigmer/agentic/workflow/v1/tasks \
     --output-dir tools/codegen/schemas/tasks
   ```

3. **Generate Go Code**:
   ```bash
   go run tools/codegen/generator/main.go \
     --schema-dir tools/codegen/schemas \
     --output-dir sdk/go/workflow/gen \
     --package gen
   ```

4. **Add TaskKind Constant** (`sdk/go/workflow/task.go`):
   ```go
   const (
       // ... existing kinds ...
       TaskKindMyTask TaskKind = "MY_TASK"
   )
   ```

5. **Add Ergonomic API** (optional, `sdk/go/workflow/mytask_options.go`):
   ```go
   func (w *Workflow) MyTask(name string, opts ...MyTaskOption) *Task {
       config := &gen.MyTaskConfig{}
       for _, opt := range opts {
           opt(config)
       }
       // ... create task ...
   }
   ```

6. **Verify**:
   ```bash
   cd sdk/go/workflow && go build .
   ```

---

### Updating an Existing Task (Proto Changes)

**Time**: ~2 minutes

1. **Modify Proto File** (add/remove/change fields)

2. **Regenerate Schema**:
   ```bash
   go run tools/codegen/proto2schema/main.go \
     --proto-dir apis/ai/stigmer/agentic/workflow/v1/tasks \
     --output-dir tools/codegen/schemas/tasks
   ```

3. **Regenerate Go Code**:
   ```bash
   go run tools/codegen/generator/main.go \
     --schema-dir tools/codegen/schemas \
     --output-dir sdk/go/workflow/gen \
     --package gen
   ```

4. **Update Options Functions** (if adding new fields to ergonomic API)

5. **Verify**:
   ```bash
   cd sdk/go/workflow && go build .
   ```

---

## Schema Format Reference

### Task Config Schema

```json
{
  "name": "TaskNameConfig",
  "kind": "TASK_NAME",
  "description": "Task description...",
  "protoType": "ai.stigmer.agentic.workflow.v1.tasks.TaskNameConfig",
  "protoFile": "apis/ai/stigmer/agentic/workflow/v1/tasks/task_name.proto",
  "fields": [
    {
      "name": "FieldName",
      "jsonName": "fieldName",
      "protoField": "field_name",
      "type": { "kind": "string" },
      "description": "Field description",
      "required": true,
      "validation": {
        "required": true,
        "minLength": 1,
        "maxLength": 100
      }
    }
  ]
}
```

### Type Specifications

**Primitives**:
```json
{"kind": "string"}
{"kind": "int32"}
{"kind": "int64"}
{"kind": "bool"}
{"kind": "float"}
{"kind": "double"}
{"kind": "bytes"}
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
    "minItems": 1,
    "maxItems": 10,
    "enum": ["VALUE1", "VALUE2"]
  }
}
```

---

## Troubleshooting

### Proto Parser Issues

**Error: "failed to parse proto files"**
- Verify `--proto-dir` points to valid directory with `.proto` files
- Check that `--include-dir` contains proto imports
- Ensure proto syntax is valid (`protoc --lint`)

**Error: "import not found"**
- Ensure `make protos` has been run at least once (this populates buf's cache)
- The tool automatically uses buf's module cache at `~/.cache/buf/v3/modules/`
- Dependencies are defined in `apis/buf.yaml` and locked via `apis/buf.lock`
- If issues persist, run `cd apis && buf dep update` to refresh dependencies

**Missing validation rules in schemas**
- This is expected - `buf.validate` extension parsing is partial
- Manually add validation rules to generated schemas if needed
- Or skip validation - code will still work

### Code Generator Issues

**Generated code doesn't compile**
- Verify schema JSON is valid (`jq . schema.json`)
- Check that all required fields are present in schema
- Ensure type specifications are correct
- Verify nested message types exist

**Import errors in generated code**
- Generator auto-manages imports
- If issues occur, regenerate from scratch
- Check that type names match exactly

**Type mapping issues**
- Verify `type.kind` in schema matches one of: string, int32, int64, bool, float, double, bytes, map, array, message, struct
- For maps, ensure `keyType` and `valueType` are present
- For arrays, ensure `elementType` is present
- For messages, ensure `messageType` matches struct name

### Integration Issues

**Builder functions reference undefined types**
- Builder functions are no longer generated
- They belong in manual API layer (`workflow.go`, `*_options.go`)
- Generated code only includes structs, ToProto, FromProto, and isTaskConfig

**TaskKind constant not found**
- Add constant to `sdk/go/workflow/task.go`:
  ```go
  const TaskKindYourTask TaskKind = "YOUR_TASK"
  ```

---

## Architecture

### Design Principles

1. **Generated code = Foundation**: Structs, conversion methods, interface markers
2. **Manual code = Ergonomics**: Workflow builder API, functional options, validation
3. **Schema as Source of Truth**: JSON schemas bridge proto and Go
4. **Automation over Manual**: Proto → Schema → Code (no manual conversion logic)

### Layer Separation

```
┌─────────────────────────────────────────────┐
│  Manual API Layer (Ergonomics)              │
│  - workflow.go (Workflow type, builder)     │
│  - *_options.go (functional options)        │
│  - validation.go (validation logic)         │
└─────────────────────────────────────────────┘
                    ↓ uses
┌─────────────────────────────────────────────┐
│  Generated Code (Foundation)                │
│  - *_task.go (config structs)               │
│  - types.go (shared types)                  │
│  - ToProto/FromProto methods                │
│  - isTaskConfig() markers                   │
└─────────────────────────────────────────────┘
                    ↓ generated from
┌─────────────────────────────────────────────┐
│  JSON Schemas (Source of Truth)             │
│  - schemas/tasks/*.json                     │
│  - schemas/types/*.json                     │
└─────────────────────────────────────────────┘
                    ↓ generated from
┌─────────────────────────────────────────────┐
│  Proto Definitions (API Contract)           │
│  - apis/.../tasks/*.proto                   │
└─────────────────────────────────────────────┘
```

### Why Two Stages?

**Stage 1 (Proto → Schema)** allows:
- Manual schema editing (if needed)
- Schema validation
- Version control of schemas separate from protos
- Optional: skip proto step, write schemas directly

**Stage 2 (Schema → Code)** allows:
- Multiple languages from same schema (future: Python, TypeScript)
- Customizable code generation templates
- Stable schema format even if proto changes

---

## Development

### Testing the Full Pipeline

```bash
# Clean slate
rm -rf tools/codegen/schemas/tasks/*.json
rm -rf sdk/go/workflow/gen/*.go

# Stage 1: Proto → Schema
go run tools/codegen/proto2schema/main.go \
  --proto-dir apis/ai/stigmer/agentic/workflow/v1/tasks \
  --output-dir tools/codegen/schemas/tasks \
  --include-dir apis

# Verify schemas created
ls -la tools/codegen/schemas/tasks/

# Stage 2: Schema → Go Code
go run tools/codegen/generator/main.go \
  --schema-dir tools/codegen/schemas \
  --output-dir sdk/go/workflow/gen \
  --package gen

# Verify Go files created
ls -la sdk/go/workflow/gen/

# Test compilation
cd sdk/go/workflow && go build .
```

### Modifying the Generator

Both tools are self-contained single-file programs:
- `proto2schema/main.go`: ~585 lines
- `generator/main.go`: ~735 lines

No external code generation frameworks required.

**Key functions to modify**:

**Proto Parser**:
- `extractFieldSchema()`: Field extraction logic
- `extractTypeSpec()`: Type mapping (proto → schema)
- `extractValidation()`: Validation rule extraction
- `collectNestedTypes()`: Dependency resolution

**Code Generator**:
- `genConfigStruct()`: Struct generation
- `genToProtoMethod()`: ToProto method generation
- `genFromProtoMethod()`: FromProto method generation
- `goType()`: Type mapping (schema → Go)

### Running Tests

```bash
# Proto parser
cd tools/codegen/proto2schema
go build .

# Code generator
cd tools/codegen/generator
go build .

# Full SDK
cd sdk/go/workflow
go test ./...
```

---

## References

**Documentation**:
- [Architecture Doc](../../docs/architecture/sdk-code-generation.md)
- [ADR](../../docs/adr/20260118-181912-sdk-code-generators.md)
- [Project Folder](../../_projects/2026-01/20260122.01.sdk-code-generators-go/)

**Inspiration**:
- [Pulumi Codegen](https://github.com/pulumi/pulumi/tree/master/pkg/codegen)
- [protoreflect](https://github.com/jhump/protoreflect)
- [buf.validate](https://buf.build/bufbuild/protovalidate)

---

## Status

✅ **Production-Ready**: Option B (proto parser) complete!

**Current State**:
- ✅ Proto parser working (13 tasks + 10 shared types)
- ✅ Code generator working (clean, compilable Go code)
- ✅ Full pipeline: proto → schema → code operational
- ✅ All 13 workflow task types generated and compiling
- ✅ Builder functions removed from generated code (belong in manual API)
- ✅ Comprehensive documentation

**Time Saved**: 25-55 minutes per new task type!

---

**Last Updated**: 2026-01-22 (Option B Complete)
