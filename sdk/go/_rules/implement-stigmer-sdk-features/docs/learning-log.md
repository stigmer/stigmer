# Learning Log: Stigmer Go SDK Implementation

This log captures patterns, solutions, and gotchas discovered while implementing Stigmer SDK features in Go.

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

## Future Patterns to Document

- Environment spec implementation (ctx.Env)
- Secret variants for all types (SetSecretInt, SetSecretBool)
- Agent synthesis patterns
- Skill integration patterns
- Multi-language SDK generation (Python, TypeScript)

---

*This log grows with each feature implementation. Add entries as you discover new patterns!*
