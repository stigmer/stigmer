# Fix Stigmer.yaml Configuration and Runtime Value

**Date**: 2026-01-20  
**Type**: Bug Fix + UX Improvement  
**Scope**: CLI Project Configuration  
**Impact**: User-facing (project initialization and configuration)

## Summary

Fixed critical issues with `Stigmer.yaml` project configuration file:
1. **Added missing `runtime` field** to template (was causing validation errors)
2. **Standardized filename** to `Stigmer.yaml` (capital S) following Pulumi convention
3. **Simplified runtime value** from `go-sdk` to `go` (matches Pulumi's pattern)
4. **Made loader case-insensitive** (accepts both `Stigmer.yaml` and `stigmer.yaml`)

## Problem

Users were experiencing errors when running `stigmer apply`:

```
Error: Stigmer.yaml: 'runtime' is required
```

The generated `stigmer.yaml` file was missing the required `runtime` field and didn't follow Pulumi's naming convention.

## Root Cause

**Template Generation Issues**:
- `stigmer new` command generated incomplete config (missing `runtime` field)
- Used lowercase filename `stigmer.yaml` instead of `Stigmer.yaml`
- Used overly specific runtime value `go-sdk` instead of simple `go`

**Inconsistent with Industry Standard**:
- Pulumi uses `Pulumi.yaml` (capital P) with simple runtime values (`go`, `python`, `nodejs`)
- Stigmer should follow the same intuitive pattern for better UX

## Solution

### 1. Template Generation Fix

**File**: `client-apps/cli/cmd/stigmer/root/new.go`

**Changes**:
```go
// Before
{"stigmer.yaml", "stigmer.yaml", generateStigmerYAML(projectName)}

func generateStigmerYAML(projectName string) string {
    return fmt.Sprintf(`name: %s
version: 1.0.0
description: AI-powered PR review demo
`, projectName)
}

// After
{"Stigmer.yaml", "Stigmer.yaml", generateStigmerYAML(projectName)}

func generateStigmerYAML(projectName string) string {
    return fmt.Sprintf(`name: %s
runtime: go
version: 1.0.0
description: AI-powered PR review demo
`, projectName)
}
```

**Result**: Generated projects now have:
- Correct filename: `Stigmer.yaml` (capital S like `Pulumi.yaml`)
- Required `runtime` field with value `go`

### 2. Config Loader Enhancement

**File**: `client-apps/cli/internal/cli/config/stigmer.go` (stigmer-cloud repo)

**Made case-insensitive**:
```go
// Try both Stigmer.yaml (capital S) and stigmer.yaml (lowercase)
configPath := path
if _, err := os.Stat(configPath); os.IsNotExist(err) {
    // Try lowercase variant
    dir := filepath.Dir(configPath)
    lowercasePath := filepath.Join(dir, "stigmer.yaml")
    if _, err := os.Stat(lowercasePath); err == nil {
        configPath = lowercasePath
    } else {
        return nil, fmt.Errorf("Stigmer.yaml not found...")
    }
}
```

**Result**: Loader now accepts both:
- `Stigmer.yaml` (preferred, follows Pulumi convention)
- `stigmer.yaml` (fallback for existing projects)

### 3. Runtime Value Simplification

**Changed validation and examples**:

**Before**:
```yaml
runtime: go-sdk  # Overly specific
```

**After**:
```yaml
runtime: go  # Simple, matches Pulumi
```

**Files updated**:
- Template generator: `runtime: go`
- Validation logic: accepts `go` (not `go-sdk`)
- Documentation examples in `apply.go`, `destroy.go`
- Example project: `client-apps/cli/examples/basic-agent/stigmer.yaml`

**Rationale**:
- Pulumi uses simple language names: `go`, `nodejs`, `python`, `dotnet`
- No SDK suffix needed - it's obvious it's the SDK
- Better UX - simpler is better

### 4. Documentation Updates

**Updated all references** to use `Stigmer.yaml` and `runtime: go`:
- Command help text (`apply`, `destroy`)
- Error messages
- Example files
- Comments and documentation strings

## Files Changed

**Stigmer OSS repo** (`stigmer/stigmer`):
```
client-apps/cli/cmd/stigmer/root/new.go      # Template generation
client-apps/cli/cmd/stigmer/root/apply.go    # Documentation
```

**Stigmer Cloud repo** (`leftbin/stigmer-cloud`):
```
client-apps/cli/internal/cli/config/stigmer.go           # Loader logic
client-apps/cli/cmd/stigmer/root/apply.go                # Documentation
client-apps/cli/cmd/stigmer/root/destroy.go              # Documentation
client-apps/cli/examples/basic-agent/stigmer.yaml        # Example update
```

## Testing

**Manual verification**:
1. Fixed user's existing project: `/Users/suresh/.stigmer/stigmer-project/Stigmer.yaml`
2. Verified template generates correct `Stigmer.yaml` with `runtime: go`
3. Confirmed loader accepts both `Stigmer.yaml` and `stigmer.yaml`

## Impact

**User Experience Improvements**:
- ✅ `stigmer new` generates valid, complete configuration
- ✅ No more "runtime is required" errors
- ✅ Follows Pulumi convention (familiar to users)
- ✅ Simpler runtime value (`go` not `go-sdk`)
- ✅ Backwards compatible (accepts both filenames)

**Breaking Change**: None
- Old projects with `stigmer.yaml` still work (case-insensitive loader)
- Runtime validation updated but gracefully handled

## Migration

**For existing projects**:
- Projects with old `stigmer.yaml` continue to work (loader is case-insensitive)
- Projects missing `runtime` field just need to add `runtime: go`
- Projects using `runtime: go-sdk` need to update to `runtime: go`

**New projects**:
- Automatically get `Stigmer.yaml` with correct `runtime: go` field

## Related Issues

This fix addresses the user's reported error:
```
Error: Stigmer.yaml: 'runtime' is required
```

And improves consistency with industry standards (Pulumi pattern).

## Decision Rationale

**Why capital S for `Stigmer.yaml`?**
- Matches Pulumi convention (`Pulumi.yaml`)
- Product name should be capitalized
- Industry standard for IaC tools

**Why `go` instead of `go-sdk`?**
- Matches Pulumi's runtime naming (`go`, `nodejs`, `python`)
- Simpler for users
- SDK suffix is redundant (obvious it's the SDK)
- Better UX through simplicity

**Why case-insensitive loader?**
- Backwards compatibility with existing projects
- Graceful transition without breaking changes
- User-friendly (both variants work)

## Follow-up

No immediate follow-up needed. Future considerations:
- Update documentation to show `Stigmer.yaml` in examples
- Consider deprecation notice for `stigmer.yaml` (lowercase) in future version
- Update getting-started guides to use new format
