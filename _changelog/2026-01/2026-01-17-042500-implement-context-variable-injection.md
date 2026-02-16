# SDK Feature: Automatic Context Variable Injection (Pulumi-Style)

**Date**: 2026-01-17  
**Type**: Feature Implementation  
**Component**: stigmer-sdk/go  
**Impact**: High - Enables automatic workflow variable initialization

---

## What Was Built

Implemented **Pulumi-style automatic context variable injection** for the Stigmer SDK, allowing developers to define typed context variables that are automatically injected into generated workflows as initialization tasks.

### Core Features

**1. Type-Safe Variable API**
```go
// Define context variables with type safety
apiURL := ctx.SetString("apiURL", "https://api.example.com")
retries := ctx.SetInt("retries", 3)
isProd := ctx.SetBool("isProd", false)
config := ctx.SetObject("config", map[string]interface{}{...})
```

**2. Automatic SET Task Injection**
- SDK synthesizes workflow with `__stigmer_init_context` as first task
- All context variables initialized before user tasks run
- Variables accessible via `${ $context.variableName }` expressions

**3. Full Type Support**
- ✅ Strings (`SetString`)
- ✅ Integers (`SetInt`)
- ✅ Booleans (`SetBool`)
- ✅ Objects (`SetObject` - nested maps)
- ✅ Secrets (`SetSecret` - string secrets)

**4. Seamless Developer Experience**
- Variables "just work" in workflow expressions
- No manual plumbing required
- Follows Pulumi's automatic injection pattern
- Clean separation: internal variables (SET task) vs external config (future env_spec)

---

## Implementation Details

### Files Modified

**Core SDK (`stigmer-sdk/go/stigmer/`)**:
- `refs.go` - Added `ToValue() interface{}` to Ref interface and all implementations
- `context.go` - Updated `synthesizeWorkflows()` to pass context variables

**Synthesis Layer (`stigmer-sdk/go/internal/synth/`)**:
- `workflow_converter.go` - Added context init task generation:
  - `ToWorkflowManifestWithContext()` - Accepts context variables
  - `createContextInitTask()` - Generates SET task with all variables
  - `workflowSpecToProtoWithContext()` - Injects task as first task

**Tests**:
- `stigmer/refs_test.go` - ToValue() tests for all types
- `internal/synth/mapping_test.go` - Context init task generation tests
- `examples/examples_test.go` - Integration test for example

**Examples**:
- `examples/context-variables/main.go` - Full demonstration
- `examples/context-variables/verify.go` - Verification tool

---

## Technical Approach

### 1. Interface Design (Pulumi-Inspired)

Added `ToValue()` method to `Ref` interface for serialization:

```go
type Ref interface {
    Expression() string
    Name() string
    IsSecret() bool
    ToValue() interface{}  // ← New: Returns value for synthesis
}
```

Each typed Ref implements it:
```go
func (s *StringRef) ToValue() interface{} { return s.value }
func (i *IntRef) ToValue() interface{} { return i.value }
func (b *BoolRef) ToValue() interface{} { return b.value }
func (o *ObjectRef) ToValue() interface{} { return o.value }
```

### 2. Synthesis Flow

**Before** (variables not available at runtime):
```yaml
tasks:
  - name: fetch_users
    kind: HTTP_CALL
    uri: "${ $context.apiURL }/users"  # ❌ apiURL undefined!
```

**After** (automatic injection):
```yaml
tasks:
  - name: __stigmer_init_context  # ← AUTO-INJECTED!
    kind: SET
    task_config:
      variables:
        apiURL: "https://api.example.com"
        retries: 3
        isProd: false
  - name: fetch_users
    kind: HTTP_CALL
    uri: "${ $context.apiURL }/users"  # ✅ Works!
```

### 3. Type Serialization

Variables correctly serialize to JSON-compatible proto types:
- Strings → `string_value`
- Integers → `number_value`
- Booleans → `bool_value`
- Objects → `struct_value` (nested)

---

## Verification

Created comprehensive example (`examples/context-variables/`) demonstrating:
- All variable types (string, int, bool, object)
- Variable usage in expressions (concatenation, field access)
- Automatic SET task injection
- Proper JSON serialization

**Test Output**:
```
✅ Context init task successfully injected with correct types!

Task 1: __stigmer_init_context (kind: WORKFLOW_TASK_KIND_SET)
   Variables:
      - apiURL: string_value:"https://api.example.com"
      - retries: number_value:3
      - isProd: bool_value:false
      - config: struct_value:{database: {host: "localhost", port: 5432}, ...}
```

---

## Architectural Decisions

### Internal Variables vs. External Configuration

**Clarified distinction** (following Gemini discussion):

| Feature | ctx.SetX (This Feature) | ctx.Env (Future) |
|---------|------------------------|------------------|
| **Purpose** | Workflow logic, constants | Secrets, runtime config |
| **Location** | SET task in workflow YAML | env_spec requirements |
| **When Set** | At synthesis time (hardcoded) | At execution time (injected) |
| **Storage** | Workflow definition | ExecutionContext (encrypted) |
| **Equivalent** | N/A (Pulumi has no direct equivalent) | Pulumi's config.Get() |

**This implementation handles internal variables** - part of workflow logic, baked into definition.  
**Future env_spec feature** will handle external config - runtime injection via ExecutionContext.

### Why NOT Use ExecutionContext for This?

Initial confusion clarified:
- ❌ ExecutionContext is for **external runtime secrets/config**
- ✅ SET task is correct for **internal workflow constants**
- These are separate use cases with different architectural homes

---

## Key Learnings

### 1. Pulumi-Style Automatic Injection Pattern

Pulumi users expect variables to "just work" without manual wiring. Achieved via:
- Variables defined in code → automatically injected at synthesis
- No manual plumbing required
- Clean developer experience

### 2. Interface-Based Value Extraction

`ToValue() interface{}` provides:
- Clean serialization abstraction
- Type-safe at SDK level
- JSON-compatible at synthesis
- Extensible for future Ref types

### 3. Type Serialization to Protobuf

Proper mapping for all types:
```go
// String
StringRef.ToValue() → string → string_value

// Integer
IntRef.ToValue() → int → number_value (JSON numbers are float64)

// Boolean
BoolRef.ToValue() → bool → bool_value

// Object
ObjectRef.ToValue() → map[string]interface{} → struct_value
```

### 4. Synthesis Layer Patterns

Learned clean pattern for automatic task injection:
```go
// 1. ToWorkflowManifestWithContext(contextVars, workflows...)
// 2. For each workflow:
//      if contextVars exist:
//        - Create context init task
//        - Inject as first task
//      - Add user tasks
```

### 5. Testing Complex Protobuf Output

Verification approach:
- Generate manifest to file
- Read and parse with proto.Unmarshal
- Inspect structure programmatically
- Verify all variable types correctly serialized

---

## Developer Experience

### Before This Feature

```go
workflow.New(ctx,
    workflow.WithTasks(
        // Manual initialization required!
        workflow.SetTask("init_vars",
            workflow.SetVar("apiURL", "https://..."),
            workflow.SetVar("retries", "3"),  // String conversion needed
        ),
        workflow.HttpCallTask("fetch",
            workflow.WithURI("${ $context.apiURL }/users"),
        ),
    ),
)
```

### After This Feature

```go
// Define once - automatically available!
apiURL := ctx.SetString("apiURL", "https://api.example.com")
retries := ctx.SetInt("retries", 3)

workflow.New(ctx,
    workflow.WithTasks(
        // No manual init needed - just use it!
        workflow.HttpCallTask("fetch",
            workflow.WithURI(apiURL.Concat("/users").Expression()),
        ),
    ),
)
// SDK handles the rest!
```

---

## Impact

### User-Facing

**Before**: Developers had to manually initialize workflow variables  
**After**: Variables automatically available - just define and use

**Benefit**: Cleaner code, less boilerplate, Pulumi-style DX

### Technical

**Before**: No way to define workflow constants in SDK  
**After**: Full support for typed variables with automatic injection

**Benefit**: SDK completeness, matches user expectations from Pulumi

---

## Next Steps (Future)

### 1. External Configuration (env_spec)

Implement `ctx.Env()` for external runtime configuration:
```go
ctx.Env("STRIPE_API_KEY", Secret=true, Description="Stripe API key")
```

This would:
- Generate `env_spec` in workflow (requirements only)
- Values provided at execution time
- Stored in ExecutionContext (encrypted)
- Separate from internal variables (this feature)

### 2. Secret Variants (Optional)

Could add secret variants for all types (matching Pulumi):
```go
ctx.SetSecretInt(name string, value int) *IntRef
ctx.SetSecretBool(name string, value bool) *BoolRef
ctx.SetSecretObject(name string, value map[string]interface{}) *ObjectRef
```

**Decision**: Postponed - `SetSecret()` for strings covers 90% of use cases

---

## Files Changed

```
stigmer-sdk/go/
├── stigmer/
│   ├── refs.go                      # ToValue() interface + implementations
│   ├── context.go                   # Pass context vars to synthesis
│   ├── refs_test.go                 # ToValue() tests
│   └── context_test.go              # (no changes)
├── internal/synth/
│   ├── workflow_converter.go        # Context init task generation
│   └── mapping_test.go              # Context injection tests
└── examples/
    ├── context-variables/
    │   ├── main.go                  # Full demonstration
    │   └── verify.go                # Verification tool
    └── examples_test.go             # Integration test
```

---

## Summary

**Shipped**: Pulumi-style automatic context variable injection for Stigmer SDK

**Impact**: Developers can now define typed workflow variables that are automatically initialized - no manual plumbing required!

**Quality**: Fully tested, documented with example, ready for production use

**Next**: Consider env_spec implementation for external configuration (separate use case)

---

**Project**: 20260117.01.sdk-context-variable-injection  
**Status**: ✅ Complete
