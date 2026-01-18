# Changelog: Fix .Concat() Synthesis-Time Resolution

**Date**: January 17, 2026  
**Type**: Bug Fix  
**Scope**: Go SDK - Workflow Context Variables  
**Impact**: Critical - Fixes over-engineered compile-time resolution approach

---

## Summary

Fixed `.Concat()` and other Ref methods to resolve values **at synthesis time** when all parts are known, rather than always generating runtime JQ expressions. This makes the SDK behavior match user expectations and aligns with the original Gemini conversation design: simple synthesis, smart SDK.

Also corrected test that was validating the wrong pattern.

---

## The Problem

When users wrote code like this:

```go
apiBase := ctx.SetString("apiBase", "https://jsonplaceholder.typicode.com")
endpoint := apiBase.Concat("/posts/1")
wf.HttpGet("fetch", endpoint, ...)
```

The SDK was generating a **runtime JQ expression**:

```yaml
uri: ${ $context.apiBase + "/posts/1" }  # Runtime resolution
```

But both values were **known at synthesis time**! The SDK should have resolved this immediately:

```yaml
uri: "https://jsonplaceholder.typicode.com/posts/1"  # Resolved!
```

---

## Root Cause

**Two bugs working together:**

### Bug 1: `.Concat()` Always Created Runtime Expressions

**Location**: `go/stigmer/refs.go:96-136`

The `.Concat()` method **always** returned `isComputed = true`, even when all parts were known values:

```go
// BEFORE (wrong)
func (s *StringRef) Concat(parts ...interface{}) *StringRef {
    // ... build expression ...
    return &StringRef{
        baseRef: baseRef{
            isComputed:   true,  // ❌ Always runtime!
            rawExpression: result,
        },
        value: "", // ❌ Loses the actual value!
    }
}
```

### Bug 2: `toExpression()` Always Called `.Expression()`

**Location**: `go/workflow/ref_helpers.go:53-75`

The `toExpression()` helper didn't check if a Ref had a known value before calling `.Expression()`:

```go
// BEFORE (wrong)
case Ref:
    return v.Expression()  // ❌ Always generates JQ expression
```

This meant even when `.Concat()` produced a known value, it would still become a runtime expression.

---

## The Fix

### Fix 1: Made `.Concat()` Smart (`refs.go`)

Check if all parts are known values. If yes, compute immediately:

```go
// AFTER (correct)
func (s *StringRef) Concat(parts ...interface{}) *StringRef {
    allKnown := !s.isComputed
    var resolvedParts []string
    var expressions []string
    
    // Track which path we can take
    for _, part := range parts {
        switch v := part.(type) {
        case string:
            resolvedParts = append(resolvedParts, v)
            // ... also build expression in case we need it
        case *StringRef:
            if !v.isComputed {
                resolvedParts = append(resolvedParts, v.value)
            } else {
                allKnown = false
            }
        }
    }
    
    // SMART DECISION
    if allKnown {
        // All known - resolve NOW!
        return &StringRef{
            value: strings.Join(resolvedParts, ""),
            isComputed: false,  // ✅ Known value
        }
    }
    
    // Some runtime values - create expression
    return &StringRef{
        isComputed: true,
        rawExpression: ...,
    }
}
```

### Fix 2: Made `toExpression()` Check for Known Values First (`ref_helpers.go`)

Check if it's a known value (StringValue, IntValue, BoolValue) before falling back to `.Expression()`:

```go
// AFTER (correct)
func toExpression(value interface{}) string {
    switch v := value.(type) {
    // ... primitives ...
    
    // SMART RESOLUTION: Check for known values FIRST
    case StringValue:
        return v.Value()  // ✅ Return actual value!
    case IntValue:
        return fmt.Sprintf("%d", v.Value())
    case BoolValue:
        return fmt.Sprintf("%t", v.Value())
    
    // Only for runtime expressions now
    case Ref:
        return v.Expression()
    }
}
```

---

## Examples

### Example 1: Simple Concatenation (Fixed)

**User code:**
```go
apiBase := ctx.SetString("apiBase", "https://api.example.com")
endpoint := apiBase.Concat("/users")
wf.HttpGet("fetch", endpoint, ...)
```

**Before (wrong):**
```yaml
uri: ${ $context.apiBase + "/users" }  # Runtime JQ expression
```

**After (correct):**
```yaml
uri: "https://api.example.com/users"  # Fully resolved!
```

### Example 2: Task Output Reference (Still Runtime - Correct)

**User code:**
```go
fetchTask := wf.HttpGet("fetch", "https://api.example.com/users")
title := fetchTask.Field("title")  # Runtime value from task output
wf.SetVars("process", "postTitle", title)
```

**Generated (correct - runtime):**
```yaml
variables:
  postTitle: ${ $context.fetch.title }  # Correct - runtime value
```

---

## Test Fixes

### Fixed Test: `TestExample07_BasicWorkflow`

**Updated assertions to verify actual resolution:**

```go
// BEFORE (weak assertion)
if uriValue == "" {
    t.Error("URI expression should not be empty")
}

// AFTER (proper assertion)
expectedURI := "https://jsonplaceholder.typicode.com/posts/1"
if uriValue != expectedURI {
    t.Errorf("URI = %v, want %v (compile-time resolution should resolve .Concat())", 
        uriValue, expectedURI)
}
```

### Fixed Test: `TestCompileTimeVariableResolution`

**Removed confusing string placeholder pattern:**

```go
// BEFORE (wrong pattern)
wf.HttpGet("fetchAPI",
    "${baseURL}/${version}/users",  // ❌ Confusing string placeholders
    workflow.Timeout("${timeout}"),  // ❌ Passing string to int parameter
)

// AFTER (correct SDK pattern)
endpoint := baseURL.Concat("/v1/users")  // ✅ Uses SDK methods
wf.HttpGet("fetchAPI",
    endpoint,  // ✅ Resolves immediately
    workflow.Timeout(timeout),  // ✅ Pass IntRef directly
)
```

---

## Impact Assessment

### For SDK Users

✅ **No code changes required** - Existing code works better automatically  
✅ **Simpler generated manifests** - Fewer runtime expressions  
✅ **Faster workflow execution** - Values resolved once at synthesis  
✅ **Easier debugging** - See actual values in manifests

### For Workflow Runner

✅ **Less JQ evaluation** - Fewer runtime expressions to process  
✅ **More deterministic manifests** - Static values are explicit

---

## Files Changed

### Modified (Core Fix)
- `go/stigmer/refs.go` - Smart `.Concat()` implementation (~80 lines modified)
- `go/workflow/ref_helpers.go` - Smart `toExpression()` (~30 lines modified)

### Modified (Tests)
- `go/examples/examples_test.go` - Fixed incorrect test patterns and assertions

---

## Testing

**All tests passing:**
- ✅ `TestExample07_BasicWorkflow` - Validates `.Concat()` resolves immediately
- ✅ `TestCompileTimeVariableResolution` - Validates proper SDK patterns
- ✅ All 9 active example tests passing
- ✅ Manual testing with stigmer-project confirms URL resolution

**Test output:**
```
URI value: https://jsonplaceholder.typicode.com/posts/1
✅ Compile-time variable resolution verified:
   - NO __stigmer_init_context task generated
   - .Concat() on known values resolved immediately
   - URL fully resolved: https://jsonplaceholder.typicode.com/posts/1
```

---

## The Over-Engineering We Avoided

The earlier implementation had a complex "compile-time variable interpolator" with regex-based `${variableName}` placeholder replacement. This was unnecessary complexity:

❌ **What we DON'T need:**
- String placeholders like `"${baseURL}/users"`
- Two-pass interpolation with regex
- Type-preservation logic for placeholders
- Distinction between `${var}` and `.Concat()`

✅ **What we DO need:**
- `.Concat()` on Refs
- `.Field()` on Tasks
- Smart resolution at synthesis time when possible

**The fix is much simpler** - just check "are all parts known?" before deciding to resolve or defer.

---

## Alignment with Original Design

This fix aligns with the Gemini conversation philosophy:

> **"The point is simple... While we are at the point of generating this manifest, we know what is the value of API base that won't be changing. We know what is the value of endpoint that won't be changing. So just create that and generate the manifest."**

**Key insight:** Resolve everything you can at synthesis time. Don't wait for runtime if the values are already known.

---

## Migration

✅ **No migration required!**

Existing user code works unchanged and produces better output automatically:
- Variables resolved immediately when possible
- Runtime expressions only for actual runtime values (task outputs)

---

## Learnings

### What Went Wrong

1. **Over-engineering** - Created complex interpolation system when simple "check if known" was enough
2. **Wrong test patterns** - Tests validated incorrect behavior instead of user expectations  
3. **Lost sight of goal** - Focused on implementation details instead of user experience

### What We Fixed

1. **Simple synthesis** - SDK now automatically resolves what it can
2. **User expectations** - `.Concat()` on known values = resolved value (obvious!)
3. **Clean patterns** - SDK methods only, no string placeholders needed

### Key Principle

**If you know the value at synthesis time, use it. Don't defer to runtime.**

This is how IaC tools (Pulumi, Terraform) work. This is how the SDK should work.

---

**Status**: ✅ Complete and ready for production

**Next Steps**: None required - fix is complete and tested
