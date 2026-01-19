# Next Task: Workflow Runner Local Mode

**Project**: Workflow Runner Local Mode  
**Location**: `_projects/2026-01/20260119.03.workflow-runner-local-mode/`  
**Status**: Core Implementation Complete ✅

**Remaining**: Task 5 - Integration Testing (manual verification)

## Quick Context

Implementing local mode for Go workflow-runner service by adding filesystem-based claim check storage as alternative to Cloudflare R2, per ADR 015 requirements.

**Goal**: Enable workflow-runner to run locally without R2 credentials.

**Implementation Status**: 
- ✅ FilesystemStore implemented (Task 1)
- ✅ Config & Manager updated with storage selection (Task 2)
- ✅ Comprehensive unit tests added - all passing (Task 3)
- ✅ Documentation updated with local mode guide (Task 4)
- ⏸️  Integration testing pending - manual verification needed (Task 5)

## ✅ Implementation Complete - Ready for Integration Testing

Tasks 1-4 are complete! The filesystem storage backend is fully implemented, tested, and documented.

**Recent Update (2026-01-20)**: Module dependencies fixed - testing is now unblocked! See checkpoint `checkpoints/2026-01-20-module-dependencies-fixed.md`.

**What's Been Done:**

1. **FilesystemStore Implementation** (`filesystem_store.go`)
   - All ObjectStore methods implemented
   - Auto-creates storage directories
   - UUID-based file naming
   - Proper error handling and edge cases

2. **Config & Manager Updates**
   - Added `StorageType` and `FilesystemBasePath` to Config
   - Manager now switches between R2/filesystem based on config
   - Backward compatible (defaults to R2)
   - Validates unknown storage types

3. **Comprehensive Testing** (`filesystem_store_test.go`)
   - 21 test cases covering all scenarios
   - All tests passing
   - Round-trip tests, error cases, concurrent operations
   - Large payload testing (10MB)

4. **Documentation** (`README.md`)
   - Local mode configuration guide
   - Usage examples for both storage backends
   - Storage backend comparison
   - When to use each backend

## Task 5: Integration Testing (Manual Verification)

**Objective**: Verify local mode works end-to-end with actual workflow execution.

This task requires manual testing when you're ready to run the workflow-runner locally.

### Quick Start Guide

To test the filesystem backend:

```bash
# 1. Set environment variables
export BLOB_STORAGE_TYPE=filesystem
export BLOB_STORAGE_PATH=/tmp/stigmer-test-blobs
export CLAIMCHECK_ENABLED=true
export CLAIMCHECK_THRESHOLD_BYTES=1024  # 1KB for easy testing

# 2. Start workflow-runner
cd backend/services/workflow-runner
go run main.go

# 3. Execute a test workflow with large payload (>1KB)

# 4. Verify files created
ls -lh /tmp/stigmer-test-blobs/
# Should show UUID-named files

# 5. Verify workflow completes successfully
```

### Verification Checklist

- [ ] Service starts without R2 credentials
- [ ] Large payloads (>threshold) offloaded to filesystem
- [ ] Files created in specified directory with UUID names
- [ ] Payloads retrieved correctly by activities
- [ ] Workflows complete successfully
- [ ] Metrics track operations (offload/retrieval counts)
- [ ] Files can be listed via ListKeys

### What to Look For

**Success indicators:**
- Log messages showing "Offloading large payload"
- Files appearing in BLOB_STORAGE_PATH directory
- Workflow execution completing without errors
- Metrics showing offload/retrieval counts

**Failure scenarios to test:**
- Invalid storage path (should fail with clear error)
- Missing storage directory (should auto-create)
- Nonexistent file retrieval (should fail gracefully)

## Next Steps

This implementation is ready for:
1. **Local development** - Use filesystem mode immediately
2. **CI/CD integration** - No R2 credentials needed for tests
3. **Production deployment** - Continue using R2 mode (default)

## Files Modified

**Implementation:**
- `backend/services/workflow-runner/pkg/claimcheck/filesystem_store.go` (new)
- `backend/services/workflow-runner/pkg/claimcheck/store.go` (updated)
- `backend/services/workflow-runner/pkg/claimcheck/manager.go` (updated)

**Testing:**
- `backend/services/workflow-runner/pkg/claimcheck/filesystem_store_test.go` (new)

**Documentation:**
- `backend/services/workflow-runner/pkg/claimcheck/README.md` (updated)

---

**To resume integration testing**, reference:  
`@_projects/2026-01/20260119.03.workflow-runner-local-mode/tasks.md` (Task 5 section)

## Files

- `README.md` - Project overview and architecture
- `tasks.md` - All 5 tasks with detailed requirements
- `notes.md` - Implementation notes and learnings
- `next-task.md` - This file (drag into chat to resume!)

## Related Code

**ObjectStore Interface** (`pkg/claimcheck/store.go`):
```go
type ObjectStore interface {
    Put(ctx context.Context, data []byte) (key string, err error)
    Get(ctx context.Context, key string) (data []byte, err error)
    Delete(ctx context.Context, key string) error
    Health(ctx context.Context) error
    ListKeys(ctx context.Context) ([]string, error)
}
```

**R2Store Reference** (`pkg/claimcheck/r2_store.go`):
- See lines 23-72 for struct and initialization pattern
- See lines 75-88 for Put implementation
- See lines 90-103 for Get implementation

**Current Manager** (`pkg/claimcheck/manager.go`):
- Line 28: Hardcoded to `NewR2Store(ctx, cfg)`
- This will be updated in Task 2 to select based on config

---

**To resume**: Just drag this file into any chat or reference:  
`@_projects/2026-01/20260119.03.workflow-runner-local-mode/next-task.md`
