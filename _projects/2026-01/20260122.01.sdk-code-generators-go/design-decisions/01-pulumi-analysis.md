# Pulumi Code Generation Analysis

**Phase**: Research & Design  
**Date**: 2026-01-22  
**Status**: ✅ COMPLETE

---

## Overview

This document captures key learnings from studying Pulumi's code generation architecture at:
- `/Users/suresh/scm/github.com/pulumi/pulumi/pkg/codegen/schema/`
- `/Users/suresh/scm/github.com/pulumi/pulumi/pkg/codegen/go/`

---

## Key Findings

### 1. Schema as Intermediate Representation

**Core Insight**: Pulumi uses a **language-agnostic schema** as an intermediate representation between providers and generated code.

```
Proto/OpenAPI/etc → Schema (JSON) → Code Generator → Go/Python/TS/etc
```

**Schema Package Location**: `pkg/codegen/schema/schema.go`

**Key Types**:

```go
// Package represents a complete provider package
type Package struct {
    Name         string
    Version      *semver.Version
    Description  string
    
    // Core resources
    Types        []Type           // Non-resource types (configs, inputs)
    Config       []*Property      // Provider configuration
    Resources    []*Resource      // Resource types
    Functions    []*Function      // Data sources/functions
    
    Language     map[string]any   // Language-specific metadata
}

// Resource represents a deployable resource
type Resource struct {
    Token        string           // Unique resource identifier
    Comment      string           // Documentation
    InputProperties  []*Property  // Resource inputs
    Properties       []*Property  // Resource outputs
    StateInputs      []*Property  // State for import
}

// Property represents a field in a struct
type Property struct {
    Name         string
    Comment      string
    Type         Type             // See Type system below
    DefaultValue *DefaultValue
    ConstValue   any
    Language     map[string]any   // Language-specific metadata
}
```

**Type System**:

Pulumi's schema has a rich type system:

```go
// Type interface - all types implement this
type Type interface {
    String() string
    isType()
}

// Primitive types
- BoolType
- IntType  
- NumberType
- StringType
- AnyType

// Complex types
- ArrayType       // []T
- MapType         // map[string]T
- UnionType       // T1 | T2 | T3
- ObjectType      // struct with properties
- ResourceType    // reference to a resource
- TokenType       // opaque named type
- InputType       // accepts prompt or output value
- OptionalType    // nullable value
```

### 2. Code Generation Approach

**Surprise**: Pulumi **does NOT use text/template**!

Instead, they generate code using **direct string building** with `fmt.Fprintf`:

```go
func (pkg *pkgContext) genType(w io.Writer, obj *schema.ObjectType) error {
    // Direct code generation using fmt.Fprintf
    fmt.Fprintf(w, "type %s struct {\n", obj.Token)
    for _, prop := range obj.Properties {
        fmt.Fprintf(w, "\t%s %s `json:\"%s\"`\n", 
            prop.Name, goType(prop.Type), jsonName(prop.Name))
    }
    fmt.Fprintf(w, "}\n\n")
    return nil
}
```

**Why this works**:
- Simpler than templates for code generation
- Full Go type safety and IDE support
- Easier to debug (stack traces point to generation code)
- No template parsing overhead

### 3. Package Context Pattern

Pulumi uses a **`pkgContext` struct** that holds all generation state:

```go
type pkgContext struct {
    pkg              schema.PackageReference
    mod              string
    typeDetails      map[schema.Type]*typeDetails
    enums            []*schema.EnumType
    types            []*schema.ObjectType
    resources        []*schema.Resource
    functions        []*schema.Function
    names            codegen.StringSet      // Track generated names
    renamed          map[string]string      // Name collision resolution
    modToPkg         map[string]string      // Module to package mapping
}
```

**Key methods**:

```go
// Generate different code artifacts
func (pkg *pkgContext) genType(w io.Writer, obj *schema.ObjectType) error
func (pkg *pkgContext) genResource(w io.Writer, r *schema.Resource) error
func (pkg *pkgContext) genInputInterface(w io.Writer, name string)
func (pkg *pkgContext) genOutputType(w io.Writer, name string)
```

### 4. Input/Output Type Generation

Pulumi generates **multiple variants** of each type:

**For a type `Foo`**:
1. **Plain type**: `Foo` - The base struct
2. **Input type**: `FooInput` - Interface accepting prompt or output values
3. **Output type**: `FooOutput` - Wrapper for async values
4. **Ptr variants**: `FooPtrInput`, `FooPtrOutput` - For optional values
5. **Array variants**: `FooArrayInput`, `FooArrayOutput` - For lists
6. **Map variants**: `FooMapInput`, `FooMapOutput` - For maps

**Example**:

```go
// Plain type
type Foo struct {
    Name string `json:"name"`
}

// Input interface (accepts any input source)
type FooInput interface {
    pulumi.Input
    ToFooOutput() FooOutput
    ToFooOutputWithContext(context.Context) FooOutput
}

// Output type (wraps async values)
type FooOutput struct { pulumi.OutputState }
func (FooOutput) ElementType() reflect.Type { return reflect.TypeOf((*Foo)(nil)).Elem() }
```

**Why?**
- Supports Pulumi's async/output system
- Type-safe composition of resources
- IDE autocomplete works perfectly

### 5. Code Formatting

Generated code is **always formatted** with `go/format`:

```go
import "go/format"

func generateCode(pkg *pkgContext) ([]byte, error) {
    var buf bytes.Buffer
    
    // Generate raw code
    pkg.genPackage(&buf)
    pkg.genImports(&buf)
    pkg.genTypes(&buf)
    
    // Format with gofmt
    formatted, err := format.Source(buf.Bytes())
    if err != nil {
        return nil, err
    }
    
    return formatted, nil
}
```

**Benefits**:
- Generated code matches human-written code style
- No need to manage indentation in generation logic
- Catches syntax errors immediately

### 6. Modular Generation

Code generation is **modular** - different files for different concerns:

```
pulumi-aws/
├── sdk/
│   └── go/
│       └── aws/
│           ├── provider.go          (generated: provider resource)
│           ├── pulumiTypes.go       (generated: common types)
│           ├── pulumiUtilities.go   (generated: helper functions)
│           ├── ec2/                 (generated: EC2 module)
│           │   ├── instance.go      (generated: Instance resource)
│           │   ├── securityGroup.go (generated: SecurityGroup resource)
│           │   └── pulumiTypes.go   (generated: module-specific types)
│           └── s3/                  (generated: S3 module)
│               └── bucket.go        (generated: Bucket resource)
```

**Pattern**:
- One package per module
- `pulumiTypes.go` for shared types
- `provider.go` for provider configuration
- One file per resource

---

## Applicable to Stigmer

### What We Should Adopt

1. **✅ Schema as Intermediate Representation**
   - Convert proto → JSON schema → Go code
   - Schema contains all metadata needed for generation
   - Enables future support for other languages (Python, TypeScript)

2. **✅ Direct Code Generation (fmt.Fprintf)**
   - Simpler than text/template
   - Better debugging
   - Full type safety

3. **✅ Package Context Pattern**
   - Single struct holds all generation state
   - Methods for different artifacts
   - Easy to test and extend

4. **✅ Code Formatting with go/format**
   - Always format generated code
   - Catches syntax errors early
   - Matches human-written code style

5. **✅ Modular File Generation**
   - One file per task type (e.g., `set_task.go`, `http_call_task.go`)
   - Shared types in `types.go`
   - Clean separation of concerns

### What We DON'T Need

1. **❌ Input/Output Variants**
   - Pulumi needs this for async/output system
   - Stigmer SDK is synchronous (builds proto at call time)
   - We only need: Config struct + Builder function + Proto conversion

2. **❌ Language-Specific Metadata**
   - Pulumi supports 5+ languages
   - Stigmer (currently) only needs Go
   - We can add later if needed

3. **❌ Provider Resources**
   - Pulumi has provider configuration
   - Stigmer workflow tasks don't have this concept

### Stigmer-Specific Needs

1. **Proto Struct Conversion**
   - Every task config needs `ToProto()` and `FromProto()` methods
   - Must handle `google.protobuf.Struct` marshaling
   - Pulumi doesn't need this

2. **Expression Support**
   - Stigmer uses `${}` expressions in strings
   - Need to preserve these during conversion
   - Not a Pulumi concern

3. **Task Field References**
   - Stigmer's `${.taskName.fieldPath}` syntax
   - SDK needs `TaskFieldRef` type for referencing other tasks
   - Unique to Stigmer's workflow model

4. **Validation Integration**
   - Proto has buf.validate rules
   - Should generate Go validation logic
   - Pulumi relies on provider validation

---

## Code Generation Pattern (Proposed)

Based on Pulumi's approach, adapted for Stigmer:

```go
// Stigmer code generator context
type genContext struct {
    schema       *TaskSchema          // Parsed schema
    taskConfigs  []*TaskConfig        // Task configs to generate
    sharedTypes  []*TypeSchema        // Shared types (HttpEndpoint, etc.)
    imports      map[string]struct{}  // Track needed imports
}

// Generate code for a task type
func (g *genContext) genTaskConfig(w io.Writer, config *TaskConfig) error {
    // 1. Generate config struct
    g.genConfigStruct(w, config)
    
    // 2. Generate builder function
    g.genBuilderFunc(w, config)
    
    // 3. Generate ToProto() method
    g.genToProtoMethod(w, config)
    
    // 4. Generate FromProto() method
    g.genFromProtoMethod(w, config)
    
    return nil
}

// Example: Generate config struct
func (g *genContext) genConfigStruct(w io.Writer, config *TaskConfig) {
    fmt.Fprintf(w, "// %s\n", config.Comment)
    fmt.Fprintf(w, "type %s struct {\n", config.Name)
    
    for _, field := range config.Fields {
        fmt.Fprintf(w, "\t%s %s", field.Name, g.goType(field.Type))
        if field.JsonTag != "" {
            fmt.Fprintf(w, " `json:\"%s\"`", field.JsonTag)
        }
        fmt.Fprintf(w, "\n")
    }
    
    fmt.Fprintf(w, "}\n\n")
}
```

---

## Next Steps

1. ✅ Document Pulumi analysis (this file)
2. ⏭️ Design Stigmer schema format (next file)
3. ⏭️ Design code generation strategy (after schema)
4. ⏭️ Implement proto → schema converter
5. ⏭️ Implement code generator

---

## References

- Pulumi Schema: `/Users/suresh/scm/github.com/pulumi/pulumi/pkg/codegen/schema/schema.go`
- Pulumi Go Generator: `/Users/suresh/scm/github.com/pulumi/pulumi/pkg/codegen/go/gen.go`
- Stigmer Workflow Spec: `apis/ai/stigmer/agentic/workflow/v1/spec.proto`
- Stigmer Task Configs: `apis/ai/stigmer/agentic/workflow/v1/tasks/*.proto`

---

**Status**: ✅ Research complete, ready to design schema format
