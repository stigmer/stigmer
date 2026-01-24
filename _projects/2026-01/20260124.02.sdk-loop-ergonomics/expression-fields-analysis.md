# Expression Field Analysis Report

**Generated**: 2026-01-24  
**Purpose**: Analyze all fields accepting JQ expressions across SDK task types to inform smart type conversion decisions

---

## Executive Summary

**Total Expression Fields**: ~20 fields across 13 task types  
**Field Type Distribution**:
- String fields: 6 fields (30%)
- Map[string]string: 3 fields (15%)
- Map[string]interface{}: 6 fields (30%)
- Array fields: 5 fields (25%)

**Complexity Assessment**: **MEDIUM** (feasible with clear patterns)

**Recommendation**: ✅ **PROCEED** with smart type conversion - scope is manageable

---

## Detailed Analysis by Task Type

### 1. HTTP_CALL Tasks (`HttpCallTaskConfig`)

**Expression Fields**: 3 fields

```go
type HttpCallTaskConfig struct {
    URI     string                 `json:"uri,omitempty"`           // ← Expression
    Headers map[string]string      `json:"headers,omitempty"`       // ← Expression values
    Body    map[string]interface{} `json:"body,omitempty"`          // ← Expression values
}
```

**Current Usage**:
```go
// Problem: Manual .Expression() calls required
Endpoint: &types.HttpEndpoint{
    Uri: fetchTask.Field("url").Expression(),  // ❌ Verbose
},
Body: map[string]interface{}{
    "userId": userTask.Field("id").Expression(),  // ❌ Verbose
},
```

**Desired Usage**:
```go
// Solution: Automatic conversion
URI: fetchTask.Field("url"),  // ✅ Clean
Body: map[string]interface{}{
    "userId": userTask.Field("id"),  // ✅ Clean
},
```

---

### 2. GRPC_CALL Tasks (`GrpcCallTaskConfig`)

**Expression Fields**: 1 field

```go
type GrpcCallTaskConfig struct {
    Body map[string]interface{} `json:"body,omitempty"`  // ← Expression values
}
```

**Pattern**: Same as HTTP body - accepts complex expressions in map values

---

### 3. FOR Tasks (`ForTaskConfig`)

**Expression Fields**: 2 fields

```go
type ForTaskConfig struct {
    In string                   `json:"in,omitempty"`  // ← Expression (collection)
    Do []map[string]interface{} `json:"do,omitempty"`  // ← Task array (indirect)
}
```

**Current Problem**:
```go
In: fetchTask.Field("items").Expression(),  // ❌ Manual conversion
```

**Desired**:
```go
In: fetchTask.Field("items"),  // ✅ Automatic
```

**Note**: `Do` field contains nested tasks, not direct expressions

---

### 4. SWITCH Tasks (`SwitchTaskConfig`)

**Expression Fields**: 1 field (array with nested expressions)

```go
type SwitchTaskConfig struct {
    Cases []map[string]interface{} `json:"cases,omitempty"`  // ← Contains when/then expressions
}
```

**Pattern**: Cases array contains maps with `when` (condition expression) and `then` (task reference) fields

---

### 5. SET Tasks (`SetTaskConfig`)

**Expression Fields**: 1 field

```go
type SetTaskConfig struct {
    Variables map[string]string `json:"variables,omitempty"`  // ← Expression values
}
```

**Current Usage**:
```go
Variables: map[string]string{
    "userId": userTask.Field("id").Expression(),      // ❌ Manual
    "name":   userTask.Field("name").Expression(),    // ❌ Manual
},
```

**Desired**:
```go
Variables: map[string]string{
    "userId": userTask.Field("id"),   // ✅ Automatic
    "name":   userTask.Field("name"), // ✅ Automatic
},
```

---

### 6. RUN Tasks (`RunTaskConfig`)

**Expression Fields**: 1 field

```go
type RunTaskConfig struct {
    Input map[string]interface{} `json:"input,omitempty"`  // ← Expression values
}
```

**Pattern**: Same as HTTP/GRPC body - complex expressions in map values

---

### 7. AGENT_CALL Tasks (`AgentCallTaskConfig`)

**Expression Fields**: 3 fields

```go
type AgentCallTaskConfig struct {
    Message string                 `json:"message,omitempty"`  // ← Expression
    Env     map[string]string      `json:"env,omitempty"`      // ← Expression values
    Config  map[string]interface{} `json:"config,omitempty"`   // ← Expression values
}
```

**Current Problem**:
```go
Message: "Review PR: " + prTask.Field("url").Expression(),  // ❌ Manual
Env: map[string]string{
    "GITHUB_TOKEN": tokenTask.Field("token").Expression(),  // ❌ Manual
},
```

**Desired**:
```go
Message: prTask.Field("url"),  // ✅ Automatic
Env: map[string]string{
    "GITHUB_TOKEN": tokenTask.Field("token"),  // ✅ Automatic
},
```

---

### 8. RAISE Tasks (`RaiseTaskConfig`)

**Expression Fields**: 3 fields

```go
type RaiseTaskConfig struct {
    Error   string                 `json:"error,omitempty"`    // ← Expression (error type)
    Message string                 `json:"message,omitempty"`  // ← Expression (error message)
    Data    map[string]interface{} `json:"data,omitempty"`     // ← Expression values
}
```

**Pattern**: All three fields can accept expressions or literal values

---

### 9. LISTEN Tasks (`ListenTaskConfig`)

**Expression Fields**: 1 field

```go
type ListenTaskConfig struct {
    Event string `json:"event,omitempty"`  // ← Expression (event name)
}
```

**Pattern**: Simple string field accepting expression or literal

---

### 10. CALL_ACTIVITY Tasks (`CallActivityTaskConfig`)

**Expression Fields**: 1 field

```go
type CallActivityTaskConfig struct {
    Input map[string]interface{} `json:"input,omitempty"`  // ← Expression values
}
```

**Pattern**: Same as RUN task input

---

### 11-13. Non-Expression Tasks

**FORK Tasks** (`ForkTaskConfig`):
- `Branches` field contains nested task definitions, not expressions

**TRY Tasks** (`TryTaskConfig`):
- `Tasks` and `Catch` fields contain nested task definitions

**WAIT Tasks** (`WaitTaskConfig`):
- `Seconds` field is `int32` - NO expressions needed

---

## Field Type Distribution

### Category A: Simple String Expression Fields (6 fields)

Fields that accept a single string expression:

1. `HttpCallTaskConfig.URI`
2. `ForTaskConfig.In`
3. `AgentCallTaskConfig.Message`
4. `RaiseTaskConfig.Error`
5. `RaiseTaskConfig.Message`
6. `ListenTaskConfig.Event`

**Type Change Required**:
```go
// Before
URI string `json:"uri,omitempty"`

// After
URI interface{} `json:"uri,omitempty"`  // Accept string OR TaskFieldRef
```

---

### Category B: Map with String Values (3 fields)

Map fields where values can be expressions:

1. `HttpCallTaskConfig.Headers`
2. `SetTaskConfig.Variables`
3. `AgentCallTaskConfig.Env`

**Type Change**: ❌ **NOT NEEDED**
- Already `map[string]string`
- Values are already strings, can accept expression strings directly
- Smart conversion happens when assigning TaskFieldRef to map value

**Example**:
```go
// This ALREADY works if we handle map value assignment:
Headers: map[string]string{
    "Auth": tokenTask.Field("token"),  // TaskFieldRef → string conversion
}
```

---

### Category C: Map with Interface{} Values (6 fields)

Map fields where values can be any type:

1. `HttpCallTaskConfig.Body`
2. `GrpcCallTaskConfig.Body`
3. `RunTaskConfig.Input`
4. `AgentCallTaskConfig.Config`
5. `RaiseTaskConfig.Data`
6. `CallActivityTaskConfig.Input`

**Type Change**: ❌ **NOT NEEDED**
- Already `map[string]interface{}`
- Values already accept any type including TaskFieldRef
- Smart conversion happens at ToProto() time

---

### Category D: Array Fields (5 fields)

Array fields containing nested structures:

1. `SwitchTaskConfig.Cases` - Contains when/then expressions
2. `ForkTaskConfig.Branches` - Contains nested tasks
3. `ForTaskConfig.Do` - Contains nested tasks
4. `TryTaskConfig.Tasks` - Contains nested tasks
5. `TryTaskConfig.Catch` - Contains catch blocks

**Type Change**: ⚠️ **COMPLEX**
- Nested structures with their own expression fields
- Requires deeper analysis of nested field patterns
- May not need top-level changes if nested items handle it

---

## Smart Type Conversion Strategy

### What Needs to Change

**Only 6 simple string fields need type changes:**

| Task Type | Field | Current Type | New Type |
|-----------|-------|--------------|----------|
| HttpCallTaskConfig | URI | `string` | `interface{}` |
| ForTaskConfig | In | `string` | `interface{}` |
| AgentCallTaskConfig | Message | `string` | `interface{}` |
| RaiseTaskConfig | Error | `string` | `interface{}` |
| RaiseTaskConfig | Message | `string` | `interface{}` |
| ListenTaskConfig | Event | `string` | `interface{}` |

**Map and array fields**: Already flexible, no type changes needed

---

## Implementation Pattern

### Pattern 1: Simple String Field Conversion

```go
// In generated code
type HttpCallTaskConfig struct {
    URI interface{} `json:"uri,omitempty"`  // Was: string
}

func (c *HttpCallTaskConfig) ToProto() (*structpb.Struct, error) {
    data := make(map[string]interface{})
    
    // Smart conversion
    if c.URI != nil {
        switch v := c.URI.(type) {
        case string:
            data["uri"] = v
        case TaskFieldRef:
            data["uri"] = v.Expression()
        case interface{ Expression() string }:
            data["uri"] = v.Expression()
        default:
            return nil, fmt.Errorf("URI must be string or expression reference, got %T", v)
        }
    }
    
    return structpb.NewStruct(data)
}
```

### Pattern 2: Map Value Conversion (Already Supported)

```go
// Maps already work because Go allows TaskFieldRef as map value
Headers: map[string]string{
    "Auth": tokenTask.Field("token"),  // Works if TaskFieldRef implements String()
}
```

**Enhancement Needed**: Add `String()` method to TaskFieldRef
```go
func (t TaskFieldRef) String() string {
    return t.Expression()
}
```

---

## Proto Annotations: Exploration

### Question: Can we use proto annotations?

**Finding**: No proto files found in `apis/` directory for workflow tasks

**Conclusion**: 
- Code generation appears to be custom (not from proto)
- Proto annotation approach **NOT APPLICABLE** for this codebase
- Must use **code generation pattern matching**

---

## Code Generation Approach

### Recommended Pattern: Field Name Matching

**Generator should detect these field names as expression fields:**

```go
var expressionFieldPatterns = []string{
    // URI/URL patterns
    "uri", "url", "endpoint",
    
    // Input/output patterns
    "in", "input", "output", "body", "request",
    
    // Message/text patterns
    "message", "text", "content",
    
    // Conditional patterns
    "when", "condition",
    
    // Error patterns
    "error",
    
    // Event patterns
    "event",
}
```

**Generator Logic**:
```go
func shouldBeExpressionField(fieldName string, fieldType string) bool {
    if fieldType != "string" {
        return false  // Only convert string fields
    }
    
    fieldNameLower := strings.ToLower(fieldName)
    for _, pattern := range expressionFieldPatterns {
        if fieldNameLower == pattern || strings.Contains(fieldNameLower, pattern) {
            return true
        }
    }
    return false
}
```

---

## Complexity Assessment

### Files Requiring Updates

**Generated Files** (6 files):
1. `sdk/go/workflow/gen/httpcalltaskconfig.go` - URI field
2. `sdk/go/workflow/gen/fortaskconfig.go` - In field
3. `sdk/go/workflow/gen/agentcalltaskconfig.go` - Message field
4. `sdk/go/workflow/gen/raisetaskconfig.go` - Error, Message fields
5. `sdk/go/workflow/gen/listentaskconfig.go` - Event field

**Code Generator** (1 file):
- Update generator to detect expression fields and emit `interface{}` type
- Add smart conversion logic to `ToProto()` methods

**Helper Code** (1 file):
- Add `String()` method to `TaskFieldRef` for map value conversion

**Total**: ~8 file updates

---

## Testing Surface Area

**Unit Tests Needed**:
1. String literal assignment (backward compatibility)
2. TaskFieldRef assignment (new functionality)
3. Type mismatch error handling
4. Map value conversion
5. Nested field references
6. Nil value handling

**Integration Tests Needed**:
1. All 6 modified task types work in real workflows
2. Generated proto/YAML is correct
3. Workflow execution succeeds
4. Example code compiles and runs

**Estimated Test Count**: ~25-30 test cases

---

## Backward Compatibility

### ✅ Fully Backward Compatible

**Existing code continues to work**:
```go
// Old code - still works
HttpCall("fetch", &HttpCallArgs{
    URI: "https://api.example.com",  // String literal - no problem
})

// New code - also works
HttpCall("fetch", &HttpCallArgs{
    URI: prevTask.Field("url"),  // TaskFieldRef - converted automatically
})
```

**Why safe**:
- `interface{}` accepts both string and TaskFieldRef
- Type checking happens at runtime with clear errors
- No breaking changes to public API

---

## Risk Assessment

### Low Risks ✅

- **Backward compatibility**: Zero breaking changes
- **Type safety**: Interface check at ToProto() with clear errors
- **Scope creep**: Only 6 fields affected
- **Testing**: Straightforward test cases

### Medium Risks ⚠️

- **Code generator complexity**: Pattern matching must be accurate
- **Error messages**: Must be helpful when wrong type used
- **Documentation**: Users need clear guidance

### Mitigation Strategies

1. **Comprehensive pattern testing**: Test generator on all existing fields
2. **Type validation**: Clear error messages like "URI must be string or TaskFieldRef, got int"
3. **Migration examples**: Show before/after in docs
4. **Gradual rollout**: Can be enabled per-field incrementally

---

## Decision Framework Results

### Criteria Analysis

| Criterion | Threshold | Actual | Status |
|-----------|-----------|--------|--------|
| Total fields | < 50 feasible | ~20 fields | ✅ PASS |
| Simple string fields | - | 6 fields | ✅ Easy |
| Maintainability | Clear pattern | Field name pattern | ✅ Clear |
| Long-term scaling | To 20+ tasks | Pattern-based | ✅ Scales |
| Breaking changes | None | Zero | ✅ Safe |

### Final Assessment: ✅ **GO**

**Confidence Level**: HIGH

**Rationale**:
1. **Manageable scope**: Only 6 simple fields need type changes
2. **Clear pattern**: Field name matching is predictable
3. **No breaking changes**: Fully backward compatible
4. **High value**: Eliminates `.Expression()` calls across entire SDK
5. **Scales well**: Pattern handles future task types automatically

---

## Implementation Recommendations

### Phase 1: Foundation (Quick Win)

1. ✅ Add `String()` method to `TaskFieldRef`
2. ✅ Create `Expression` interface:
   ```go
   type Expression interface {
       Expression() string
   }
   ```

### Phase 2: Code Generator Updates

1. ✅ Add expression field pattern detection
2. ✅ Generate `interface{}` for detected fields
3. ✅ Generate smart conversion in `ToProto()`
4. ✅ Add comprehensive tests

### Phase 3: Documentation

1. ✅ Update USAGE.md with new patterns
2. ✅ Add migration guide (before/after)
3. ✅ Update examples to remove `.Expression()` calls

---

## Next Steps

Based on this analysis:

1. ✅ **Proceed to Task 3**: Make formal GO/NO-GO decision
2. ✅ **Start Task 4**: Implement LoopBody helper (independent of smart conversion)
3. ✅ **Prepare Task 5**: Smart type conversion implementation
4. ✅ **Update Task 6**: Migrate example to clean patterns

---

## Appendix: Complete Field Inventory

### All Expression-Accepting Fields

```
HTTP_CALL:
  - URI: string → interface{}
  - Headers: map[string]string (no change)
  - Body: map[string]interface{} (no change)

GRPC_CALL:
  - Body: map[string]interface{} (no change)

FOR:
  - In: string → interface{}
  - Do: []map[string]interface{} (nested tasks)

SWITCH:
  - Cases: []map[string]interface{} (nested when/then)

SET:
  - Variables: map[string]string (no change)

RUN:
  - Input: map[string]interface{} (no change)

AGENT_CALL:
  - Message: string → interface{}
  - Env: map[string]string (no change)
  - Config: map[string]interface{} (no change)

RAISE:
  - Error: string → interface{}
  - Message: string → interface{}
  - Data: map[string]interface{} (no change)

LISTEN:
  - Event: string → interface{}

CALL_ACTIVITY:
  - Input: map[string]interface{} (no change)
```

**Total Changes**: 6 fields across 6 task types
**Total NO-CHANGE**: 14 fields (already flexible)

---

**Report Complete** ✅

**Recommendation**: Proceed with smart type conversion implementation
