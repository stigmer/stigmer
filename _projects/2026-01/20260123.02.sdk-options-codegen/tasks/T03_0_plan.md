# Task T03: Complex Field Types - Plan

**Status**: PLANNING 🟡  
**Created**: 2026-01-23  
**Type**: Implementation  
**Depends On**: T02 (Core Options Generation) ✅

---

## Objective

Extend the code generator to handle complex field types (maps and arrays), generating both singular and bulk option functions that match manual patterns. Enable full coverage of HTTP_CALL, AGENT_CALL, and other tasks with complex fields.

---

## Context

### What T02 Achieved ✅

T02 successfully generated options for simple field types:
- ✅ String fields with expression support (via `coerceToString()`)
- ✅ Int32/Int64 fields
- ✅ Boolean fields
- ✅ Struct fields (google.protobuf.Struct)
- ✅ Option type declarations
- ✅ Builder functions with map initialization

### What T02 Skipped (This Task) ⏭️

Lines 787-790 in `tools/codegen/generator/main.go`:
```go
// Skip maps and arrays for now - that's T03
if field.Type.Kind == "map" || field.Type.Kind == "array" {
    continue
}
```

**Current Coverage**: ~40% of fields (simple types only)  
**Target Coverage**: 95%+ of fields (including maps, arrays, nested types)

---

## Requirements

### 1. Map Field Options

Generate **two functions** for each map field:

#### Pattern: Singular Option (Add One Entry)

```go
// Header adds an HTTP header to the request.
//
// Example:
//
//  workflow.Header("Content-Type", "application/json")
//  workflow.Header("Authorization", "Bearer ${.token}")
//  workflow.Header("X-Custom", authTask.Field("token"))
func Header(key, value interface{}) HttpCallOption {
    return func(c *HttpCallTaskConfig) {
        c.Headers[coerceToString(key)] = coerceToString(value)
    }
}
```

**Key Characteristics**:
- Accepts `key, value interface{}` (both support expressions)
- Uses `coerceToString()` for both key and value
- Adds single entry to map
- Singular name: `Header`, `Environment`, `Label`

#### Pattern: Bulk Option (Add Multiple Entries)

```go
// Headers adds multiple HTTP headers from a map.
//
// Example:
//
//  workflow.Headers(map[string]interface{}{
//      "Content-Type": "application/json",
//      "Authorization": "Bearer ${.token}",
//  })
func Headers(headers map[string]interface{}) HttpCallOption {
    return func(c *HttpCallTaskConfig) {
        for key, value := range headers {
            c.Headers[coerceToString(key)] = coerceToString(value)
        }
    }
}
```

**Key Characteristics**:
- Accepts `map[string]interface{}` (flexible input)
- Iterates and uses `coerceToString()` for each entry
- Merges into existing map (doesn't replace)
- Plural name: `Headers`, `Environments`, `Labels`

### 2. Array Field Options

Generate **two functions** for each array field:

#### Pattern: Singular Option (Add One Item)

```go
// Skill adds a single skill to the agent.
//
// Example:
//
//  agent.Skill(&SkillReference{
//      Name: "email-skill",
//      Version: "1.0.0",
//  })
func Skill(skill *SkillReference) AgentOption {
    return func(c *AgentConfig) {
        c.Skills = append(c.Skills, skill)
    }
}
```

**Key Characteristics**:
- Accepts typed element (e.g., `*SkillReference`)
- Uses `append()` to add to slice
- Singular name: `Skill`, `Environment`, `Volume`

#### Pattern: Bulk Option (Add Multiple Items)

```go
// Skills adds multiple skills to the agent.
//
// Example:
//
//  agent.Skills([]*SkillReference{
//      {Name: "email-skill", Version: "1.0.0"},
//      {Name: "search-skill", Version: "2.0.0"},
//  })
func Skills(skills []*SkillReference) AgentOption {
    return func(c *AgentConfig) {
        c.Skills = append(c.Skills, skills...)
    }
}
```

**Key Characteristics**:
- Accepts slice of typed elements
- Uses `append(slice, items...)` with spread
- Merges into existing slice (doesn't replace)
- Plural name: `Skills`, `Environments`, `Volumes`

### 3. Naming Convention

Convert field names to singular/plural forms:

| Field Name | Singular Option | Bulk Option |
|------------|----------------|-------------|
| `Headers` | `Header` | `Headers` |
| `Skills` | `Skill` | `Skills` |
| `Environments` | `Environment` | `Environments` |
| `Volumes` | `Volume` | `Volumes` |
| `Labels` | `Label` | `Labels` |

**Implementation**: Use Go inflection library or simple rules:
- Remove trailing 's' for singular
- Handle irregular plurals (person/people, etc.) if needed

### 4. Type Handling

Map types need different handling based on value type:

**String Values** (`map[string]string`):
```go
c.Headers[coerceToString(key)] = coerceToString(value)
```

**Struct Values** (`map[string]*SomeType`):
```go
c.Resources[key] = value  // Direct assignment, no coercion
```

**Any Values** (`map[string]interface{}`):
```go
c.Metadata[coerceToString(key)] = value  // Coerce key, keep value as-is
```

---

## Implementation Plan

### Phase 1: Naming Utilities

**File**: `tools/codegen/generator/main.go`

Add helper methods:

1. **`singularize(name string) string`**
   - Converts plural field names to singular
   - Examples: "Headers" → "Header", "Skills" → "Skill"
   - Use simple rules: remove trailing 's', handle common irregulars

2. **`pluralize(name string) string`**
   - Ensures consistent plural forms
   - Examples: "Header" → "Headers", "Skill" → "Skills"

3. **`needsCoercion(fieldType *TypeSchema) bool`**
   - Determines if a type needs `coerceToString()`
   - Returns `true` for: string, map[string]string
   - Returns `false` for: structs, typed pointers

### Phase 2: Map Field Generation

**File**: `tools/codegen/generator/main.go`

Add method: `genMapFieldSetters(w *bytes.Buffer, field *FieldSchema, config *TaskConfigSchema, optionTypeName string) error`

**Logic**:
```go
func (c *genContext) genMapFieldSetters(w *bytes.Buffer, field *FieldSchema, config *TaskConfigSchema, optionTypeName string) error {
    singularName := singularize(field.Name)
    pluralName := field.Name
    
    // Generate singular option (add one entry)
    c.genSingularMapSetter(w, singularName, field, config, optionTypeName)
    
    // Generate plural option (add multiple entries)
    c.genPluralMapSetter(w, pluralName, field, config, optionTypeName)
    
    return nil
}
```

**Sub-methods**:
1. `genSingularMapSetter()` - Generates `Header(key, value)` pattern
2. `genPluralMapSetter()` - Generates `Headers(map)` pattern

### Phase 3: Array Field Generation

**File**: `tools/codegen/generator/main.go`

Add method: `genArrayFieldSetters(w *bytes.Buffer, field *FieldSchema, config *TaskConfigSchema, optionTypeName string) error`

**Logic**:
```go
func (c *genContext) genArrayFieldSetters(w *bytes.Buffer, field *FieldSchema, config *TaskConfigSchema, optionTypeName string) error {
    singularName := singularize(field.Name)
    pluralName := field.Name
    
    // Generate singular option (add one item)
    c.genSingularArraySetter(w, singularName, field, config, optionTypeName)
    
    // Generate plural option (add multiple items)
    c.genPluralArraySetter(w, pluralName, field, config, optionTypeName)
    
    return nil
}
```

**Sub-methods**:
1. `genSingularArraySetter()` - Generates `Skill(item)` pattern
2. `genPluralArraySetter()` - Generates `Skills(items)` pattern

### Phase 4: Integration

**File**: `tools/codegen/generator/main.go`

Modify `genFieldSetters()` method:

```go
func (c *genContext) genFieldSetters(w *bytes.Buffer, config *TaskConfigSchema) error {
    for _, field := range config.Fields {
        switch field.Type.Kind {
        case "map":
            // NEW: Generate singular + plural map options
            if err := c.genMapFieldSetters(w, field, config, c.getOptionTypeName(config)); err != nil {
                return err
            }
        case "array":
            // NEW: Generate singular + plural array options
            if err := c.genArrayFieldSetters(w, field, config, c.getOptionTypeName(config)); err != nil {
                return err
            }
        default:
            // Existing simple field handling
            if err := c.genFieldSetter(w, field, config); err != nil {
                return err
            }
        }
    }
    return nil
}
```

### Phase 5: Validation & Testing

**Generated Code Location**: `sdk/go/workflow/.codegen-test/`

**Test Cases**:

1. **HTTP_CALL Task** (map[string]string):
   ```go
   task := HttpCall("fetch",
       Header("Content-Type", "application/json"),
       Header("Authorization", "Bearer ${.token}"),
       Headers(map[string]interface{}{
           "X-Custom": "value",
           "X-Request-ID": "${.requestId}",
       }),
   )
   ```

2. **AGENT_CALL Task** (array of structs):
   ```go
   task := AgentCall("process",
       Skill(&SkillReference{Name: "email"}),
       Skills([]*SkillReference{
           {Name: "search"},
           {Name: "analyze"},
       }),
   )
   ```

**Validation Criteria**:
- Generated code compiles without errors
- Singular options add single entry/item
- Plural options add multiple entries/items
- Expression support works via `coerceToString()`
- Function names match manual patterns

---

## Success Criteria

- [x] **Naming utilities implemented** - singularize(), pluralize()
- [x] **Map field options generate correctly** - Both singular and plural
- [x] **Array field options generate correctly** - Both singular and plural
- [x] **Generated code compiles** - No syntax errors
- [x] **Pattern matching** - 95%+ match with manual options
- [x] **Expression support** - coerceToString() used appropriately
- [x] **HTTP_CALL validation** - Headers work correctly
- [x] **AGENT_CALL validation** - Skills work correctly (if schema available)

---

## Risks & Mitigations

### Risk 1: Irregular Plurals
**Problem**: Not all English words pluralize by adding 's' (person→people, child→children)  
**Mitigation**: Start with simple rules, add special cases only if encountered in actual schemas

### Risk 2: Type Coercion Edge Cases
**Problem**: Some map value types shouldn't be coerced  
**Mitigation**: Use `needsCoercion()` to determine when to apply `coerceToString()`

### Risk 3: Import Management
**Problem**: Complex types may require additional imports  
**Mitigation**: Extend existing `addImport()` mechanism in genContext

---

## Out of Scope (Deferred)

These items are **NOT** part of T03:

- ❌ Nested message type definitions (generate embedded structs)
- ❌ Validation rule generation (min/max/required/enum)
- ❌ Agent/Skill top-level resource options (deferred to T04)
- ❌ Ergonomic aliases (HTTPGet, WithTimeout, etc.) - manual layer
- ❌ Migration of existing manual options - wholesale replacement in T05

---

## Expected Outcomes

**Before T03**:
- Generator handles 4 simple field types (string, int, bool, struct)
- ~40% field coverage across all tasks
- Map/array fields skipped with TODO comments

**After T03**:
- Generator handles 6 field types (+ map, + array)
- 95%+ field coverage across all tasks
- Full support for HTTP_CALL headers pattern
- Foundation for Agent/Skill resources in T04

---

## Next Steps After T03

**T04: Agent/Skill Resources**
- Apply codegen to top-level resources (Agent, Skill)
- Handle nested SubAgent, MCP Server definitions
- Generate complex nested options

**T05: Migration & Testing**
- Replace manual options with generated versions
- Run full test suite
- Performance benchmarking

---

## Documentation

- **Execution Log**: `T03_1_execution.md` (to be created during implementation)
- **Code Changes**: Track in execution log
- **Validation Results**: Side-by-side comparison with manual code

---

*This plan provides the roadmap for implementing map and array field support, achieving near-complete automation of SDK options generation.*
