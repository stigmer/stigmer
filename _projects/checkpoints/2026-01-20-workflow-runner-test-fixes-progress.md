# Workflow Runner Test Fixes - Progress Checkpoint

**Date:** 2026-01-20  
**Type:** Incremental Progress  
**Context:** Fixing workflow-runner test failures one at a time

## Current Status

**Progress:** 1 of 4 test failures fixed (25% complete)

## Completed Fixes

### ✅ Fix 1: DSL Version Error Message Case

**Test Fixed:** `TestValidationCatchesErrors/Invalid_DSL_version`

**Problem:** Error message case mismatch
- Error said: `"unsupported dsl version"` (lowercase)
- Test expected: `"unsupported DSL"` (uppercase)

**Solution:** Updated error constant in `errors.go` to use uppercase "DSL"

**Files Changed:**
- `backend/services/workflow-runner/pkg/zigflow/errors.go`

**Verification:** ✅ Test now passes

**Changelog:** `_changelog/2026-01/2026-01-20-031158-fix-dsl-version-error-message-case.md`

## Remaining Failures

**Category: Validation Rejection Issues (2 tests)**
1. ❌ `TestE2E_ValidationIntegration_InvalidConfig` - invalid config should be rejected but isn't
2. ❌ `TestValidateStructureActivity_InvalidYAML` - invalid YAML should fail validation but doesn't

**Category: Task Builder Execution Issues (2 tests)**
3. ❌ `TestForTaskBuilderIterator` - for-loop iterator not setting child values
4. ❌ `TestSwitchTaskBuilderExecutesMatchingCase` - switch statement assertion failing

## Approach

Fixing test failures **one at a time** as requested:
- ✅ Started with simplest issue (error message format)
- 📋 Next: Pick another category to tackle
- 🎯 Goal: Fix all 4 test failures incrementally

## Test Command

```bash
make test-workflow-runner
```

## Related Documentation

- **Architecture:** `docs/architecture/workflow-runner.md` (if exists)
- **Testing Guide:** `backend/services/workflow-runner/README.md`
- **Validation Logic:** `backend/services/workflow-runner/pkg/zigflow/`

---

*This checkpoint tracks incremental progress on fixing workflow-runner test failures. Each fix gets its own changelog entry.*
