# Task T01: Feature Analysis and Design - Execution Log

**Status**: IN PROGRESS
**Started**: 2026-01-23
**Type**: Feature Development

---

## Phase 1: Requirements Analysis

### 1.1 Feature Scope Understanding

**Objective**: Build a universal SDK options code generator that automatically generates functional options for ALL SDK resources from proto/JSON schemas.

**Current State Analysis**:

The SDK currently has ~21 config types across multiple packages that use the functional options pattern:

**Top-Level Resources** (what users create):
- **Agent**: `sdk/go/agent/agent.go`
  - ~10 options: WithName, WithInstructions, WithSkills, WithSubAgents, WithMCPServer, WithEnvironmentVariable, etc.
  - Schema: `tools/codegen/schemas/agent/agent.json`
  
- **Skill**: `sdk/go/skill/skill.go`
  - ~7 options: WithName, WithMarkdown, WithDescription, etc.
  - Schema: `tools/codegen/schemas/skill/skill.json`
  
- **Workflow**: `sdk/go/workflow/workflow.go`
  - ~10 options: WithNamespace, WithName, WithVersion, WithDescription, etc.
  - (No schema yet - would need to be created)

**Component Types** (nested in above):
- **SubAgent**: `sdk/go/subagent/subagent.go` (~5 options)
  - Schema: `tools/codegen/schemas/types/subagent.json`
  
- **Workflow Tasks**: `sdk/go/workflow/*_options.go` (13 types)
  - HTTP_CALL: `httpcall_options.go` (~10 functions, ~150 LOC)
  - AGENT_CALL: `agentcall_options.go` (~15 functions, ~180 LOC)
  - SET, SWITCH, FOR, FORK, TRY, RAISE, LISTEN, RUN, WAIT, GRPC, CALL_ACTIVITY
  - Schemas: `tools/codegen/schemas/tasks/*.json` (13 schemas)
  
- **MCP Servers**: `sdk/go/mcpserver/options.go` (3 types)
  - Stdio, HTTP, Docker servers
  - Schemas: `tools/codegen/schemas/types/*server.json`
  
- **Environment**: `sdk/go/environment/environment.go` (~5 options)
  - Schema: `tools/codegen/schemas/types/environmentspec.json`

**Total Impact**:
- ~21 config types × 5-15 options each = **100-200 functions** currently hand-written
- **~2,000-3,000 lines** of repetitive options code across the SDK

### 1.2 User Stories

**US-1: SDK Developer Adding New Task Type**
- As a developer adding a new workflow task type
- I want to only define the JSON schema
- So that all options code is generated automatically

**US-2: SDK User Creating Workflows**
- As a user creating workflows
- I want consistent, discoverable functional options across all task types
- So that I can build workflows faster with IDE autocomplete

**US-3: SDK Maintainer**
- As a maintainer
- I want to minimize hand-written code
- So that bugs are reduced and new features are added faster

### 1.3 Edge Cases & Error Scenarios

**Edge Case 1: Special Field Types**
- Maps (e.g., `Headers map[string]string`)
- Arrays (e.g., `Skills []skill.Skill`)
- Nested messages (e.g., `McpServers []mcpserver.MCPServer`)
- Solution: Generate type-appropriate option functions

**Edge Case 2: Multiple Ways to Set Same Field**
- Singular + Plural (e.g., `WithSkill` + `WithSkills`)
- Aliases (e.g., `Body` vs `WithBody`, `HTTPMethod` vs `HTTPGet`)
- Solution: Generate both variants from schema metadata

**Edge Case 3: Convenience Helpers**
- HTTP method shortcuts (`HTTPGet()`, `HTTPPost()`)
- Common config helpers (`Model()`, `Temperature()`)
- Solution: Keep these as manual "ergonomic sugar" layer (~5% of code)

**Edge Case 4: Expression Support**
- Fields accepting expressions (e.g., `"${.token}"`)
- TaskFieldRef (e.g., `task.Field("url")`)
- Solution: Generate options that accept `interface{}` with `coerceToString()`

---

## Phase 2: Technical Analysis

### 2.1 Current Codegen Architecture

**File**: `tools/codegen/generator/main.go`

**What it DOES generate**:
1. Config structs (e.g., `HttpCallTaskConfig`)
2. `ToProto()` methods (Config → google.protobuf.Struct)
3. `FromProto()` methods (google.protobuf.Struct → Config)
4. Helper utilities (`isEmpty()`)

**What it DOES NOT generate**:
1. ❌ Option types (e.g., `type HttpCallOption func(*HttpCallTaskConfig)`)
2. ❌ Builder functions (e.g., `func HttpCall(name string, opts ...HttpCallOption) *Task`)
3. ❌ Option functions (e.g., `func URI(uri string) HttpCallOption`)
4. ❌ Convenience helpers (e.g., `func HTTPGet() HttpCallOption`)

**Why**: Line 343 comment says:
> "Builder functions are NOT generated here. They belong in the ergonomic API layer (workflow.go and *_options.go), not in generated code, because they reference manual SDK types like *Task."

**Current Architecture**:
```
JSON Schema → Codegen → Generated Layer (structs + proto conversion)
                     ↓
              Manual Layer (options + builders)
```

**Proposed Architecture**:
```
JSON Schema → Codegen → Generated Layer (structs + proto + OPTIONS)
                     ↓
              Ergonomic Layer (aliases + helpers) [~5% manual]
```

### 2.2 Existing Options Patterns

**Pattern Analysis** (from `httpcall_options.go` and `agentcall_options.go`):

```go
// PATTERN 1: Option Type Declaration
type HttpCallOption func(*HttpCallTaskConfig)

// PATTERN 2: Main Builder Function
func HttpCall(name string, opts ...HttpCallOption) *Task {
    config := &HttpCallTaskConfig{
        Headers: make(map[string]string),  // Initialize maps
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

// PATTERN 3: Simple Field Setters
func URI(uri interface{}) HttpCallOption {
    return func(c *HttpCallTaskConfig) {
        c.URI = coerceToString(uri)  // Expression support
    }
}

// PATTERN 4: Map/Array Adders
func Header(key, value interface{}) HttpCallOption {
    return func(c *HttpCallTaskConfig) {
        c.Headers[coerceToString(key)] = coerceToString(value)
    }
}

// PATTERN 5: Bulk Setters
func Headers(headers map[string]interface{}) HttpCallOption {
    return func(c *HttpCallTaskConfig) {
        for key, value := range headers {
            c.Headers[coerceToString(key)] = coerceToString(value)
        }
    }
}

// PATTERN 6: Aliases (MANUAL - not generated)
func WithBody(body map[string]interface{}) HttpCallOption {
    return Body(body)
}

// PATTERN 7: Convenience Helpers (MANUAL - not generated)
func HTTPGet() HttpCallOption {
    return HTTPMethod("GET")
}
```

**Patterns to Generate** (95% of code):
- ✅ Pattern 1: Option type declarations
- ✅ Pattern 2: Main builder functions
- ✅ Pattern 3: Simple field setters
- ✅ Pattern 4: Map/array adders (singular)
- ✅ Pattern 5: Bulk setters (plural)

**Patterns to Keep Manual** (~5% of code):
- ⚠️ Pattern 6: Aliases (can be generated if schema has metadata)
- ⚠️ Pattern 7: Convenience helpers (domain-specific logic)

### 2.3 JSON Schema Analysis

**Example Schema** (`tools/codegen/schemas/tasks/http_call.json`):

```json
{
  "name": "HttpCallTaskConfig",
  "kind": "HTTP_CALL",
  "description": "HTTP_CALL tasks make HTTP requests",
  "protoType": "ai.stigmer.agentic.workflow.v1.tasks.HttpCallTaskConfig",
  "protoFile": "apis/ai/stigmer/agentic/workflow/v1/tasks/http_call.proto",
  "fields": [
    {
      "name": "Method",
      "jsonName": "method",
      "protoField": "method",
      "type": { "kind": "string" },
      "description": "HTTP method (GET, POST, ...)",
      "required": true,
      "validation": {
        "required": true,
        "enum": ["GET", "POST", "PUT", "DELETE", "PATCH"]
      }
    },
    {
      "name": "Headers",
      "jsonName": "headers",
      "protoField": "headers",
      "type": {
        "kind": "map",
        "keyType": { "kind": "string" },
        "valueType": { "kind": "string" }
      },
      "description": "HTTP headers (optional)",
      "required": false
    }
  ]
}
```

**Available Metadata for Generation**:
- ✅ `name`: Field name (e.g., "Method")
- ✅ `jsonName`: JSON field name (e.g., "method")
- ✅ `type.kind`: Field type (string, int32, map, array, message, struct)
- ✅ `type.keyType/valueType`: For maps
- ✅ `type.elementType`: For arrays
- ✅ `type.messageType`: For nested messages
- ✅ `description`: Field documentation
- ✅ `required`: Whether field is required
- ✅ `validation`: Enum values, min/max, patterns

**Missing Metadata** (would enhance generation):
- ❌ Aliases (e.g., "Body" has alias "WithBody")
- ❌ Convenience shortcuts (e.g., "Method" has shortcuts "HTTPGet", "HTTPPost")
- ❌ Custom parameter names (currently derived from field name)

**Recommendation**: Start with existing metadata, add extended metadata in future iterations.

### 2.4 Common Patterns vs Special Cases

**Common Patterns** (can be templated):

1. **String Fields** (70% of fields):
   ```go
   func FieldName(value interface{}) OptionType {
       return func(c *ConfigType) {
           c.FieldName = coerceToString(value)
       }
   }
   ```

2. **Int/Bool Fields** (10% of fields):
   ```go
   func Timeout(seconds int32) OptionType {
       return func(c *ConfigType) {
           c.TimeoutSeconds = seconds
       }
   }
   ```

3. **Map Fields - Singular** (10% of fields):
   ```go
   func Header(key, value interface{}) OptionType {
       return func(c *ConfigType) {
           c.Headers[coerceToString(key)] = coerceToString(value)
       }
   }
   ```

4. **Map Fields - Bulk** (10% of fields):
   ```go
   func Headers(headers map[string]interface{}) OptionType {
       return func(c *ConfigType) {
           for k, v := range headers {
               c.Headers[coerceToString(k)] = coerceToString(v)
           }
       }
   }
   ```

5. **Array Fields - Singular** (5% of fields):
   ```go
   func WithSkill(skill skill.Skill) AgentOption {
       return func(a *Agent) error {
           a.Skills = append(a.Skills, skill)
           return nil
       }
   }
   ```

6. **Array Fields - Bulk** (5% of fields):
   ```go
   func WithSkills(skills ...skill.Skill) AgentOption {
       return func(a *Agent) error {
           a.Skills = append(a.Skills, skills...)
           return nil
       }
   }
   ```

**Special Cases** (need custom handling):

1. **Nested Messages**:
   - Example: `McpServers []mcpserver.MCPServer`
   - Need to import the message type's package
   - Need to use the correct type (not `interface{}`)

2. **Struct Fields** (google.protobuf.Struct → map[string]interface{}):
   - Example: `Body map[string]interface{}`
   - Use `map[string]interface{}` as Go type

3. **Expression Support**:
   - Fields that accept expressions need `interface{}` parameter + `coerceToString()`
   - Currently applied to: URI, headers, env vars, messages

4. **Map Initialization**:
   - Maps need to be initialized in the builder function
   - Example: `Headers: make(map[string]string)`

### 2.5 Dependency Mapping

**Required Libraries**:
- ✅ `encoding/json`: Schema parsing (already used)
- ✅ `text/template`: Go template execution (already used)
- ✅ `go/format`: Code formatting (already used)
- ✅ `path/filepath`: File handling (already used)

**New Dependencies**:
- None needed! Can reuse existing codegen infrastructure.

**Data Flow**:
```
1. Load JSON schemas (EXISTING: loadSchemas)
2. Parse field metadata (EXISTING: FieldSchema struct)
3. Generate option types (NEW: generateOptionTypes)
4. Generate builder functions (NEW: generateBuilderFunctions)
5. Generate option functions (NEW: generateOptionFunctions)
6. Format and write files (EXISTING: writeFormattedFile)
```

**Integration Points**:
- Generator.Generate() method (line 119-148)
- Need to add options generation after shared types generation

**Compatibility Concerns**:
- ✅ Backward Compatible: Generated options should match existing manual ones exactly
- ✅ Import Cycles: Options in same package as configs (no new imports needed)
- ✅ Test Compatibility: All existing tests should pass without modification

---

## Phase 3: Design

### 3.1 Architecture Design

**High-Level Component Design**:

```
┌─────────────────────────────────────────────────────────────┐
│                    JSON Schema Files                         │
│  (tasks/*.json, agent/*.json, types/*.json)                 │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│              Code Generator (main.go)                        │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 1. Load Schemas (EXISTING)                          │   │
│  │    - loadTaskConfigSchema()                         │   │
│  │    - loadTypeSchema()                               │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 2. Generate Structs (EXISTING)                      │   │
│  │    - genConfigStruct()                              │   │
│  │    - genTypeStruct()                                │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 3. Generate Proto Methods (EXISTING)                │   │
│  │    - genToProtoMethod()                             │   │
│  │    - genFromProtoMethod()                           │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 4. Generate Options (NEW)                           │   │
│  │    - genOptionType()                 ← NEW          │   │
│  │    - genBuilderFunction()            ← NEW          │   │
│  │    - genOptionFunctions()            ← NEW          │   │
│  │      - Simple field setters                         │   │
│  │      - Map/array adders                             │   │
│  │      - Bulk setters                                 │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 5. Format & Write (EXISTING)                        │   │
│  │    - writeFormattedFile()                           │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│              Generated Code Output                           │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ sdk/go/workflow/gen/http_call_task_config.go        │  │
│  │   - HttpCallTaskConfig struct      (EXISTING)       │  │
│  │   - ToProto() method               (EXISTING)       │  │
│  │   - FromProto() method             (EXISTING)       │  │
│  │   - HttpCallOption type            (NEW)            │  │
│  │   - HttpCall() builder             (NEW)            │  │
│  │   - URI(), Header(), etc.          (NEW)            │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ sdk/go/workflow/gen/agent_call_task_config.go       │  │
│  │   (same structure)                                   │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ sdk/go/agent/gen/agent_spec.go                      │  │
│  │   (same structure - NEW for Agent resource)         │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────┐
│         Ergonomic Layer (5% manual)                          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ sdk/go/workflow/workflow_sugar.go                    │  │
│  │   - HTTPGet() → HTTPMethod("GET")                    │  │
│  │   - HTTPPost() → HTTPMethod("POST")                  │  │
│  │   - WithBody() → Body()                              │  │
│  │   - Model() → AgentConfigValue("model", ...)        │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Interfaces and Contracts**:

No new interfaces needed - using functional options pattern which is inherently interface-free.

**Data Models**:

```go
// genContext already has imports tracking - enhance with:
type genContext struct {
    packageName string
    imports     map[string]struct{}
    generated   map[string]struct{}
    
    // NEW: Option generation metadata
    optionTypeName string  // e.g., "HttpCallOption"
    configTypeName string  // e.g., "HttpCallTaskConfig"
    taskKind       string  // e.g., "HttpCall" (for TaskKind enum)
}
```

### 3.2 Implementation Strategy

**Phased Approach**:

**Phase 1: Core Options Generation** (T02)
- ✅ Add option type generation
- ✅ Add builder function generation
- ✅ Add simple field setter generation
- ✅ Test with ONE task type (HTTP_CALL)
- ✅ Validate generated code compiles
- ✅ Validate generated code matches manual code

**Phase 2: Complex Field Types** (T03)
- ✅ Add map field generation (singular + bulk)
- ✅ Add array field generation (singular + bulk)
- ✅ Add nested message field generation
- ✅ Test with AGENT_CALL (has maps, arrays, nested types)
- ✅ Validate all 13 workflow task types

**Phase 3: Agent/Skill Resources** (T04)
- ✅ Generate options for Agent resource
- ✅ Generate options for Skill resource
- ✅ Generate options for SubAgent type
- ✅ Generate options for MCP server types
- ✅ Generate options for Environment type

**Phase 4: Migration & Testing** (T05)
- ✅ Replace manual options files with generated ones
- ✅ Update imports in test files
- ✅ Run full test suite
- ✅ Fix any breaking changes
- ✅ Update documentation

**Phase 5: Ergonomic Layer** (T06)
- ✅ Extract convenience helpers to separate files
- ✅ Create *_sugar.go files with aliases
- ✅ Document what's generated vs manual
- ✅ Create guidelines for future additions

**Parallelization Opportunities**:
- Phase 2 & 3 can be developed in parallel after Phase 1 is complete
- Testing can happen concurrently with development

### 3.3 Testing Strategy

**Unit Test Coverage**:

```go
// Test 1: Option Type Generation
func TestGenerateOptionType(t *testing.T) {
    // Verify option type declaration is correct
}

// Test 2: Builder Function Generation
func TestGenerateBuilderFunction(t *testing.T) {
    // Verify builder initializes maps, applies options, returns Task
}

// Test 3: Simple Field Setters
func TestGenerateFieldSetter(t *testing.T) {
    // Verify string, int, bool field setters
}

// Test 4: Map Field Options
func TestGenerateMapFieldOptions(t *testing.T) {
    // Verify singular and bulk map setters
}

// Test 5: Array Field Options
func TestGenerateArrayFieldOptions(t *testing.T) {
    // Verify singular and bulk array setters
}

// Test 6: Expression Support
func TestGenerateExpressionSupport(t *testing.T) {
    // Verify coerceToString() usage for expressions
}
```

**Integration Tests**:

```go
// Test 1: Generated Code Compiles
func TestGeneratedCodeCompiles(t *testing.T) {
    // Run codegen, compile generated files
}

// Test 2: Generated Options Work
func TestGeneratedOptionsWork(t *testing.T) {
    // Create tasks using generated options
    // Verify config is set correctly
}

// Test 3: Backward Compatibility
func TestBackwardCompatibility(t *testing.T) {
    // Existing tests should pass with generated options
}
```

**Acceptance Test Criteria**:

✅ **Criterion 1**: Generated code compiles without errors
✅ **Criterion 2**: Generated options match existing manual options functionally
✅ **Criterion 3**: All existing SDK tests pass without modification
✅ **Criterion 4**: New task types require only JSON schema (no manual code)
✅ **Criterion 5**: Generated code is readable and well-documented

---

## Phase 4: Validation

### 4.1 Design Review Checklist

- [x] Feature requirements clearly documented
- [x] User stories identified
- [x] Edge cases analyzed
- [x] Current system thoroughly understood
- [x] Existing patterns documented
- [x] JSON schemas analyzed
- [x] Dependencies identified (none new needed)
- [x] Data flow mapped
- [x] High-level architecture designed
- [x] Implementation broken into phases
- [x] Testing strategy defined

### 4.2 Risk Assessment

**Risk 1: Generated Code Differs from Manual Code**
- **Likelihood**: Medium
- **Impact**: High (breaks backward compatibility)
- **Mitigation**: 
  - Generate one task type first (HTTP_CALL)
  - Compare generated vs manual line-by-line
  - Adjust templates until exact match
  - Run full test suite for validation

**Risk 2: Import Cycles**
- **Likelihood**: Low
- **Impact**: High (code won't compile)
- **Mitigation**:
  - Generate options in same package as configs
  - Avoid cross-package references in generated code
  - Keep `workflow.Task` reference in builder (already resolved in current design)

**Risk 3: Schema Metadata Insufficient**
- **Likelihood**: Medium
- **Impact**: Medium (some options need manual implementation)
- **Mitigation**:
  - Start with 95% generation goal (not 100%)
  - Keep ergonomic layer for special cases
  - Enhance schemas incrementally if needed

**Risk 4: Performance Regression**
- **Likelihood**: Low
- **Impact**: Low (codegen is dev-time only)
- **Mitigation**:
  - Generated code is identical to manual (no runtime difference)
  - Codegen runs once per build (acceptable speed)

### 4.3 Rollback Approach

If generated options cause issues:

**Option A: Gradual Rollback**
1. Keep manual options files alongside generated ones
2. Update imports to use manual options
3. Fix generator issues
4. Re-generate and switch back

**Option B: Full Rollback**
1. Git revert codegen changes
2. Keep manual options files
3. Re-plan implementation approach
4. Try again with lessons learned

**Safe Deployment Strategy**:
1. Generate options in `gen/` subdirectory first
2. Don't delete manual files immediately
3. Run tests with generated options
4. Once validated, replace manual files
5. Keep manual files in git history for reference

---

## Next Steps

**Immediate Actions**:
1. ✅ Complete this analysis document
2. ⏳ Get stakeholder review and approval
3. ⏳ Start Phase 1 implementation (T02: Core Options Generation)
4. ⏳ Create first generator function: `genOptionType()`
5. ⏳ Test with HTTP_CALL task type
6. ⏳ Iterate until generated code matches manual code exactly

**Questions for Stakeholders**:
1. Should we generate ALL options (95%+ coverage) or start with most common patterns (70% coverage)?
   - **Recommendation**: Start with 95% coverage - schemas have all needed metadata
   
2. Should generated options go in `gen/` subdirectory or same directory as manual options?
   - **Recommendation**: `gen/` subdirectory for clear separation and easier rollback
   
3. Should we migrate all 13 workflow tasks at once or one at a time?
   - **Recommendation**: One at a time with validation at each step
   
4. Should we add schema metadata for aliases and convenience helpers?
   - **Recommendation**: Not yet - keep 5% ergonomic layer manual for now

**Success Metrics**:
- Lines of manual code: ~2,500 → ~250 (90% reduction)
- Time to add new task type: ~2 hours → ~10 minutes (92% reduction)
- Option function count: ~150 manual → ~150 generated (100% coverage)
- Test coverage: Maintain 100% of existing tests passing

---

## Summary

This analysis has identified a clear path forward:

1. **The Problem**: 100-200 functions (~2,500 LOC) hand-written across SDK
2. **The Solution**: Universal options generator using existing JSON schemas
3. **The Approach**: 95% code generation, 5% ergonomic sugar manual
4. **The Impact**: 90% reduction in manual code, 92% faster to add features
5. **The Risk**: Low - can be validated incrementally with full rollback capability

**Ready to proceed to T02: Core Options Generation** ✅
