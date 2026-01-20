# Checkpoint: Fix Backend Pipeline Slug Validation Order

**Date**: 2026-01-20  
**Type**: Bug Fix  
**Status**: ✅ Complete

## Summary

Fixed critical validation error in Go backend that prevented resource creation when users didn't provide explicit slug values. Reordered pipeline steps in all 19 controllers (10 create + 9 update) to resolve slug before validation, matching Java implementation.

## Problem Solved

Users encountered validation error:
```
validation error: slug: value length must be at least 1 characters
```

Even though they provided `name` field expecting auto-slug generation.

## Solution Implemented

**Pipeline order fixed in all controllers**:

**Create**: ResolveSlug → ValidateProto → CheckDuplicate → BuildNewState → Persist  
**Update**: ResolveSlug → ValidateProto → LoadExisting → BuildUpdateState → Persist

**Additional fixes for update controllers**:
- Added missing `ResolveSlug` step to workflow and workflowinstance updates
- Added missing `BuildUpdateStateStep` to workflow and workflowinstance updates

## Files Changed

- 19 controller files (all create and update handlers)
- Backend services: agent, workflow, skill, environment, agentinstance, workflowinstance, session, executioncontext, agentexecution, workflowexecution

## Documentation

**Changelog**: `_changelog/2026-01/2026-01-20-103939-fix-backend-pipeline-slug-validation-order.md`

## Impact

✅ `stigmer apply` now works correctly with name-only resources  
✅ Go backend behavior matches Java backend  
✅ Consistent pipeline patterns across all controllers  
✅ Proper state merging in update operations

## Related Work

- Discovered during testing of `stigmer apply` command
- Part of ongoing CLI/backend integration testing
- Ensures Go OSS backend has feature parity with Java Cloud backend
