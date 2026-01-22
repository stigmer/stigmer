# Code Generation Strategy

**Phase**: Research & Design  
**Date**: 2026-01-22  
**Status**: 🟢 IN PROGRESS

---

## Overview

This document defines the code generation strategy for the Stigmer Go SDK.

**Goal**: Generate type-safe, idiomatic Go code from JSON schemas.

**Inspiration**: Pulumi's direct code generation approach (using `fmt.Fprintf`, not templates).

---

## Code Generation Architecture

```
┌─────────────────┐
│  Proto Files    │
│  (*.proto)      │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ proto2schema    │  (Phase 2)
│ Converter       │
└────────┬────────┘
         │
         v
┌─────────────────┐
│  JSON Schemas   │
│  (*.json)       │
└────────┬────────┘
         │
         v
┌─────────────────┐
│ Code Generator  │  (Phase 3)
│ Engine          │
└────────┬────────┘
         │
         v
┌─────────────────┐
│  Generated      │
│  Go Code        │
│  (*.go)         │
└─────────────────┘
```

---

## Generator Context

Following Pulumi's pattern, use a **context struct** to hold all generation state:

```go
package generator

import (
    "io"
    "fmt"
    "strings"
)

// GenContext holds all state for code generation
type GenContext struct {
    // Input
    schema       *PackageSchema
    taskConfigs  []*TaskConfigSchema
    sharedTypes  []*TypeSchema
    
    // State
    imports      map[string]struct{}  // Track needed imports
    generated    map[string]struct{}  // Track generated types (avoid duplicates)
    
    // Config
    outputDir    string
    packageName  string
}

// NewGenContext creates a new generation context
func NewGenContext(schema *PackageSchema, outputDir string) *GenContext {
    return &GenContext{
        schema:      schema,
        taskConfigs: schema.TaskConfigs,
        sharedTypes: schema.SharedTypes,
        imports:     make(map[string]struct{}),
        generated:   make(map[string]struct{}),
        outputDir:   outputDir,
        packageName: "workflow", // or "agent"
    }
}
```

---

## Generation Methods

### 1. Generate Config Struct

```go
// GenConfigStruct generates a Go struct for a task config
func (g *GenContext) GenConfigStruct(w io.Writer, config *TaskConfigSchema) error {
    // Generate documentation comment
    if config.Description != "" {
        g.writeComment(w, config.Description)
    }
    
    // Struct declaration
    fmt.Fprintf(w, "type %s struct {\n", config.Name)
    
    // Fields
    for _, field := range config.Fields {
        // Field comment
        if field.Description != "" {
            g.writeFieldComment(w, field.Description)
        }
        
        // Field declaration
        goType := g.goType(field.Type)
        jsonTag := fmt.Sprintf("`json:\"%s\"`", field.JsonName)
        fmt.Fprintf(w, "\t%s %s %s\n", field.Name, goType, jsonTag)
    }
    
    fmt.Fprintf(w, "}\n\n")
    return nil
}
```

### 2. Generate Builder Function

```go
// GenBuilderFunc generates a builder function for a task config
func (g *GenContext) GenBuilderFunc(w io.Writer, config *TaskConfigSchema) error {
    // Function signature
    params := g.builderParams(config)
    fmt.Fprintf(w, "// %sTask creates a %s workflow task.\n", config.Kind, config.KIND)
    fmt.Fprintf(w, "func %sTask(%s) *WorkflowTask {\n", config.Kind, params)
    
    // Function body
    fmt.Fprintf(w, "\treturn &WorkflowTask{\n")
    fmt.Fprintf(w, "\t\tName: name,\n")
    fmt.Fprintf(w, "\t\tKind: WorkflowTaskKind%s,\n", config.Kind)
    fmt.Fprintf(w, "\t\tTaskConfig: &%s{\n", config.Name)
    
    // Assign parameters to struct fields
    for _, field := range config.Fields {
        paramName := g.paramName(field.Name)
        fmt.Fprintf(w, "\t\t\t%s: %s,\n", field.Name, paramName)
    }
    
    fmt.Fprintf(w, "\t\t},\n")
    fmt.Fprintf(w, "\t}\n")
    fmt.Fprintf(w, "}\n\n")
    
    return nil
}
```

### 3. Generate ToProto Method

```go
// GenToProtoMethod generates ToProto() method for proto conversion
func (g *GenContext) GenToProtoMethod(w io.Writer, config *TaskConfigSchema) error {
    g.addImport("google.golang.org/protobuf/types/known/structpb")
    
    fmt.Fprintf(w, "// ToProto converts %s to google.protobuf.Struct for proto marshaling.\n", config.Name)
    fmt.Fprintf(w, "func (c *%s) ToProto() (*structpb.Struct, error) {\n", config.Name)
    fmt.Fprintf(w, "\tdata := map[string]interface{}{\n")
    
    // Marshal each field
    for _, field := range config.Fields {
        if field.Required || !g.isZeroValue(field) {
            fmt.Fprintf(w, "\t\t\"%s\": c.%s,\n", field.JsonName, field.Name)
        } else {
            // Optional field - only include if not zero value
            fmt.Fprintf(w, "\t\tif !isEmpty(c.%s) {\n", field.Name)
            fmt.Fprintf(w, "\t\t\tdata[\"%s\"] = c.%s\n", field.JsonName, field.Name)
            fmt.Fprintf(w, "\t\t}\n")
        }
    }
    
    fmt.Fprintf(w, "\t}\n")
    fmt.Fprintf(w, "\treturn structpb.NewStruct(data)\n")
    fmt.Fprintf(w, "}\n\n")
    
    return nil
}
```

### 4. Generate FromProto Method

```go
// GenFromProtoMethod generates FromProto() method for proto conversion
func (g *GenContext) GenFromProtoMethod(w io.Writer, config *TaskConfigSchema) error {
    g.addImport("google.golang.org/protobuf/types/known/structpb")
    
    fmt.Fprintf(w, "// FromProto converts google.protobuf.Struct to %s.\n", config.Name)
    fmt.Fprintf(w, "func (c *%s) FromProto(s *structpb.Struct) error {\n", config.Name)
    fmt.Fprintf(w, "\tfields := s.GetFields()\n\n")
    
    // Unmarshal each field
    for _, field := range config.Fields {
        g.genFromProtoField(w, field)
    }
    
    fmt.Fprintf(w, "\treturn nil\n")
    fmt.Fprintf(w, "}\n\n")
    
    return nil
}
```

---

## Type Mapping

Convert JSON schema types to Go types:

```go
func (g *GenContext) goType(typeSpec TypeSpec) string {
    switch typeSpec.Kind {
    case "string":
        return "string"
    case "int32":
        return "int32"
    case "int64":
        return "int64"
    case "bool":
        return "bool"
    case "float":
        return "float32"
    case "double":
        return "float64"
    case "bytes":
        return "[]byte"
    
    case "map":
        keyType := g.goType(typeSpec.KeyType)
        valueType := g.goType(typeSpec.ValueType)
        return fmt.Sprintf("map[%s]%s", keyType, valueType)
    
    case "array":
        elementType := g.goType(typeSpec.ElementType)
        return fmt.Sprintf("[]%s", elementType)
    
    case "message":
        // Pointer for proto compatibility
        return "*" + typeSpec.MessageType
    
    case "struct":
        // google.protobuf.Struct → map[string]interface{}
        return "map[string]interface{}"
    
    default:
        panic(fmt.Sprintf("unknown type kind: %s", typeSpec.Kind))
    }
}
```

---

## File Organization

### Generated Package Structure

```
sdk/go/workflow/
├── workflow.go              (manual: core workflow types)
├── task_field_ref.go        (manual: field reference support)
├── gen/                     (generated: task configs and builders)
│   ├── tasks.go            (generated: all task config structs)
│   ├── builders.go         (generated: all builder functions)
│   ├── converters.go       (generated: ToProto/FromProto methods)
│   └── types.go            (generated: shared types like HttpEndpoint)
└── internal/                (manual: internal utilities)
    └── conversion.go        (manual: conversion helpers)
```

### Alternative: One File Per Task

```
sdk/go/workflow/
├── workflow.go              (manual)
├── task_field_ref.go        (manual)
├── gen/
│   ├── set_task.go         (generated: SetTaskConfig + builder + converters)
│   ├── http_call_task.go   (generated: HttpCallTaskConfig + builder + converters)
│   ├── switch_task.go      (generated: SwitchTaskConfig + builder + converters)
│   └── types.go            (generated: shared types)
└── internal/
    └── conversion.go        (manual)
```

**Decision**: Use **one file per task** for better modularity and clearer diffs.

---

## Code Formatting

Always format generated code with `go/format`:

```go
import "go/format"

func (g *GenContext) generateFile(filename string, genFunc func(io.Writer) error) error {
    var buf bytes.Buffer
    
    // Generate code
    if err := genFunc(&buf); err != nil {
        return err
    }
    
    // Format with gofmt
    formatted, err := format.Source(buf.Bytes())
    if err != nil {
        // Return error with context
        return fmt.Errorf("failed to format generated code for %s: %w\n%s", 
            filename, err, buf.String())
    }
    
    // Write to file
    return os.WriteFile(filepath.Join(g.outputDir, filename), formatted, 0644)
}
```

---

## Import Management

Track and generate imports automatically:

```go
func (g *GenContext) addImport(pkg string) {
    g.imports[pkg] = struct{}{}
}

func (g *GenContext) genImports(w io.Writer) {
    if len(g.imports) == 0 {
        return
    }
    
    // Sort imports for deterministic output
    imports := make([]string, 0, len(g.imports))
    for imp := range g.imports {
        imports = append(imports, imp)
    }
    sort.Strings(imports)
    
    // Write import block
    fmt.Fprintf(w, "import (\n")
    for _, imp := range imports {
        fmt.Fprintf(w, "\t\"%s\"\n", imp)
    }
    fmt.Fprintf(w, ")\n\n")
}
```

---

## Example Generated Code

### SetTask Example

```go
// Generated by stigmer-codegen. DO NOT EDIT.

package gen

import (
    "google.golang.org/protobuf/types/known/structpb"
)

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

// ToProto converts SetTaskConfig to google.protobuf.Struct for proto marshaling.
func (c *SetTaskConfig) ToProto() (*structpb.Struct, error) {
    data := map[string]interface{}{
        "variables": c.Variables,
    }
    return structpb.NewStruct(data)
}

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

## Generation Metadata

Include generation metadata in every file:

```go
func (g *GenContext) genFileHeader(w io.Writer, filename string) {
    fmt.Fprintf(w, "// Code generated by stigmer-codegen. DO NOT EDIT.\n")
    fmt.Fprintf(w, "// Source: %s\n", filename)
    fmt.Fprintf(w, "// Generator: stigmer-codegen v%s\n", g.version)
    fmt.Fprintf(w, "// Generated: %s\n\n", time.Now().Format(time.RFC3339))
    fmt.Fprintf(w, "package %s\n\n", g.packageName)
}
```

---

## Testing Strategy

### Unit Tests for Generator

```go
func TestGenConfigStruct(t *testing.T) {
    schema := &TaskConfigSchema{
        Name: "SetTaskConfig",
        Fields: []*FieldSchema{
            {
                Name: "Variables",
                JsonName: "variables",
                Type: TypeSpec{Kind: "map", KeyType: "string", ValueType: "string"},
                Required: true,
            },
        },
    }
    
    var buf bytes.Buffer
    ctx := NewGenContext(nil, "")
    
    err := ctx.GenConfigStruct(&buf, schema)
    assert.NoError(t, err)
    
    code := buf.String()
    assert.Contains(t, code, "type SetTaskConfig struct")
    assert.Contains(t, code, "Variables map[string]string")
}
```

### Integration Tests

```go
func TestGeneratedCodeCompiles(t *testing.T) {
    // Generate code
    ctx := NewGenContext(testSchema, tmpDir)
    err := ctx.Generate()
    assert.NoError(t, err)
    
    // Try to build it
    cmd := exec.Command("go", "build", tmpDir+"/...")
    output, err := cmd.CombinedOutput()
    assert.NoError(t, err, string(output))
}
```

---

## CLI Tool

```bash
# Generate code from schemas
stigmer-codegen generate \
  --schema-dir tools/codegen/schemas \
  --output-dir sdk/go/workflow/gen \
  --package workflow

# Regenerate all
stigmer-codegen regenerate-all
```

---

## Next Steps

1. ✅ Design code generation strategy (this document)
2. ⏭️ Implement proto2schema converter
3. ⏭️ Implement code generator engine
4. ⏭️ Generate code for all task types
5. ⏭️ Test generated code compiles
6. ⏭️ Integrate with workflow SDK

---

## References

- Pulumi Go Generator: `/Users/suresh/scm/github.com/pulumi/pulumi/pkg/codegen/go/gen.go`
- Schema Format: `./02-schema-format.md`
- Go `fmt` package: https://pkg.go.dev/fmt
- Go `go/format` package: https://pkg.go.dev/go/format

---

**Status**: ✅ Strategy defined, ready to implement
