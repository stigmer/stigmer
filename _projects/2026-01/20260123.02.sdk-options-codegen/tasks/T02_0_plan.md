# Task T02: Core Options Generation

**Created**: 2026-01-23
**Status**: COMPLETED ✅
**Type**: Implementation
**Completed**: 2026-01-23

## Objective

Implement core options generation capability in the code generator:
- Generate option type declarations
- Generate builder functions  
- Generate simple field setter functions

Validate with HTTP_CALL task type as proof of concept.

## Background

From T01 analysis, we identified that 95% of SDK options code follows predictable patterns that can be generated from JSON schemas. This task implements the foundation: option types, builders, and simple field setters.

**Success Criteria from T01**:
- Generated code compiles without errors
- Generated options match existing manual options functionally
- Generated code is readable and well-documented

## Task Breakdown

### Phase 1: Generator Enhancement

1. **Add Option Generation Method**
   - [ ] Create `genOptionType()` method
     - Generates: `type HttpCallOption func(*HttpCallTaskConfig)`
     - Add proper documentation comment
   
2. **Add Builder Function Generation**
   - [ ] Create `genBuilderFunction()` method
     - Generates: `func HttpCall(name string, opts ...HttpCallOption) *Task`
     - Initialize maps in config (e.g., `Headers: make(map[string]string)`)
     - Apply all options in loop
     - Return `*Task` with name, kind, config
   
3. **Add Simple Field Setter Generation**
   - [ ] Create `genFieldSetterFunction()` method
     - String fields: Use `coerceToString(interface{})` for expression support
     - Int32/Int64 fields: Direct assignment with type
     - Bool fields: Direct assignment
     - Add documentation with examples

4. **Integrate into Generator.Generate()**
   - [ ] Call option generation methods in correct order
   - [ ] Add options generation after proto methods
   - [ ] Ensure imports are tracked (e.g., `coerceToString` might need import)

### Phase 2: Helper Utilities

1. **Add coerceToString() to Generated Helpers**
   - [ ] Check if `coerceToString()` exists in SDK
   - [ ] If not, generate it in `helpers.go`:
     ```go
     // coerceToString converts various types to string for expression support.
     func coerceToString(v interface{}) string {
         if s, ok := v.(string); ok {
             return s
         }
         return fmt.Sprintf("%v", v)
     }
     ```

2. **Add TaskKind Enum Detection**
   - [ ] Derive TaskKind constant from schema.Kind field
   - [ ] Example: "HTTP_CALL" → "TaskKindHttpCall"
   - [ ] Handle conversion: SNAKE_CASE → TitleCase

### Phase 3: Validation & Testing

1. **Generate HTTP_CALL Options**
   - [ ] Run codegen on `tools/codegen/schemas/tasks/http_call.json`
   - [ ] Review generated `http_call_task_config.go`
   - [ ] Compare with manual `sdk/go/workflow/httpcall_options.go`

2. **Compilation Test**
   - [ ] Verify generated code compiles
   - [ ] Fix any import issues
   - [ ] Fix any type mismatches

3. **Functional Test**
   - [ ] Create simple test using generated options:
     ```go
     task := gen.HttpCall("test",
         gen.URI("https://example.com"),
         gen.HTTPMethod("GET"),
     )
     assert.NotNil(t, task)
     assert.Equal(t, "test", task.Name)
     ```

4. **Side-by-Side Comparison**
   - [ ] Compare generated functions with manual functions
   - [ ] Ensure function signatures match
   - [ ] Ensure documentation quality matches
   - [ ] Adjust templates as needed

### Phase 4: Documentation

1. **Generator Code Documentation**
   - [ ] Add comprehensive comments to new methods
   - [ ] Document the option generation pattern
   - [ ] Add examples in method comments

2. **Generated Code Documentation**
   - [ ] Ensure each generated function has proper godoc
   - [ ] Include usage examples in comments
   - [ ] Reference schema field descriptions

## Technical Details

### Code Structure

```go
// In genContext - new methods

// genOptionType generates the option function type
func (c *genContext) genOptionType(w *bytes.Buffer, config *TaskConfigSchema) error {
    optionTypeName := c.getOptionTypeName(config)
    fmt.Fprintf(w, "// %s is a functional option for configuring a %s task.\n", 
        optionTypeName, config.Kind)
    fmt.Fprintf(w, "type %s func(*%s)\n\n", optionTypeName, config.Name)
    return nil
}

// genBuilderFunction generates the main builder function
func (c *genContext) genBuilderFunction(w *bytes.Buffer, config *TaskConfigSchema) error {
    // Generate function signature
    // Initialize config with empty maps
    // Apply options loop
    // Return Task
    return nil
}

// genFieldSetters generates option functions for all fields
func (c *genContext) genFieldSetters(w *bytes.Buffer, config *TaskConfigSchema) error {
    for _, field := range config.Fields {
        if err := c.genFieldSetter(w, field, config); err != nil {
            return err
        }
    }
    return nil
}

// genFieldSetter generates a single field setter function
func (c *genContext) genFieldSetter(w *bytes.Buffer, field *FieldSchema, config *TaskConfigSchema) error {
    switch field.Type.Kind {
    case "string":
        return c.genStringFieldSetter(w, field, config)
    case "int32", "int64":
        return c.genIntFieldSetter(w, field, config)
    case "bool":
        return c.genBoolFieldSetter(w, field, config)
    // Skip maps/arrays for now - that's T03
    default:
        return nil
    }
}
```

### Expected Output Example

For HTTP_CALL schema, should generate:

```go
// HttpCallOption is a functional option for configuring an HTTP_CALL task.
type HttpCallOption func(*HttpCallTaskConfig)

// HttpCall creates an HTTP_CALL task with functional options.
//
// Example:
//
//  task := HttpCall("fetch",
//      URI("https://api.example.com/data"),
//      HTTPMethod("GET"),
//  )
func HttpCall(name string, opts ...HttpCallOption) *Task {
    config := &HttpCallTaskConfig{
        Headers: make(map[string]string),
        Body:    make(map[string]interface{}),
    }
    
    for _, opt := range opts {
        opt(config)
    }
    
    return &Task{
        Name:   name,
        Kind:   TaskKindHttpCall,
        Config: config,
    }
}

// URI sets the HTTP endpoint URI.
//
// Accepts:
//   - String literal: "https://api.example.com"
//   - Expression: "${.baseUrl}/path"
//
// Example:
//
//  URI("https://api.example.com/users")
func URI(uri interface{}) HttpCallOption {
    return func(c *HttpCallTaskConfig) {
        c.URI = coerceToString(uri)
    }
}

// HTTPMethod sets the HTTP method for the request.
//
// Example:
//
//  HTTPMethod("GET")
//  HTTPMethod("POST")
func HTTPMethod(method string) HttpCallOption {
    return func(c *HttpCallTaskConfig) {
        c.Method = method
    }
}

// Timeout sets the request timeout in seconds.
//
// Example:
//
//  Timeout(30)  // 30 seconds
func Timeout(seconds int32) HttpCallOption {
    return func(c *HttpCallTaskConfig) {
        c.TimeoutSeconds = seconds
    }
}
```

## Success Criteria for T02

- [x] Code compiles without errors
- [x] Generated option type matches manual pattern
- [x] Generated builder function matches manual pattern
- [x] Generated field setters match manual pattern
- [x] Generated code has proper documentation
- [x] Test using generated options passes
- [x] Side-by-side comparison validates correctness

## Next Task Preview

**T03: Complex Field Types** - Add generation for map fields, array fields, and nested message fields.

## Notes

- Focus on correctness over completeness - we can iterate
- Maps and arrays are deferred to T03 (more complex)
- Nested messages (like Agent references) also deferred to T03
- The goal is to get the foundation right with simple fields first

## Review Process

**What happens next**:
1. **You review this plan** - Ensure approach makes sense
2. **Provide feedback** - Any concerns or suggestions
3. **I'll revise if needed** - Incorporate your feedback
4. **You approve** - Give explicit approval to proceed
5. **Execution begins** - Implementation tracked in T02_1_execution.md

**Please consider**:
- Does the phased approach make sense?
- Should we test with a different task type first?
- Any concerns about the generated code structure?
- Should we handle any additional field types in this phase?
