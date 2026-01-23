# Learning Log: Stigmer Go SDK Implementation

This log captures patterns, solutions, and gotchas discovered while implementing Stigmer SDK features in Go.

---

## 2026-01-22: Context Lock Deadlock Prevention

### Context

Completed ToProto() pipeline and discovered critical deadlock bug during example testing. All examples hung with "fatal error: all goroutines are asleep - deadlock!" when calling Context.Synthesize().

### Pattern: Direct Field Access When Lock is Already Held

**Problem**: Method holding a lock called another public method that tried to acquire the same lock, causing deadlock.

**Bad Practice**:
```go
// ❌ Wrong - deadlock!
func (c *Context) Synthesize() error {
    c.mu.Lock()  // Acquire lock
    defer c.mu.Unlock()
    
    // ... other synthesis work ...
    
    // Calls public method that tries to acquire lock again
    if err := c.synthesizeDependencies(outputDir); err != nil {
        return err
    }
    
    return nil
}

func (c *Context) synthesizeDependencies(outputDir string) error {
    deps := c.Dependencies()  // ❌ Tries to acquire c.mu.RLock() → DEADLOCK!
    // ...
}
```

**Correct Practice**:
```go
// ✅ Correct - direct field access
func (c *Context) Synthesize() error {
    c.mu.Lock()
    defer c.mu.Unlock()
    
    // ... other synthesis work ...
    
    if err := c.synthesizeDependencies(outputDir); err != nil {
        return err
    }
    
    return nil
}

// NOTE: This method assumes the caller already holds c.mu lock
func (c *Context) synthesizeDependencies(outputDir string) error {
    // Access dependencies directly (caller holds lock)
    deps := c.dependencies  // ✅ Direct access, no lock needed
    
    data, _ := json.MarshalIndent(deps, "", "  ")
    os.WriteFile(filepath.Join(outputDir, "dependencies.json"), data, 0644)
    return nil
}
```

**Why This Matters**:
- **Correctness**: Prevents deadlocks that block all execution
- **Performance**: No unnecessary lock contention
- **Clarity**: Internal helpers that assume lock is held are clearly documented

**Prevention**:
1. Document which methods assume caller holds lock
2. Never call public methods (that acquire locks) from within locked sections
3. Use direct field access for internal helpers called while locked
4. Add tests that run examples end-to-end (would catch deadlocks)

**Impact**: CRITICAL - Blocked all synthesis until fixed.

---

## 2026-01-22: structpb Type Conversion Requirements

### Context

Implemented Workflow ToProto() with all 13 task types. Discovered that google.protobuf.Struct has strict type requirements that cause runtime errors if violated.

### Pattern: Convert to interface{} Types for structpb

**Problem**: `structpb.NewStruct()` doesn't accept `map[string]string` or `[]map[string]interface{}` - requires `map[string]interface{}` and `[]interface{}`.

**Bad Practice**:
```go
// ❌ Wrong - runtime error
func httpCallTaskConfigToMap(c *HttpCallTaskConfig) map[string]interface{} {
    m := make(map[string]interface{})
    m["headers"] = c.Headers  // map[string]string - FAILS!
    return m
}

protoStruct, err := structpb.NewStruct(m)
// Error: proto: invalid type: map[string]string
```

**Correct Practice**:
```go
// ✅ Correct - convert to map[string]interface{}
func httpCallTaskConfigToMap(c *HttpCallTaskConfig) map[string]interface{} {
    m := make(map[string]interface{})
    
    if c.Headers != nil && len(c.Headers) > 0 {
        // Convert map[string]string → map[string]interface{}
        headers := make(map[string]interface{})
        for k, v := range c.Headers {
            headers[k] = v
        }
        m["headers"] = headers
    }
    
    return m
}

protoStruct, err := structpb.NewStruct(m)  // ✅ Works!
```

**Array Conversion**:
```go
// ❌ Wrong - runtime error
func switchTaskConfigToMap(c *SwitchTaskConfig) map[string]interface{} {
    m := make(map[string]interface{})
    m["cases"] = c.Cases  // []map[string]interface{} - FAILS!
    return m
}

// ✅ Correct - convert to []interface{}
func switchTaskConfigToMap(c *SwitchTaskConfig) map[string]interface{} {
    m := make(map[string]interface{})
    
    if c.Cases != nil && len(c.Cases) > 0 {
        // Convert []map[string]interface{} → []interface{}
        cases := make([]interface{}, len(c.Cases))
        for i, caseMap := range c.Cases {
            cases[i] = caseMap
        }
        m["cases"] = cases
    }
    
    return m
}
```

**Why This Matters**:
- **Runtime Safety**: Catches type errors at proto conversion time
- **Required**: structpb package enforces these types strictly
- **Applies to All Conversions**: Any SDK → proto.Struct conversion needs this

**Prevention**:
1. Always convert map[string]string to map[string]interface{} before structpb
2. Always convert []T to []interface{} before structpb
3. Add integration tests that call ToProto() to catch these early
4. Remember: structpb.NewStruct() signature is `func NewStruct(map[string]interface{})`

**Impact**: MEDIUM - Required for all 13 workflow task types. Integration tests caught this immediately.

---

## 2026-01-22: Integration Test Pattern for ToProto() Methods

### Context

Created comprehensive integration tests for Agent, Skill, and Workflow ToProto() methods. Established reusable pattern for testing proto conversions.

### Pattern: Package-Level Proto Integration Tests

**Best Practice**: Create `proto_integration_test.go` in each package that has ToProto() methods.

**File Structure**:
```
sdk/go/agent/
├── agent.go              # Agent type and New()
├── proto.go              # ToProto() implementation
└── proto_integration_test.go  # Integration tests
```

**Test Pattern**:
```go
package agent

import (
    "testing"
)

// Test complete resource with all optional fields
func TestAgentToProto_Complete(t *testing.T) {
    agent, _ := New(nil,
        WithName("test-agent"),
        WithDescription("Full agent with all fields"),
        WithInstructions("Do something"),
        WithIconURL("https://example.com/icon.png"),
    )
    
    proto, err := agent.ToProto()
    if err != nil {
        t.Fatalf("ToProto() failed: %v", err)
    }
    
    // Verify metadata
    if proto.Metadata.Name != "test-agent" {
        t.Errorf("Name mismatch")
    }
    
    // Verify API version and kind
    if proto.ApiVersion != "agentic.stigmer.ai/v1" {
        t.Errorf("ApiVersion mismatch")
    }
    
    // Verify SDK annotations
    if proto.Metadata.Annotations[AnnotationSDKLanguage] != "go" {
        t.Error("Expected SDK language annotation")
    }
    
    // Verify spec fields
    if proto.Spec.Description != "Full agent with all fields" {
        t.Errorf("Description mismatch")
    }
}

// Test minimal resource (required fields only)
func TestAgentToProto_Minimal(t *testing.T) {
    agent, _ := New(nil,
        WithName("simple-agent"),
        WithInstructions("Simple task"),
    )
    
    proto, err := agent.ToProto()
    if err != nil {
        t.Fatalf("ToProto() failed: %v", err)
    }
    
    // Verify required fields
    if proto.Metadata.Name != "simple-agent" {
        t.Errorf("Name mismatch")
    }
    
    // Verify optional fields are empty
    if proto.Spec.Description != "" {
        t.Error("Expected empty description")
    }
}

// Test specific features (custom slug, multiple skills, etc.)
func TestAgentToProto_CustomSlug(t *testing.T) { ... }
func TestAgentToProto_MultipleSkills(t *testing.T) { ... }
```

**Test Coverage Areas**:
1. Complete resource (all optional fields)
2. Minimal resource (required fields only)
3. Field-specific tests (custom slug, arrays, nested objects)
4. SDK annotations verification
5. Proto structure validation (ApiVersion, Kind, Metadata)

**Benefits**:
- ✅ Catches structpb type conversion errors early
- ✅ Validates proto structure correctness
- ✅ Ensures SDK annotations are injected
- ✅ Documents expected proto format
- ✅ Close to implementation (easy to maintain)
- ✅ Reusable pattern for future resource types

**When to Use**: Create `proto_integration_test.go` for every package that implements ToProto().

**Naming Convention**: `Test{TypeName}ToProto_{Aspect}` - e.g., `TestAgentToProto_Complete`, `TestWorkflowToProto_AllTaskTypes`

---

## 2026-01-22: Enum Constants vs Magic Numbers in Proto Conversions

### Context

Completed Agent SDK ToProto() implementation with all nested type conversions (skills, MCP servers, sub-agents, environment variables). Fixed hardcoded enum values to use proper constants.

### Pattern: Always Use Proto-Generated Enum Constants

**Problem**: Using magic numbers for proto enum values makes code brittle and unclear.

**Bad Practice**:
```go
// ❌ Wrong - magic number
ref := &apiresource.ApiResourceReference{
    Slug: "my-skill",
    Kind: 43, // What is 43? Have to look it up in proto!
}
```

**Correct Practice**:
```go
// ✅ Correct - enum constant from generated code
import "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource/apiresourcekind"

ref := &apiresource.ApiResourceReference{
    Slug: "my-skill",
    Kind: apiresourcekind.ApiResourceKind_skill, // Self-documenting!
}
```

**Why This Matters**:
- **Type safety**: Compiler catches invalid values
- **Self-documenting**: Clear what the value represents (no mental lookup)
- **Maintainable**: If proto enum values change, code updates automatically via imports
- **Consistent**: Matches pattern used for scope enums throughout codebase

**Common Proto Enums**:
```go
// ApiResourceKind enums
apiresourcekind.ApiResourceKind_skill           // = 43
apiresourcekind.ApiResourceKind_agent_instance  // = 45
apiresourcekind.ApiResourceKind_workflow        // = 20

// ApiResourceOwnerScope enums
apiresource.ApiResourceOwnerScope_platform       // = 1
apiresource.ApiResourceOwnerScope_organization   // = 2
apiresource.ApiResourceOwnerScope_identity_account // = 3
```

**Where to Find Enum Constants**:
```bash
# Search for enum constant names in generated stubs
grep -r "ApiResourceKind_" apis/stubs/go/ai/stigmer/commons/apiresource/
```

**When to Use**: **Every time** you set a proto enum field - never use literal numbers.

### Pattern: Clean Up Obsolete Feature Logic

**Context**: Platform removed inline skills support, but SDK still had conversion logic for inline skills.

**Problem**: Obsolete code creates confusion and potential bugs.

**Solution**: Proactively remove logic for deprecated features:

```go
// ❌ Before - handling obsolete inline skills
if s.IsInline {
    // Logic for inline skills (no longer supported by platform!)
    ref.Scope = apiresource.ApiResourceOwnerScope_api_resource_owner_scope_unspecified
} else if s.Org != "" {
    ref.Scope = apiresource.ApiResourceOwnerScope_organization
    ref.Org = s.Org
} else {
    ref.Scope = apiresource.ApiResourceOwnerScope_platform
}

// ✅ After - only supported feature paths
if s.Org != "" {
    // Organization-scoped skill
    ref.Scope = apiresource.ApiResourceOwnerScope_organization
    ref.Org = s.Org
} else {
    // Platform-scoped skill
    ref.Scope = apiresource.ApiResourceOwnerScope_platform
}
```

**Why This Matters**:
- Prevents users from using removed features
- Eliminates confusion about what's supported
- Reduces code branches (simpler logic)
- Faster compilation (less code to analyze)

**When to Apply**: When platform removes features, immediately clean up SDK code.

---

## 2026-01-17: Automatic Context Variable Injection

### Context

Implemented Pulumi-style automatic context variable injection - users define variables via `ctx.SetX()` and they're automatically available in workflows.

### Pattern 1: ToValue() Interface for Serialization

**Problem**: Need to extract values from typed Refs (StringRef, IntRef, BoolRef, ObjectRef) for synthesis without losing type information.

**Solution**: Add interface method that each type implements:

```go
// In Ref interface
type Ref interface {
    Expression() string
    Name() string
    IsSecret() bool
    ToValue() interface{}  // ← Returns value for serialization
}

// Each typed Ref implements it
func (s *StringRef) ToValue() interface{} { return s.value }
func (i *IntRef) ToValue() interface{} { return i.value }
func (b *BoolRef) ToValue() interface{} { return b.value }
func (o *ObjectRef) ToValue() interface{} { return o.value }
```

**Why This Works**:
- Type-safe at SDK level (StringRef.Value() returns string)
- JSON-compatible at synthesis (ToValue() returns interface{})
- Extensible for future Ref types
- Clean separation of concerns

**When to Use**: Anytime you need to serialize SDK types to protobuf/JSON

### Pattern 2: Automatic Task Injection at Synthesis

**Problem**: Want variables to "just work" without manual initialization - Pulumi-style DX.

**Solution**: Inject initialization task automatically during synthesis:

```go
func workflowSpecToProtoWithContext(wf *workflow.Workflow, contextVars map[string]interface{}) {
    spec := &workflowv1.WorkflowSpec{...}
    
    // Inject context initialization FIRST
    if len(contextVars) > 0 {
        initTask, _ := createContextInitTask(contextVars)
        spec.Tasks = append(spec.Tasks, initTask)  // ← First task
    }
    
    // Then add user tasks
    for _, task := range wf.Tasks {
        spec.Tasks = append(spec.Tasks, task)
    }
}
```

**Why This Works**:
- User doesn't think about plumbing
- Variables initialized before any user code runs
- Clean separation: SDK handles infrastructure, user writes logic

**When to Use**: Anytime you need to inject setup/teardown tasks automatically

### Pattern 3: Type Serialization to Protobuf

**Problem**: Go types (string, int, bool, map) need to serialize to protobuf Value types correctly.

**Solution**: Use google.protobuf.Struct with proper type mapping:

```go
variables := make(map[string]interface{})
for name, ref := range contextVars {
    variables[name] = ref.ToValue()  // Extract typed value
}

// Convert to protobuf Struct
taskConfig, _ := structpb.NewStruct(map[string]interface{}{
    "variables": variables,
})
```

**Result**:
- `string` → `string_value` in proto
- `int` → `number_value` in proto (JSON numbers are float64)
- `bool` → `bool_value` in proto
- `map[string]interface{}` → `struct_value` in proto (nested)

**Gotcha**: JSON numbers are always float64, even for integers! Protobuf handles the conversion correctly.

**When to Use**: Anytime you're converting Go maps to protobuf Structs

### Pattern 4: Testing Protobuf Output

**Problem**: Need to verify synthesized protobuf manifest has correct structure and values.

**Solution**: Parse and inspect programmatically:

```go
// 1. Generate manifest to file
err := stigmer.Run(func(ctx *stigmer.Context) error {
    // ... SDK code ...
})

// 2. Read generated protobuf
data, _ := os.ReadFile(outputDir + "/workflow-manifest.pb")
manifest := &workflowv1.WorkflowManifest{}
proto.Unmarshal(data, manifest)

// 3. Inspect structure
initTask := manifest.Workflows[0].Spec.Tasks[0]
assert.Equal(t, "__stigmer_init_context", initTask.Name)
assert.Equal(t, "WORKFLOW_TASK_KIND_SET", initTask.Kind.String())

// 4. Verify variables
varsStruct := initTask.TaskConfig.Fields["variables"].GetStructValue()
assert.Equal(t, "https://api.example.com", 
    varsStruct.Fields["apiURL"].GetStringValue())
```

**Why This Works**:
- End-to-end verification (synthesis → proto → parse)
- Catches type conversion issues
- Verifies actual runtime structure

**When to Use**: Integration tests for synthesis features

### Architectural Decision: Internal Variables vs External Config

**Confusion Clarified**:

During implementation, there was confusion about when to use:
1. SET task injection (what we built)
2. ExecutionContext + env_spec (future feature)

**The Distinction**:

| Feature | ctx.SetX (Internal) | ctx.Env (External) |
|---------|--------------------|--------------------|
| **Purpose** | Workflow logic, constants | Secrets, runtime config |
| **Set When** | Synthesis time (hardcoded) | Execution time (injected) |
| **Storage** | Workflow YAML (SET task) | ExecutionContext (encrypted) |
| **Equivalent** | N/A (Pulumi has no direct match) | Pulumi's config.Get() |

**Rule of Thumb**:
- **Use SET task** (ctx.SetX) for: Loop counters, API URLs, retry counts, default values
- **Use env_spec** (ctx.Env - future) for: API keys, database passwords, environment-specific config

**Why It Matters**: Using the wrong approach leads to security issues (secrets in YAML) or complexity (hardcoded values that should be configurable).

---

## 2026-01-17: Auto-Export on Field Reference (Pulumi-Style Implicit Dependencies)

### Context

Implemented automatic export when task output fields are referenced via `.Field()` method. This achieves Pulumi-style implicit dependencies where accessing an output automatically makes it available, eliminating manual `.ExportAll()` calls and preventing "nil reference" runtime errors.

### Pattern 1: In-Place Modification for Auto-Export

**Problem**: Users had to manually call `task.ExportAll()` before using `task.Field()` references, creating boilerplate and potential runtime errors if forgotten.

**Solution**: Modify task export in-place when `.Field()` is called:

```go
// In workflow/task.go
func (t *Task) Field(fieldName string) TaskFieldRef {
    // Auto-export: When a task's field is referenced, automatically export the task
    if t.ExportAs == "" {
        t.ExportAs = "${.}"
    }
    
    return TaskFieldRef{
        taskName:  t.Name,
        fieldName: fieldName,
    }
}
```

**Why This Works**:
- Task is a pointer type (`*Task`) - modifications affect the original
- Export is set at point of use (discoverable)
- No separate tracking mechanism needed
- Simpler than visitor pattern or post-processing

**When to Use**: Anytime you need to trigger side effects based on method calls (accessing outputs, referencing resources)

### Pattern 2: Idempotency Check for Safety

**Problem**: Multiple `.Field()` calls on the same task, or calling `.Field()` after `.ExportField()`, could overwrite custom exports.

**Solution**: Check before setting export:

```go
if t.ExportAs == "" {
    t.ExportAs = "${.}"
}
```

**Why This Works**:
- Empty string check is simple and fast
- First `.Field()` call sets export
- Subsequent calls are no-ops
- Custom exports (`.ExportField("specific")`) are preserved

**Benefits**:
- Multiple `.Field()` calls are safe
- User can still override export if needed
- Backward compatible with existing code

**When to Use**: Anytime you're doing automatic behavior that users might customize

### Pattern 3: Export/Reference Alignment Understanding

**Problem**: Understanding how export transforms task output and how field references access it.

**Solution**: Know the transformation:

1. **Export `{ as: '${.}' }`**:
   - Takes current task output (`.`)
   - Makes it available at `$context.<taskName>`
   - For task `fetchData`: output → `$context.fetchData`

2. **Field Reference `fetchTask.Field("title")`**:
   - Generates: `${ $context.fetchData.title }`
   - Reads from: `$context.fetchData.title`

3. **Alignment**:
   ```
   Export:    $context.fetchData        ← Task output stored here
                      ↓
   Reference: $context.fetchData.title  ← Field reads from here
   ```

**Why This Matters**:
- Export and reference must use the same base path
- `${.}` exports to task name automatically (Zigflow behavior)
- Field references assume this structure
- Any mismatch causes runtime "nil reference" errors

**Gotcha**: If you use custom export like `ExportField("specificField")`, it changes the path to `$context.specificField` (not `$context.taskName.specificField`). Field references won't work with this pattern!

**When to Use**: Designing any auto-export or reference system

### Pattern 4: Testing Examples with examples_test.go

**Problem**: Need to verify examples work end-to-end and synthesize correctly.

**Solution**: Follow existing `examples_test.go` pattern:

```go
func TestExample14_AutoExportVerification(t *testing.T) {
    runExampleTest(t, "14_auto_export_verification.go", func(t *testing.T, outputDir string) {
        // 1. Read manifest
        manifestPath := filepath.Join(outputDir, "workflow-manifest.pb")
        assertFileExists(t, manifestPath)
        
        var manifest workflowv1.WorkflowManifest
        readProtoManifest(t, manifestPath, &manifest)
        
        // 2. Verify structure
        workflow := manifest.Workflows[0]
        
        // 3. Find specific task
        var fetchDataTask *workflowv1.WorkflowTask
        for _, task := range workflow.Spec.Tasks {
            if task.Name == "fetchData" {
                fetchDataTask = task
                break
            }
        }
        
        // 4. Verify export is set
        if fetchDataTask.Export == nil {
            t.Error("fetchData should have auto-export")
        } else if fetchDataTask.Export.As != "${.}" {
            t.Errorf("export.as = %v, want ${.}", fetchDataTask.Export.As)
        }
    })
}
```

**Why This Works**:
- `runExampleTest()` helper handles execution with `STIGMER_OUT_DIR`
- Tests actual synthesis (not mocked)
- Verifies protobuf structure
- Follows established pattern (consistent with other 14 tests)

**Pattern Elements**:
- Test function: `TestExample##_Description`
- Use `runExampleTest()` helper
- Verify manifest file created
- Unmarshal and validate proto
- Check specific fields and values

**When to Use**: Every new example should have a test in `examples_test.go`

### UX Decision: Auto-Export vs Manual Export

**Design Choice**: Auto-export when `.Field()` is called instead of requiring manual `.ExportAll()`

**Rationale**:
1. **Pulumi Alignment**: In Pulumi, accessing `resource.output` creates implicit dependency - no manual export needed
2. **Pit of Success**: Doing the right thing is automatic, not optional
3. **Error Prevention**: Forgetting `.ExportAll()` caused runtime "nil reference" errors
4. **Code Clarity**: One fewer line, clearer intent

**Alternative Considered**: Require manual `.ExportAll()` and provide clear error messages

**Why Auto-Export Won**:
- Eliminates entire class of errors
- Matches proven Pulumi UX pattern
- More discoverable (just use `.Field()` naturally)
- Backward compatible (manual `.ExportAll()` still works)

**Trade-off Accepted**: Tasks auto-export even if only one field is used (slight overhead, but negligible)

### Testing Strategy: Three Levels

**Problem**: How to verify auto-export works correctly at all levels.

**Solution**: Test at three levels:

1. **Unit Tests** (`workflow/task_test.go`):
   - Test behavior in isolation
   - Edge cases: idempotency, custom exports
   - Fast, focused tests
   - **Issue**: Other existing tests had compilation errors (unrelated)

2. **Integration Tests** (Example files as programs):
   - Real workflow synthesis
   - Export/reference alignment
   - Run with `go run`
   - Living documentation
   - **Result**: Created Examples 14 & 15, both work perfectly

3. **Test Suite** (`examples/examples_test.go`):
   - End-to-end verification
   - Manifest structure validation
   - Proto field verification
   - **Result**: All 12 tests passing

**Why Three Levels**:
- Unit tests catch logic errors
- Integration tests catch synthesis errors
- Test suite catches manifest structure errors
- Different levels find different bugs

**When to Use**: Any significant SDK feature needs all three levels

---

## 2026-01-18: Runtime Secret Resolution with JIT Placeholders

### Context

Implemented just-in-time (JIT) runtime secret resolution to prevent secrets from appearing in Temporal history or workflow manifests. Secrets are now resolved at activity execution time (not synthesis time) through a placeholder-based architecture.

**Security Impact**: CRITICAL - Prevents secret leakage to Temporal history, manifests, and logs.

### Pattern 1: Automatic Placeholder Preservation via Regex Guard

**Problem**: Need to prevent synthesis interpolator from resolving runtime placeholders while still resolving compile-time variables.

**Discovery**: The synthesis layer's `replaceVariablePlaceholders()` function uses regex pattern `([a-zA-Z_][a-zA-Z0-9_]*)` to match compile-time variables. This pattern **does not match** runtime placeholders because they have a dot after the opening brace.

**Solution**: No code changes needed - automatic preservation!

```go
// In internal/synth/interpolator.go (UNCHANGED)
completeValueRegex := regexp.MustCompile(`"\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}"`)
partialValueRegex := regexp.MustCompile(`\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}`)

// Results:
"${apiKey}"              → MATCHES (resolved to actual value)
"${.secrets.API_KEY}"    → NO MATCH (preserved as-is) ✅
"${.env_vars.REGION}"    → NO MATCH (preserved as-is) ✅
```

**Why This Works**:
- Regex pattern requires first character to be `[a-zA-Z_]`
- Dot (`.`) doesn't match `[a-zA-Z_]`
- Runtime placeholders naturally pass through unchanged
- No special-casing or "exclude patterns" needed
- Implicit security guarantee through validation pattern

**Critical Insight**: Understanding existing validation patterns can reveal implicit guarantees. Leverage existing guards instead of adding new ones.

**When to Use**: Anytime you need compile-time and runtime expression coexistence - use different syntax patterns that don't collide.

### Pattern 2: Placeholder Generation Functions

**Problem**: Need type-safe way to generate runtime placeholders with consistent format.

**Solution**: Simple string formatting functions with validation:

```go
// In workflow/runtime_env.go
func RuntimeSecret(keyName string) string {
    return fmt.Sprintf("${.secrets.%s}", keyName)
}

func RuntimeEnv(varName string) string {
    return fmt.Sprintf("${.env_vars.%s}", varName)
}

func ValidateRuntimeRef(ref string) error {
    pattern := regexp.MustCompile(`^\$\{\.(?:secrets|env_vars)\.[A-Z_][A-Z0-9_]*\}$`)
    if !pattern.MatchString(ref) {
        return fmt.Errorf("invalid runtime reference format: %s", ref)
    }
    return nil
}
```

**Usage**:
```go
// In workflow code
wf.HttpPost("callAPI", endpoint,
    workflow.Header("Authorization", workflow.RuntimeSecret("OPENAI_KEY")),
    workflow.Header("X-Region", workflow.RuntimeEnv("AWS_REGION")),
)

// Generated manifest:
// headers: {
//   "Authorization": "${.secrets.OPENAI_KEY}",
//   "X-Region": "${.env_vars.AWS_REGION}"
// }
```

**Why This Works**:
- Simple string formatting (O(1) performance)
- Type-safe at SDK level
- Validation catches malformed refs early
- Consistent format guaranteed

**When to Use**: Anytime you need to generate placeholder strings that should not be resolved until runtime.

### Pattern 3: Combining Static and Runtime Values

**Problem**: Need to combine static text with runtime placeholders (e.g., "Bearer ${.secrets.TOKEN}").

**Solution**: Use existing `Interpolate()` helper with runtime placeholders:

```go
// Combine static "Bearer " with runtime secret
authHeader := workflow.Interpolate("Bearer ", workflow.RuntimeSecret("API_KEY"))
// Result: "${ \"Bearer \" + ${.secrets.API_KEY} }"

// Wait - this creates nested ${}! Need simpler approach:
// Actually, just use string concatenation at synthesis time:
authHeader := "Bearer " + workflow.RuntimeSecret("API_KEY")
// Result: "Bearer ${.secrets.API_KEY}" ✅ Correct!
```

**Correction**: Direct string concatenation works because:
1. `RuntimeSecret()` returns a complete string `"${.secrets.KEY}"`
2. Go's `+` operator concatenates strings
3. Result is `"Bearer ${.secrets.KEY}"` (valid placeholder in larger string)

**Gotcha**: Don't use `Interpolate()` for runtime placeholders - it's designed for JQ expressions. Simple string concatenation is clearer and works perfectly.

**When to Use**: Combining static prefixes/suffixes with runtime placeholders (Authorization headers, URLs, etc.)

### Pattern 4: Export Variables for Synthesis

**Problem**: Synthesis layer needs access to context variables to interpolate compile-time values.

**Solution**: Add `ExportVariables()` method to Context:

```go
// In stigmer/context.go
func (c *Context) ExportVariables() map[string]interface{} {
    c.mu.RLock()
    defer c.mu.RUnlock()

    result := make(map[string]interface{}, len(c.variables))
    for name, ref := range c.variables {
        result[name] = ref
    }
    return result
}

// Usage in synthesis
manifest, err := synth.ToWorkflowManifestWithContext(ctx.ExportVariables(), wf)
```

**Why This Pattern**:
- Clean separation: Context manages variables, synthesis requests them
- Thread-safe with RLock (read-only operation)
- Returns Ref interfaces (synthesis extracts values via ToValue())
- No direct variable access from synthesis layer

**When to Use**: Anytime synthesis needs access to context data - use export method instead of direct field access.

### Pattern 5: Security Testing - Synthesis Preservation Test

**Problem**: Need to verify secrets aren't resolved during synthesis (critical security test).

**Solution**: Create test that verifies placeholder preservation:

```go
func TestRuntimeSecretPreservedDuringSynthesis(t *testing.T) {
    ctx := stigmer.NewContext()
    
    // Add BOTH compile-time and runtime placeholders
    apiURL := ctx.SetString("apiURL", "https://api.example.com")
    
    task := workflow.HttpCallTask("callAPI",
        workflow.WithURI("${apiURL}/data"), // Compile-time: should resolve
        workflow.Header("Authorization", workflow.RuntimeSecret("OPENAI_KEY")), // Runtime: should preserve
    )
    
    // Synthesize
    manifest, _ := synth.ToWorkflowManifestWithContext(ctx.ExportVariables(), wf)
    
    // Verify compile-time resolved
    uri := manifest.Workflows[0].Spec.Tasks[0].TaskConfig.AsMap()["endpoint"].(map[string]interface{})["uri"].(string)
    assert.Equal(t, "https://api.example.com/data", uri) // ✅ Resolved
    
    // CRITICAL: Verify runtime preserved
    authHeader := manifest.Workflows[0].Spec.Tasks[0].TaskConfig.AsMap()["headers"].(map[string]interface{})["Authorization"].(string)
    assert.Equal(t, "${.secrets.OPENAI_KEY}", authHeader) // ✅ Preserved!
}
```

**Why This Test is Critical**:
- Verifies security guarantee (secrets not in manifests)
- Tests both behaviors (compile-time resolve, runtime preserve)
- Catches regression if regex pattern changes
- Fails loudly if secrets leak ("SECURITY FAILURE" message)

**When to Use**: ALWAYS create this test for any runtime resolution feature. Security tests are not optional.

### Pattern 6: Fail-Fast Error Handling for Missing Variables

**Problem**: Should missing runtime variables fail immediately or fall back silently?

**Decision**: Fail-fast approach with clear error messages.

**Rationale**:
```go
// In zigflow/resolver.go
if !exists {
    missingVars = append(missingVars, fmt.Sprintf("%s.%s", refType, key))
    return match // Keep placeholder for error reporting
}

// After resolution, check for errors
if len(missingVars) > 0 {
    return "", fmt.Errorf("failed to resolve runtime placeholders: %s", 
        strings.Join(missingVars, ", "))
}
```

**Benefits**:
- Clear error messages at resolution time
- Prevents silent failures (task executes with placeholder)
- Easier debugging (error before task execution, not during)
- Better security (don't execute with unresolved secrets)

**Alternative Rejected**: Silent fallback (keep placeholder if missing)
- ❌ Task would execute with placeholder string (wrong behavior)
- ❌ Hard to debug (error occurs later in task execution)
- ❌ Security risk (unclear if secret was provided)

**When to Use**: Fail-fast is almost always better for configuration/variable resolution.

### Architectural Decision: Compile-Time vs Runtime Variables

**The Two Variable Systems**:

Stigmer SDK now has TWO variable systems (by design):

1. **Compile-Time Variables** (`ctx.SetString()`, `ctx.SetInt()`, etc.)
   - Resolved during synthesis (baked into manifest)
   - Use for: API URLs, retry counts, static config
   - Security: ❌ DON'T use for secrets (they'll be in manifest)

2. **Runtime Variables** (`workflow.RuntimeSecret()`, `workflow.RuntimeEnv()`)
   - Resolved during activity execution (JIT)
   - Use for: API keys, passwords, environment-specific values
   - Security: ✅ Safe for secrets (never in manifest/history)

**Rule of Thumb**:

```go
// ✅ CORRECT - Static config (compile-time)
apiURL := ctx.SetString("apiURL", "https://api.example.com")
retries := ctx.SetInt("retries", 3)

// ❌ WRONG - Secrets (compile-time) - WILL LEAK!
apiKey := ctx.SetSecret("apiKey", "sk-12345") // In manifest!

// ✅ CORRECT - Secrets (runtime)
Header("Authorization", workflow.RuntimeSecret("OPENAI_KEY")) // Placeholder only!
```

**Migration Path**:
- Existing `ctx.SetSecret()` still works (backward compatible)
- Gradually migrate to `workflow.RuntimeSecret()` for security
- Use `ctx.SetSecret()` only for non-sensitive compile-time values
- Eventually deprecate `ctx.SetSecret()` in favor of runtime approach

**When to Choose**:
- Can value be in Git? → Compile-time
- Must value be secret? → Runtime
- Changes per environment? → Runtime
- Static across all environments? → Compile-time

---

## 2026-01-20: Expression Generation Bugs and Test Migration After Context API Change

### Context

Fixed critical expression generation bugs in `StringRef.Concat()` and `toExpression()` that were causing empty expressions and incorrect value/expression handling. Also migrated all SDK tests to work with the new Context parameter requirement in `agent.New()` and `workflow.New()`.

### Pattern 1: Context Variables vs Resolved Literals in Concat()

**Problem**: `StringRef.Concat()` was generating empty expressions `"${ $context. }"` when concatenating context variables with literals.

**Root Cause**: The `allKnown` logic treated context variables (which have a `name` field set) as "known" values that could be resolved immediately. This was incorrect because context variables are runtime references, not compile-time constants.

**Solution**: Distinguish between context variables and resolved literals based on the `name` field:

```go
// In stigmer/refs.go - StringRef.Concat()

// OLD (broken):
allKnown := !s.isComputed  // Context variables treated as "known"

// NEW (fixed):
allKnown := !s.isComputed && s.name == ""  // Only resolved literals are "known"

// When processing base StringRef:
if !s.isComputed {
    if s.name != "" {
        // Context variable - NOT known at compile time
        allKnown = false
        expressions = append(expressions, fmt.Sprintf("$context.%s", s.name))
    } else {
        // Resolved literal - known value
        resolvedParts = append(resolvedParts, s.value)
        expressions = append(expressions, fmt.Sprintf(`"%s"`, s.value))
    }
}
```

**The Distinction**:

A `StringRef` can represent two different things:

| Type | Has Name? | Has Value? | Behavior |
|------|-----------|------------|----------|
| **Context Variable** | ✅ Yes | ✅ Yes (initial) | Generate expression `${ $context.name }` |
| **Resolved Literal** | ❌ No | ✅ Yes | Can resolve immediately to value |

**Key Insight**: A StringRef with a `name` set is ALWAYS a runtime reference, even if it has an initial value. The initial value is what gets set in the context at synthesis time, but references to it should use expressions.

**Impact**:
- Before: `apiURL.Concat("/users")` → `"${ $context. }"` (empty name bug)
- After: `apiURL.Concat("/users")` → `${ $context.apiURL + "/users" }` ✅

**When to Use**: Anytime you're implementing operations on typed references (Concat, Upper, Lower, arithmetic), check if the base has a name (context variable) vs no name (resolved literal).

### Pattern 2: Type Check Ordering in Switch Statements

**Problem**: `toExpression()` function was calling `.Value()` instead of `.Expression()` for context variables, returning literal values instead of JQ expressions.

**Root Cause**: When interfaces overlap (`StringRef` implements both `Ref` and `StringValue`), Go's type switch checks in order. Checking `StringValue` before `Ref` caused all StringRefs to match `StringValue` first.

**Solution**: Reorder type checks - check more specific interface first:

```go
// In workflow/ref_helpers.go and agent/ref_helpers.go

// OLD (broken):
func toExpression(value interface{}) string {
    switch v := value.(type) {
    case StringValue:
        return v.Value()  // Matches StringRef first!
    case Ref:
        return v.Expression()  // Never reached for StringRef
    }
}

// NEW (fixed):
func toExpression(value interface{}) string {
    switch v := value.(type) {
    case Ref:
        return v.Expression()  // StringRef matches here first ✅
    case StringValue:
        return v.Value()  // Fallback for other types
    }
}
```

**Why This Works**:
- `Ref` is checked first, catches all typed references (StringRef, IntRef, TaskFieldRef, etc.)
- Context variables get `.Expression()` → `${ $context.name }`
- Computed expressions get `.Expression()` → `${ complex JQ expression }`
- Only non-Ref types fall through to `StringValue` check

**Impact**:
- Before: `workflow.WithURI(apiURL)` → stored `"https://api.example.com"` (literal)
- After: `workflow.WithURI(apiURL)` → stored `${ $context.apiURL }` (expression) ✅

**Go Language Lesson**: In type switches with overlapping interfaces, order determines which case matches. Always check more specific interfaces first, general interfaces last.

**When to Use**: Anytime you have overlapping interfaces in type switches, design the order carefully to match your semantic requirements.

### Pattern 3: Test Migration for Required Parameter Additions

**Problem**: Added `Context` as first required parameter to `agent.New()` and `workflow.New()`, breaking 30+ test files across the SDK.

**Solution**: Multi-phase approach balancing speed and correctness:

**Phase 1: Make Parameter Optional Where Possible**

```go
// In agent/agent.go and workflow/workflow.go

// Register with context (if provided)
if ctx != nil {
    ctx.RegisterAgent(a)
}
```

**Why**: Tests that don't need synthesis can pass `nil`, avoiding mock context overhead.

**Phase 2: Bulk Fix with Automation**

Created Python script to fix common patterns:
```python
# Pattern: agent, err := New(\n  WithName...
# Replace with: agent, err := New(\n  nil, // No context needed for tests\n  WithName...

pattern = r'(\s+)(agent|wf), err := (New|workflow\.New)\('
replacement = r'\1\2, err := \3(\n\1\tnil, // No context needed for tests'
```

**Phase 3: Manual Fix for Edge Cases**

Some tests DO need real contexts:
- Integration tests testing synthesis: Keep `ctx` (not `nil`)
- Mock context tests: Keep `mockCtx` (not `nil`)  
- Backward compatibility tests: Keep real context

**Phase 4: Verify Compilation**

Run tests to catch remaining issues, then fix individually.

**Benefits of Multi-Phase Approach**:
- Fast: Automation handles 90% of mechanical changes
- Correct: Manual review catches edge cases
- Safe: Verify compilation before testing correctness
- Maintainable: Clear pattern for future API changes

**When to Use**: Anytime you add a required parameter to widely-used constructors. Don't manually fix 30+ files - automate the mechanical part, then handle edge cases.

### Pattern 4: Test Context Patterns

**Problem**: Different tests have different context needs - when to use nil, mock, or real context?

**Solution**: Three distinct patterns emerged:

**1. Unit Tests (Builder Logic)**:
```go
// Testing validation, options, builder methods
agent, err := New(
    nil, // No context needed - just testing construction
    WithName("test-agent"),
    WithInstructions("Test instructions"),
)
```

**Use when**: Testing construction logic, validation, option handling (no synthesis)

**2. Integration Tests (Mock Context)**:
```go
type mockWorkflowContext struct {
    workflows []*workflow.Workflow
}

func (m *mockWorkflowContext) RegisterWorkflow(wf *workflow.Workflow) {
    m.workflows = append(m.workflows, wf)
}

wf, err := workflow.New(
    &mockWorkflowContext{},
    workflow.WithName("test"),
)
```

**Use when**: Testing registration behavior without full stigmer.Context overhead

**3. Integration Tests (Real Context)**:
```go
ctx := stigmer.NewContext()
agentName := ctx.SetString("agentName", "code-reviewer")

agent, err := agent.New(
    ctx,  // Real context for synthesis testing
    agent.WithName(agentName),
)
```

**Use when**: Testing synthesis, context variable handling, actual SDK usage patterns

**Rule of Thumb**:
- `nil` → Testing construction/validation (no synthesis needed)
- Mock → Testing registration without synthesis
- Real → Testing full synthesis pipeline

**When to Use**: Design your test context strategy based on what you're actually testing. Don't create unnecessary mocks.

### Gotcha: Interface Ordering in Go Type Switches

**Discovery**: Go type switches check cases in order. When a type implements multiple interfaces, the **first matching case wins**.

**Implication for SDK**:

```go
type StringRef struct {
    baseRef
    value string
}

// StringRef implements BOTH interfaces:
func (s *StringRef) Expression() string { ... }  // Ref interface
func (s *StringRef) Value() string { ... }       // StringValue interface

// In type switch:
switch v := value.(type) {
case StringValue:  // ← StringRef matches HERE (first)
    return v.Value()
case Ref:  // ← Never reached for StringRef!
    return v.Expression()
}
```

**Solution**: Always check the interface you actually want to use first:

```go
switch v := value.(type) {
case Ref:  // ← Check desired interface first
    return v.Expression()
case StringValue:  // ← Fallback
    return v.Value()
}
```

**General Go Rule**: When designing systems with overlapping interfaces, control behavior through type switch ordering. Document the intended priority.

**When to Use**: Any type switch involving interfaces that overlap. Design the order intentionally.

### Testing Insight: Compilation vs Correctness

**Discovery**: When fixing widespread API changes, prioritize compilation over correctness.

**Two-Phase Approach**:

**Phase 1: Fix Compilation**
- Get everything compiling first
- Don't worry about test failures yet
- Bulk fixes are acceptable

**Phase 2: Fix Correctness**  
- Run tests, identify semantic issues
- Fix edge cases and logic errors
- Verify tests actually pass

**Rationale**:
- Can't test if it doesn't compile
- Compilation errors are mechanical (parameter counts, types)
- Test failures reveal semantic issues (value vs expression, nil handling)
- Easier to debug one issue at a time

**Impact**:
- Fixed 30+ test files → Got compilation working
- Then fixed expression logic → Got tests passing
- Two distinct problem spaces, tackled sequentially

**When to Use**: Large-scale API migrations or refactoring. Get it compiling first, then make it correct.

---

---

## 2026-01-22: Code Generation - Map Value Type Extraction

### Context

Extended proto2schema tool to support Agent and Skill resources. Discovered that map value types (like `map<string, EnvironmentValue>`) weren't being automatically extracted from proto files.

### Pattern 1: Extracting Message Types from Map Values

**Problem**: Proto reflection's `collectNestedTypes()` only checked direct message fields, missing types embedded in map value positions.

**Root Cause**: Map fields are synthetic `MapEntry` messages with `key` and `value` fields. The tool only checked `field.GetType() == TYPE_MESSAGE`, which returns true for the MapEntry itself, not the value field inside it.

**Solution**: Special handling for map fields to check the value field's type:

```go
// In tools/codegen/proto2schema/main.go
func collectNestedTypes(msg *desc.MessageDescriptor, fd *desc.FileDescriptor, sharedTypes map[string]*TypeSchema) {
    for _, field := range msg.GetFields() {
        // Handle map fields specially - check the value type
        if field.IsMap() {
            mapEntry := field.GetMessageType()
            if mapEntry != nil {
                // Map entry has two fields: key (index 0) and value (index 1)
                valueField := mapEntry.GetFields()[1]
                if valueField.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
                    msgType := valueField.GetMessageType()
                    if msgType != nil && !strings.HasPrefix(msgType.GetFullyQualifiedName(), "google.protobuf") {
                        typeName := msgType.GetName()
                        if _, exists := sharedTypes[typeName]; !exists {
                            msgFd := msgType.GetFile()
                            sharedTypes[typeName] = parseSharedType(msgType, msgFd)
                            fmt.Printf("    Found shared type (map value): %s\n", typeName)
                            collectNestedTypes(msgType, msgFd, sharedTypes)
                        }
                    }
                }
            }
        } else if field.GetType() == descriptorpb.FieldDescriptorProto_TYPE_MESSAGE {
            // Handle regular message fields
            // ... existing logic
        }
    }
}
```

**Why This Works**:
- Map fields have synthetic MapEntry message type
- MapEntry always has exactly 2 fields: key at index 0, value at index 1
- Value field can be a message type reference
- Recursive extraction continues for value type dependencies

**Impact**:
- Before: `EnvironmentValue` and `McpToolSelection` required manual schema creation
- After: Both automatically extracted with "(map value)" label ✅

**When to Use**: Anytime you're using protoreflect to extract nested types - maps need special handling separate from direct message fields.

### Pattern 2: Tool Generalization via Configuration Flags

**Problem**: Proto2schema and code generator were hardcoded for workflow tasks only (`TaskConfig` suffix, `_task.go` files, `isTaskConfig()` methods).

**Solution**: Replace hardcoded assumptions with configuration flags:

**Proto2Schema Tool**:
```go
// Added flag for flexible message extraction
messageSuffix := flag.String("message-suffix", "TaskConfig", 
    "Suffix of messages to extract (TaskConfig, Spec, etc)")

// Use flag instead of hardcoded "TaskConfig"
if strings.HasSuffix(msg.GetName(), *messageSuffix) {
    // Extract this message
}
```

**Code Generator Tool**:
```go
// Added flag for flexible file naming
fileSuffix := flag.String("file-suffix", "", 
    "Suffix for generated files (e.g., '_task', '_spec', or empty)")

// Use flag in file naming
filename := fmt.Sprintf("%s%s.go", toSnakeCase(baseName), g.fileSuffix)
```

**Benefits**:
- Single tool handles multiple patterns
- No code duplication for different resource types
- Easy to extend to future patterns (Config, Instance, etc.)
- Backwards compatible (defaults work for existing usage)

**Usage**:
```bash
# Workflow tasks (original)
--message-suffix TaskConfig --file-suffix _task

# Agent/Skill specs (new)
--message-suffix Spec --file-suffix ""

# Future patterns
--message-suffix Config --file-suffix _config
```

**When to Use**: When building tools that could apply to multiple patterns - use flags instead of hardcoding assumptions. Makes tools reusable.

### Pattern 3: Conditional Code Generation Based on Type

**Problem**: Generated code had incorrect interface methods (`isTaskConfig()`) for non-task types like AgentSpec and SkillSpec.

**Solution**: Make code generation conditional based on type suffix:

```go
// In tools/codegen/generator/main.go

// Generate isTaskConfig() method only for TaskConfig types
if strings.HasSuffix(config.Name, "TaskConfig") {
    fmt.Fprintf(w, "// isTaskConfig marks %s as a TaskConfig implementation.\n", config.Name)
    fmt.Fprintf(w, "func (c *%s) isTaskConfig() {}\n\n", config.Name)
}
```

**Why This Works**:
- Different resource types have different interface requirements
- TaskConfig types need `isTaskConfig()` marker (type safety)
- AgentSpec/SkillSpec don't implement TaskConfig interface
- Conditional generation keeps code clean

**Result**:
- `SetTaskConfig` → has `isTaskConfig()` method ✅
- `AgentSpec` → no interface method ✅
- `SkillSpec` → no interface method ✅

**When to Use**: Anytime you're generating interface implementations - check if the type actually implements that interface before generating the method.

### Architectural Learning: Proto Reflection Structure

**Key Insight**: Understanding proto reflection's internal representation is critical for correct extraction.

**Proto Reflection Map Representation**:
```
Proto Definition:
  map<string, EnvironmentValue> data = 2;

Internal Representation:
  synthetic MapEntry message {
    string key = 1;
    EnvironmentValue value = 2;
  }
  repeated MapEntry data = 2;  // Field is repeated MapEntry!
```

**How to Navigate**:
```go
field.IsMap()                     // true for map fields
field.GetMessageType()            // Returns MapEntry message
mapEntry.GetFields()[0]           // Key field
mapEntry.GetFields()[1]           // Value field
valueField.GetType()              // Type of value (could be MESSAGE)
valueField.GetMessageType()       // Actual message type (EnvironmentValue)
```

**Why This Matters**:
- Maps look like repeated message fields internally
- Can't treat them the same as direct message fields
- Must navigate through MapEntry structure
- Value extraction is two-level (field → entry → value)

**When to Use**: Any proto reflection work involving maps - understand the synthetic MapEntry representation.

---

## 2026-01-22: Nested Task Serialization in Builder Functions

### Context

Fixed 7 skipped examples that were failing due to improper task serialization in builder functions (`WithLoopBody()`, `TryBlock()`, `CatchBlock()`, `FinallyBlock()`, `ParallelBranches()`). All builders were creating simplified maps with raw struct pointers that `structpb.NewStruct()` couldn't handle.

### Pattern 1: taskToMap() Helper for Nested Task Serialization

**Problem**: Builder functions that accept task builder callbacks (loops, try/catch, fork) were creating task maps with raw struct configs:

```go
// ❌ Wrong - raw struct pointer in map
func WithLoopBody(builder func(item LoopVar) *Task) ForOption {
    return func(c *ForTaskConfig) {
        task := builder(item)
        taskMap := map[string]interface{}{
            "name": task.Name,
            "kind": string(task.Kind),
            "config": task.Config,  // *HttpCallTaskConfig - FAILS!
        }
        c.Do = []map[string]interface{}{taskMap}
    }
}
```

**Error**: `proto: invalid type: *workflow.HttpCallTaskConfig`

**Solution**: Create helper that properly converts Task struct to map:

```go
// In workflow/proto.go
func taskToMap(task *Task) (map[string]interface{}, error) {
    m := map[string]interface{}{
        "name": task.Name,
        "kind": string(task.Kind),
    }
    
    // Convert config properly
    if task.Config != nil {
        configMap, err := taskConfigToMap(task.Config)
        if err != nil {
            return nil, fmt.Errorf("failed to convert task config: %w", err)
        }
        m["config"] = configMap
    }
    
    // Include export and flow control
    if task.ExportAs != "" {
        m["export"] = map[string]interface{}{"as": task.ExportAs}
    }
    if task.ThenTask != "" {
        m["then"] = task.ThenTask
    }
    
    return m, nil
}

// Use in builders
func WithLoopBody(builder func(item LoopVar) *Task) ForOption {
    return func(c *ForTaskConfig) {
        task := builder(item)
        taskMap, err := taskToMap(task)  // ✅ Proper conversion
        if err != nil {
            // Graceful fallback
            taskMap = map[string]interface{}{
                "name": task.Name,
                "kind": string(task.Kind),
            }
        }
        c.Do = []map[string]interface{}{taskMap}
    }
}
```

**Why This Matters**:
- **Correctness**: Task configs properly serialized to maps before protobuf conversion
- **Reusability**: Single helper used by all builders (WithLoopBody, TryBlock, CatchBlock, FinallyBlock, ParallelBranches)
- **Consistency**: All nested tasks follow same conversion pattern
- **Error handling**: Graceful fallback if conversion fails

**Impact**: Fixed Examples 09, 10, 11 - loop bodies, try/catch blocks, and fork branches now work with any task type.

**When to Use**: Any builder function that accepts task callbacks must use `taskToMap()` for proper serialization.

### Pattern 2: Recursive Normalization for Protobuf Compatibility

**Problem**: Request bodies with nested arrays of maps (`[]map[string]any`) failed protobuf conversion:

```go
// ❌ Wrong - typed slice fails
workflow.WithBody(map[string]any{
    "messages": []map[string]any{  // structpb can't handle this!
        {"role": "user", "content": "Hello"},
    },
})
```

**Error**: `proto: invalid type: []map[string]interface{}`

**Root Cause**: `structpb.NewStruct()` requires `[]interface{}` not typed slices like `[]map[string]any` or `[]map[string]interface{}`.

**Solution**: Create recursive normalizer that converts typed slices:

```go
// In workflow/proto.go
func normalizeMapForProto(m map[string]interface{}) map[string]interface{} {
    if m == nil {
        return nil
    }
    result := make(map[string]interface{})
    for k, v := range m {
        result[k] = normalizeValueForProto(v)
    }
    return result
}

func normalizeValueForProto(v interface{}) interface{} {
    // Check for Ref types first (TaskFieldRef, StringRef, etc.)
    if ref, ok := v.(Ref); ok {
        return ref.Expression()  // Convert to string expression
    }
    
    switch val := v.(type) {
    case map[string]interface{}:
        return normalizeMapForProto(val)  // Recurse into nested maps
    case []map[string]interface{}:
        // Convert typed slice to []interface{}
        result := make([]interface{}, len(val))
        for i, item := range val {
            result[i] = normalizeMapForProto(item)
        }
        return result
    case []interface{}:
        // Recursively normalize array elements
        result := make([]interface{}, len(val))
        for i, item := range val {
            result[i] = normalizeValueForProto(item)
        }
        return result
    default:
        return v  // Primitives pass through unchanged
    }
}

// Apply in config converters
func httpCallTaskConfigToMap(c *HttpCallTaskConfig) map[string]interface{} {
    m := make(map[string]interface{})
    // ...
    if c.Body != nil && len(c.Body) > 0 {
        m["body"] = normalizeMapForProto(c.Body)  // ✅ Normalized
    }
    return m
}
```

**Why This Works**:
- **Recursive**: Handles arbitrary nesting depth (arrays in arrays, maps in arrays, etc.)
- **Type-safe**: Interface checks ensure correct conversion
- **Comprehensive**: Handles all problematic types (typed slices, maps, Refs)
- **Performance**: Only normalizes when needed, minimal overhead

**Impact**: Fixed Examples 14, 17, 18 - real-world API payloads now work:
- OpenAI ChatGPT API with nested message arrays ✅
- Slack webhook blocks with deeply nested structures ✅
- Stripe payments with complex metadata ✅

**When to Use**: Any time you're converting complex Go data structures to protobuf Struct - normalize first.

### Pattern 3: Ref Interface Check for TaskFieldRef Conversion

**Problem**: TaskFieldRef structs in body fields weren't being converted to expressions:

```go
// ❌ Wrong - TaskFieldRef struct passed directly
workflow.WithBody(map[string]any{
    "content": githubStatus.Field("conclusion"),  // TaskFieldRef struct - FAILS!
})
```

**Error**: `proto: invalid type: workflow.TaskFieldRef`

**Root Cause**: TaskFieldRef is a struct, but protobuf needs string expressions.

**Solution**: Check if value implements `Ref` interface and convert to expression:

```go
func normalizeValueForProto(v interface{}) interface{} {
    // Check Ref interface FIRST (before type switch)
    if ref, ok := v.(Ref); ok {
        return ref.Expression()  // TaskFieldRef → "${ $context.taskName.field }"
    }
    
    // Then handle other types
    switch val := v.(type) {
    // ...
    }
}
```

**Why Ref Check Comes First**:
- TaskFieldRef implements Ref interface: `Expression() string`
- Type assertion succeeds for all Ref types (TaskFieldRef, StringRef, IntRef, etc.)
- Must check before type switch (type switch doesn't check interfaces first)
- Applies to any Ref type, not just TaskFieldRef

**Impact**:
- TaskFieldRef in body: `task.Field("data")` → `"${ $context.task.data }"` ✅
- StringRef in body: `ctx.SetString("x", "y")` → `"${ $context.x }"` ✅
- IntRef in body: `ctx.SetInt("count", 5)` → `"${ $context.count }"` ✅

**Go Pattern Lesson**: When handling multiple types, check interfaces with type assertion BEFORE type switch. Type switches check concrete types, not interfaces.

**When to Use**: Anytime you need to handle types implementing common interfaces - use interface check before type switch.

### Pattern 4: Go Type System: Interface vs any in Maps

**Problem**: Map literals with `map[string]any` type don't automatically convert to `map[string]interface{}`.

**Discovery**: 
- `any` is an alias for `interface{}` (same underlying type)
- `[]map[string]any` and `[]map[string]interface{}` are DIFFERENT types (not aliases!)
- Type switch can't have both cases (duplicate)

**Solution**: Only handle `[]map[string]interface{}` case (covers `[]map[string]any` at runtime):

```go
// In normalizeValueForProto()
switch val := v.(type) {
case []map[string]interface{}:  // Handles both []map[string]interface{} and []map[string]any
    result := make([]interface{}, len(val))
    for i, item := range val {
        result[i] = normalizeMapForProto(item)
    }
    return result
// case []map[string]any:  // ❌ Would be duplicate - compiler error!
}
```

**Go Type System Insight**:
- `any` = `interface{}` at type level
- `[]any` ≠ `[]interface{}` at type level (slice types are distinct)
- Type switch sees both as `[]map[string]interface{}` due to type identity
- Can't have separate cases for aliases

**When to Use**: When handling slices of maps in type switches, use `[]map[string]interface{}` case only - it covers the `any` alias naturally.

## Future Patterns to Document

- Environment spec implementation (ctx.Env)
- Secret variants for all types (SetSecretInt, SetSecretBool)
- Agent synthesis patterns
- Skill integration patterns
- Multi-language SDK generation (Python, TypeScript)

---

## 2026-01-23: StringRef Value Resolution in Workflow Parameters

### Context

Fixed critical bug where workflow HTTP tasks had empty endpoint URLs causing validation failures. All 8 workflow E2E tests were failing with "field 'endpoint' value is required".

### Pattern: Check for StringValue Interface to Extract Resolved Values

**Problem**: `coerceToString()` helper was calling `Expression()` on all `Ref` types, which returned empty strings for resolved `StringRef` values (from `Concat()`).

**Bad Practice**:
```go
// ❌ Wrong - returns empty string for resolved values
func coerceToString(value interface{}) string {
    switch v := value.(type) {
    case Ref:
        return v.Expression()  // Returns "" when name field is empty!
    // ...
    }
}

// SDK code that failed:
endpoint := apiBase.Concat("/posts/1")  // Resolved to actual URL
fetchTask := wf.HttpGet("fetchData", endpoint, ...)
// But endpoint became "" in proto because Expression() returned ""
```

**Correct Practice**:
```go
// ✅ Correct - check for StringValue interface first
func coerceToString(value interface{}) string {
    switch v := value.(type) {
    case string:
        return v
    case TaskFieldRef:
        return v.Expression()
    case Ref:
        // Check if this Ref has a resolved value (StringValue interface)
        // During synthesis, we should use the actual value instead of expressions
        if stringVal, ok := v.(interface{ Value() string }); ok {
            // Has a Value() method - use the resolved value for synthesis
            return stringVal.Value()
        }
        // Fallback to expression (for runtime-only refs)
        return v.Expression()
    // ...
    }
}
```

**Why This Works**:

The SDK's `StringRef` architecture distinguishes between:
1. **Synthesis-time values** - Known when building workflow (context variables, literals, concatenated strings)
2. **Runtime-only values** - Only available during execution (task outputs, dynamic expressions)

When `Concat()` detects all parts are synthesis-time values, it computes the result immediately and stores it:
- Sets `value` field to the actual concatenated string
- Sets `name` field to empty (not a context variable reference)
- Returns a `StringRef` with the resolved value

This is "SMART RESOLUTION" - it optimizes away unnecessary runtime expression evaluation.

**The Bug**: Calling `Expression()` on a resolved `StringRef` checks `if r.name == ""` and returns `""` instead of the actual value.

**The Fix**: Check if the `Ref` implements `StringValue` interface (has `Value()` method) and use that to extract the actual resolved value.

**Why This Matters**:
- **Correctness**: Workflow HTTP tasks get actual URLs, not empty strings
- **Synthesis**: Properly handles values known at workflow build time
- **Runtime**: Still generates expressions for task output references
- **Performance**: Leverages SMART RESOLUTION optimization

**Prevention**:
1. When working with `Ref` types in conversion code, always check for `Value()` method first
2. Use `Expression()` only as fallback for runtime-only references
3. Understand synthesis-time vs runtime-time value distinction
4. Test with actual workflows that use context variables and `Concat()`

**Cross-Language Note**: 
- **Go approach**: Interface-based detection with type assertion `v.(interface{ Value() string })`
- **Python equivalent**: Would use `hasattr(v, 'value')` or duck typing
- **Conceptual similarity**: Both check if value is resolved vs runtime-only
- **Key insight**: Synthesis requires actual values, not JQ expressions

**Impact**: CRITICAL - Blocked all workflow operations until fixed. All 8 workflow E2E tests now passing.

**Files Changed**:
- `sdk/go/workflow/set_options.go` (coerceToString function)
- Also fixed CLI consistency and error handling issues discovered during testing

**Related Concepts**:
- StringRef architecture (`stigmer/refs.go`)
- Synthesis vs runtime value handling
- Smart resolution in `Concat()` method
- Proto field population during workflow synthesis

---

## 2026-01-23: Proto-Validate Integration for SDK Validation

### Context

Fixed 11 failing workflow validation tests by integrating buf.build/go/protovalidate into the SDK. Discovered that SDK was not validating proto messages against buf.validate rules defined in proto files, even though backend validation was working correctly.

### Pattern 1: Proto-Validate Integration in Go SDK

**Problem**: SDK's `ToProto()` methods were converting to proto but never validating, allowing invalid workflows through until they hit backend validation.

**Discovery**: Validation rules already existed in proto files but weren't being enforced:
- Workflow proto: `spec.document.dsl` pattern, required fields (namespace, name, version)
- Task protos: `agent` required, `endpoint.uri` required, `service`/`method` required, etc.
- Backend already validates using `buf.build/go/protovalidate`

**Solution**: Add proto-validate to SDK following backend pattern:

```go
// In sdk/go/workflow/proto.go

import "buf.build/go/protovalidate"

// Global validator instance
var validator protovalidate.Validator

func init() {
    var err error
    validator, err = protovalidate.New()
    if err != nil {
        panic(fmt.Sprintf("failed to initialize protovalidate: %v", err))
    }
}

func (w *Workflow) ToProto() (*workflowv1.Workflow, error) {
    // ... build workflow proto ...
    
    workflow := &workflowv1.Workflow{
        ApiVersion: "agentic.stigmer.ai/v1",
        Kind:       "Workflow",
        Metadata:   metadata,
        Spec:       spec,
    }
    
    // Validate against buf.validate rules
    if err := validator.Validate(workflow); err != nil {
        return nil, fmt.Errorf("workflow validation failed: %w", err)
    }
    
    return workflow, nil
}
```

**Why This Works**:
- **Reuses proto validation rules**: No custom validation logic needed
- **Consistent with backend**: Same rules, same error messages
- **Fail-fast principle**: Catches errors at SDK construction time
- **Better DX**: Clear error messages at development time

**Impact**:
- Before: Invalid workflows passed SDK, failed at backend
- After: Invalid workflows caught immediately at SDK level with descriptive errors
- All 11 validation tests now passing

**When to Use**: **Every** SDK `ToProto()` method should validate the generated proto before returning it.

### Pattern 2: Validating Untyped Struct Fields (Critical for Task Configs)

**Problem**: Task configs are stored as `google.protobuf.Struct` (untyped), so buf.validate rules on typed proto messages (like `HttpCallTaskConfig`) don't automatically apply during workflow validation.

**Root Cause**: 
```go
// In workflow spec proto
message WorkflowTask {
    string name = 1;
    WorkflowTaskKind kind = 2;
    google.protobuf.Struct task_config = 3;  // ← Untyped!
}
```

Buf.validate rules on `HttpCallTaskConfig.endpoint` don't apply to the Struct field - they only apply when the Struct is unmarshaled to the typed message.

**Solution**: Unmarshal Struct back to typed proto and validate:

```go
// In sdk/go/workflow/proto.go

func validateTaskConfigStruct(kind apiresource.WorkflowTaskKind, config *structpb.Struct) error {
    // Convert Struct to JSON
    jsonBytes, err := config.MarshalJSON()
    if err != nil {
        return fmt.Errorf("failed to marshal Struct to JSON: %w", err)
    }
    
    // Create typed proto based on kind
    var protoMsg proto.Message
    switch kind {
    case apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_HTTP_CALL:
        protoMsg = &tasksv1.HttpCallTaskConfig{}
    case apiresource.WorkflowTaskKind_WORKFLOW_TASK_KIND_AGENT_CALL:
        protoMsg = &tasksv1.AgentCallTaskConfig{}
    // ... all task types ...
    }
    
    // Unmarshal JSON to typed proto
    if err := protojson.Unmarshal(jsonBytes, protoMsg); err != nil {
        return fmt.Errorf("failed to unmarshal JSON to proto: %w", err)
    }
    
    // Validate the typed proto (buf.validate rules apply here!)
    if err := validator.Validate(protoMsg); err != nil {
        return fmt.Errorf("task config validation failed: %w", err)
    }
    
    return nil
}

// Call from convertTask()
func convertTask(task *Task) (*workflowv1.WorkflowTask, error) {
    // ... convert task config to Struct ...
    
    // Validate by unmarshaling to typed proto
    if err := validateTaskConfigStruct(kind, taskConfig); err != nil {
        return nil, err
    }
    
    // ... build proto task ...
}
```

**Why This Approach**:
- **Struct is untyped**: Validation rules don't apply to google.protobuf.Struct
- **Typed protos have rules**: Buf.validate rules are on typed messages (HttpCallTaskConfig, etc.)
- **Round-trip validation**: Struct → JSON → Typed Proto → Validate
- **Matches backend**: Same approach used in backend validation package

**Performance Consideration**: 
- Extra marshaling/unmarshaling adds overhead
- But validation happens once at workflow construction (not runtime)
- Trade-off: Better validation > performance for SDK operations
- Backend does the same (validated approach)

**Impact**:
- Empty URIs: Caught by `endpoint: value is required`
- Empty agent names: Caught by `agent: value is required`
- Empty service/method: Caught by required field validation
- Invalid enum values: Caught by enum validation
- Out-of-range values: Caught by constraint validation (timeout 1-300s)

**When to Use**: When validating proto messages that contain `google.protobuf.Struct` fields with typed schemas - unmarshal to typed proto and validate.

### Pattern 3: Satisfying CEL Validation Constraints

**Problem**: Workflow validation was failing with "Workflow resources can only have platform or organization scope" even though document and task validations were working.

**Root Cause**: Workflow proto has CEL validation on metadata:

```proto
message Workflow {
  ApiResourceMetadata metadata = 3 [
    (buf.validate.field).required = true,
    (buf.validate.field).cel = {
      id: "workflow.owner_scope.platform_or_org_only"
      message: "Workflow resources can only have platform or organization scope"
      expression: "this.owner_scope == 1 || this.owner_scope == 2"
    }
  ];
}
```

SDK was leaving `owner_scope` as default (0 = unspecified), which failed the CEL constraint.

**Solution**: Set default owner_scope when building metadata:

```go
metadata := &apiresource.ApiResourceMetadata{
    Name:        w.Document.Name,
    Slug:        w.Slug,
    Annotations: SDKAnnotations(),
    // Default to organization scope for SDK-created workflows
    // Satisfies CEL validation: owner_scope must be platform (1) or organization (2)
    OwnerScope: apiresource.ApiResourceOwnerScope_organization,
}
```

**Why This Works**:
- **Sensible default**: SDK workflows are typically organization-scoped
- **Satisfies constraint**: Value 2 passes CEL expression check
- **Can be overridden**: Backend middleware can change scope if needed
- **Prevents validation errors**: SDK workflows are always valid

**CEL Validation Insight**:
- CEL (Common Expression Language) enables custom validation logic in proto files
- More powerful than simple required/min/max constraints
- Can check relationships between fields, conditional requirements, complex business rules
- SDK must satisfy these constraints, not just field-level validations

**When to Use**: When proto files have CEL validation constraints, ensure SDK sets fields to satisfy those constraints. Default to values that make sense for SDK usage patterns.

### Pattern 4: Import Organization for Proto-Validate Integration

**Problem**: Adding proto-validate and proto conversion imports needs proper organization.

**Solution**: Import organization follows Go conventions with grouping:

```go
import (
    "fmt"
    
    // Proto-validate and encoding
    "buf.build/go/protovalidate"
    "google.golang.org/protobuf/encoding/protojson"
    "google.golang.org/protobuf/proto"
    "google.golang.org/protobuf/types/known/structpb"
    
    // Generated stubs
    workflowv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1"
    tasksv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/workflow/v1/tasks"
    environmentv1 "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/agentic/environment/v1"
    "github.com/stigmer/stigmer/apis/stubs/go/ai/stigmer/commons/apiresource"
    
    // Internal SDK packages
    "github.com/stigmer/stigmer/sdk/go/environment"
)
```

**Import Groups**:
1. Standard library (fmt, context, etc.)
2. Proto-related (protovalidate, protojson, structpb)
3. Generated stubs (workflowv1, tasksv1, etc.)
4. Internal SDK packages

**When to Use**: Maintain this import organization when adding proto-validate to other SDK packages (agent, skill, etc.).

### Testing Impact: Stricter Validation Reveals Pre-Existing Issues

**Discovery**: Adding validation exposed legitimate bugs in other tests:

**Examples of issues caught**:
```
- HTTP tasks without timeouts → validation error: timeout_seconds required (1-300)
- Wait tasks using wrong field name → "duration" vs "seconds" in proto
- Empty maps where required → validation error: variables required
- Agent calls missing message → validation error: message required
```

**This is GOOD**:
- ✅ Validation is working correctly
- ✅ Tests were written with invalid data
- ✅ Now we know the issues exist
- ✅ Can fix tests to use valid data

**Philosophy**: Stricter validation revealing bugs is a feature, not a problem. Fix the issues, don't weaken validation.

**When to Use**: When adding validation catches existing issues, fix the issues rather than skipping validation.

### Validation Error Messages Quality

**Observation**: Proto-validate generates excellent error messages:

```
workflow validation failed: validation error: spec.document.dsl: value does not match regex pattern `^1\.0\.0$`
workflow validation failed: validation error: spec.document.namespace: value is required
failed to convert task httpTask: task config validation failed: validation error: endpoint: value is required
failed to convert task agentTask: task config validation failed: validation error: agent: value is required
```

**Why These Are Good**:
- Field path clearly identified (`spec.document.dsl`, `endpoint`)
- Constraint explained ("value does not match regex", "value is required")
- Task name included in error context
- No need for custom error message formatting

**When to Use**: Let proto-validate generate error messages - they're already well-formatted and informative.

### Go Package Dependencies: Direct vs Indirect

**Discovery**: Proto stubs depend on protovalidate proto definitions, but SDK needs protovalidate runtime:

**Before**:
```go
// In sdk/go/go.mod
require (
    // ... other deps ...
)

require (
    buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go v1.36.11... // indirect
    // This is only the proto DEFINITIONS (code generated from .proto files)
)
```

**After**:
```go
require (
    buf.build/go/protovalidate v1.1.0  // Direct - validation RUNTIME library
    // ... other deps ...
)

require (
    buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go v1.36.11... // indirect
    // ... other indirect deps ...
)
```

**The Distinction**:
- `buf.build/gen/go/bufbuild/protovalidate/protocolbuffers/go`: Proto DEFINITIONS (generated from .proto)
- `buf.build/go/protovalidate`: Validation RUNTIME (actual validation engine with CEL evaluator)

**Why This Matters**:
- Proto stubs include validation annotations (indirect dependency via stubs)
- To actually VALIDATE, need the runtime library (direct dependency)
- Both packages work together: definitions + runtime = validation

**When to Use**: When adding proto-validate to any Go module, add `buf.build/go/protovalidate` as direct dependency (not just the proto definitions).

### Architectural Decision: Validation in SDK vs Backend

**Design Choice**: Validate in BOTH SDK and backend (defense in depth).

**Rationale**:
1. **SDK validation** (client-side):
   - Fail-fast: Catch errors at construction time
   - Better DX: Clear errors during development
   - Prevents invalid API calls
   
2. **Backend validation** (server-side):
   - Security: Never trust client input
   - Catch manipulation attempts
   - Validate external/third-party workflows

**Not Duplication**: Different validation responsibilities:
- SDK: Help developers catch mistakes early
- Backend: Enforce security and correctness

**Trade-off Accepted**: Small performance cost for validation in SDK, but:
- Happens once at workflow construction (not runtime)
- Prevents wasted API calls with invalid workflows
- Better than debugging backend errors

**When to Use**: Always validate at SDK level AND backend level for defense in depth.

### Cross-Reference: Backend Validation Implementation

**Backend Location**: `backend/services/workflow-runner/pkg/validation/validate.go`

**Backend Approach** (same as SDK now):
```go
// Backend validator
var validator protovalidate.Validator

func ValidateTaskConfig(msg proto.Message) error {
    return validator.Validate(msg)
}

// Unmarshal and validate
func UnmarshalTaskConfig(kind WorkflowTaskKind, config *structpb.Struct) (proto.Message, error) {
    // Convert Struct to typed proto
    jsonBytes, _ := config.MarshalJSON()
    var protoMsg proto.Message
    // ... switch on kind to create appropriate type ...
    protojson.Unmarshal(jsonBytes, protoMsg)
    
    // Validate typed proto
    return protoMsg, ValidateTaskConfig(protoMsg)
}
```

**Consistency Achieved**: SDK now follows the exact same validation pattern as backend.

---

*This log grows with each feature implementation. Add entries as you discover new patterns!*
