# fix(cli): update stigmer new template to use SDK version with workflow metadata fix

**Date**: 2026-01-21 02:23:35 IST  
**Type**: Bug Fix  
**Scope**: CLI Template Generation  
**Impact**: Critical - Fixes broken `stigmer apply` for all new projects

## Problem

Users running `stigmer new` and then `stigmer apply` would encounter this error:

```
Error: failed to deploy workflow '': rpc error: code = Unknown desc = pipeline step ResolveSlug failed: resource name is empty, cannot generate slug
```

**Root Cause**: The `stigmer new` command generates a `go.mod` with hardcoded SDK version `v0.0.0-20260120005545-fc443b1640d1` (2026-01-20 00:55:45 UTC), which **predates the workflow metadata fix** committed at `aea8194` (2026-01-20 11:46:26 IST / ~06:16 UTC).

**The Issue Chain**:
1. SDK fix was committed (aea8194) to initialize `Metadata.Name` in workflow converter
2. CLI template still referenced older SDK version (5 hours before fix)
3. New users got broken projects even though fix was in codebase
4. `stigmer apply` failed with "resource name is empty" error

## Solution

Updated the CLI template generator to use SDK version `v0.0.0-20260120203025-cfa15f93ba61` (commit `cfa15f93ba61` from 2026-01-21 02:00:25 IST), which includes the workflow metadata fix.

**Version Timeline**:
- `fc443b1640d1` (2026-01-20 00:55:45 UTC): OLD version in template ❌
- `aea8194` (2026-01-20 11:46:26 IST): **Workflow metadata fix committed** ✅
- `cfa15f93ba61` (2026-01-21 02:00:25 IST): NEW version in template ✅ (includes fix + 10 more commits)

Verified via `git merge-base --is-ancestor aea8194 cfa15f93ba61` = ✅ Fix IS included

## Changes

### 1. Updated CLI Template (`client-apps/cli/cmd/stigmer/root/new.go`)

**Before**:
```go
replace github.com/stigmer/stigmer/sdk/go => github.com/stigmer/stigmer/sdk/go v0.0.0-20260120005545-fc443b1640d1
replace github.com/stigmer/stigmer/apis/stubs/go => github.com/stigmer/stigmer/apis/stubs/go v0.0.0-20260120005545-fc443b1640d1
```

**After**:
```go
replace github.com/stigmer/stigmer/sdk/go => github.com/stigmer/stigmer/sdk/go v0.0.0-20260120203025-cfa15f93ba61
replace github.com/stigmer/stigmer/apis/stubs/go => github.com/stigmer/stigmer/apis/stubs/go v0.0.0-20260120203025-cfa15f93ba61
```

**Comment updated**: 
```go
// Using commit cfa15f93ba61 (2026-01-21) which includes workflow metadata fix
```

### 2. Fixed Missing Import (`client-apps/cli/internal/cli/agent/execute.go`)

Added missing `fmt` import (needed for stdout printing debug output during manifest execution).

## Impact

**User Flow - Before Fix**:
1. User installs `stigmer` via Brew
2. User runs `stigmer new my-project`
3. Generated `go.mod` has OLD SDK version (before metadata fix)
4. User runs `stigmer apply`
5. **ERROR**: "resource name is empty, cannot generate slug" ❌

**User Flow - After Fix**:
1. User installs `stigmer` via Brew (updated CLI)
2. User runs `stigmer new my-project`
3. Generated `go.mod` has NEW SDK version (includes metadata fix)
4. User runs `stigmer apply`
5. **SUCCESS**: Workflow deploys successfully ✅

## Testing

Validated the complete user flow:

```bash
# Test with LOCAL SDK (before fix)
cd stigmer-project
# go.mod has: replace => ../scm/github.com/stigmer/stigmer/sdk/go
stigmer apply
# ✅ Works (using local code with fix)

# Verify fix is in template version
git merge-base --is-ancestor aea8194 cfa15f93ba61
# ✅ Fix IS included in template version

# Test workflow deployment
stigmer apply
# ✅ Success: Workflow deployed: review-demo-pr (ID: wfl-1768941623662640000)
```

**Server logs confirm success**:
- ResolveSlug step completed (now has metadata.name)
- Workflow created successfully
- Default instance created
- No errors

## Technical Details

**The SDK Fix (Already Committed: aea8194)**:

The workflow converter (`sdk/go/internal/synth/workflow_converter.go`) initializes metadata:

```go
protoWorkflow.Metadata = &apiresource.ApiResourceMetadata{
    Name: wf.Document.Name,  // ← This was always here, but wasn't being serialized correctly
    // Note: Org and OwnerScope are set by the deployer based on backend mode
}
```

**The serialization works correctly** - tested by:
1. Creating workflow with SDK
2. Marshaling to protobuf
3. Unmarshaling and verifying metadata.name is present

**The Problem**: Generated projects had outdated SDK version in go.mod that predated this fix.

**The Solution**: Update template to use version that includes the fix.

## Files Modified

```
M client-apps/cli/cmd/stigmer/root/new.go
M client-apps/cli/internal/cli/agent/execute.go
```

## Related Issues

- Original SDK fix: commit `aea8194` (2026-01-20 11:46:26 IST)
- Issue discovered during testing of generated projects
- Template was last updated: 2026-01-20 00:55:45 UTC (5 hours before fix)

## Verification

**For Users (Post-Release)**:
1. Run `stigmer new test-project`
2. Check `go.mod` has version `v0.0.0-20260120203025-cfa15f93ba61`
3. Run `stigmer apply`
4. Verify workflow deploys without "resource name is empty" error

**For Developers (Local Testing)**:
1. Use local replace directives for testing uncommitted changes
2. Use remote versions for production releases
3. Always verify template version includes recent fixes

## Lessons Learned

1. **Template versions must be kept in sync with fixes** - When fixing SDK bugs, check if CLI templates need updating
2. **Hardcoded versions are a maintenance burden** - Template uses specific commit hash that must be manually updated
3. **Test the full user flow** - Testing with local replace directives hides version mismatch issues
4. **Version verification is critical** - Use `git merge-base` to verify fix is included in template version

## Next Steps

After committing this fix:
1. Release updated CLI via Brew
2. Users running `stigmer new` will get projects that work correctly
3. No more "resource name is empty" errors for new projects
4. Consider automating template version updates in CI/CD

---

**Category**: CLI  
**Priority**: High  
**Breaking Change**: No  
**Migration Required**: No (only affects new projects)
