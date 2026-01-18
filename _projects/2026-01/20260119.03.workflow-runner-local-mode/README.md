# Workflow Runner Local Mode

**Status**: ✅ Core Implementation Complete  
**Started**: January 19, 2026  
**Completed**: January 19, 2026 (Tasks 1-4)  
**Type**: Quick Project (1 session)

## Overview

Implement local mode for the Go-based workflow-runner service by adding filesystem-based claim check storage as an alternative to Cloudflare R2, fulfilling the requirements outlined in ADR 015.

## Goal

Enable workflow-runner to run in local mode without R2 cloud dependency by implementing filesystem blob storage that satisfies the ObjectStore interface.

## Technology Stack

- **Go** (workflow-runner service)
- **Bazel** (build system)
- **AWS SDK** (for S3-compatible ObjectStore interface)
- **Claim Check Pattern** (large payload handling)

## Affected Components

1. **`backend/services/workflow-runner/pkg/claimcheck/`**:
   - New `filesystem_store.go` - Filesystem implementation of ObjectStore
   - Modified `store.go` - Add StorageType and filesystem config
   - Modified `manager.go` - Add storage backend selection logic
   
2. **Configuration**:
   - Environment variables for storage type selection
   - Filesystem base path configuration
   
3. **Documentation**:
   - README updates for local mode setup
   - Environment variable reference

## Context

### Current State

The workflow-runner uses the **Claim Check Pattern** to handle large payloads (>50KB) that exceed Temporal's limits:
- Large results are uploaded to **Cloudflare R2** (S3-compatible storage)
- A small reference replaces the payload in workflow state
- Activities retrieve the full payload when needed

**Problem**: R2 requires cloud credentials, preventing local development/testing.

### Architecture

**Existing Interface** (`pkg/claimcheck/store.go`):
```go
type ObjectStore interface {
    Put(ctx context.Context, data []byte) (key string, err error)
    Get(ctx context.Context, key string) (data []byte, err error)
    Delete(ctx context.Context, key string) error
    Health(ctx context.Context) error
    ListKeys(ctx context.Context) ([]string, error)
}
```

**Current Implementation**:
- ✅ `R2Store` - Cloudflare R2 backend (production)
- ❌ `FilesystemStore` - Local filesystem backend (missing)

**Manager Selection** (`pkg/claimcheck/manager.go`):
```go
// Currently hardcoded to R2
func NewManager(cfg Config) (*Manager, error) {
    store, err := NewR2Store(ctx, cfg)  // ❌ No alternative
    // ...
}
```

### ADR 015 Requirements

Per `docs/adr/20260119-011111-workflow-runner-config.md`:

1. **Define BlobStore Interface** - Already exists as `ObjectStore`
2. **Implement FilesystemStore** - Uses local disk (`~/.stigmer/data/blobs`)
3. **Update Configuration** - Add `BLOB_STORAGE_TYPE` environment variable
4. **Manager Selection** - Choose store based on config

## Success Criteria

- [x] FilesystemStore implements ObjectStore interface
- [x] Storage type configurable via `BLOB_STORAGE_TYPE` environment variable
- [x] Manager selects appropriate store (R2 vs filesystem) at runtime
- [x] Unit tests cover all FilesystemStore operations (21/21 passing)
- [x] Documentation updated with local mode setup instructions
- [ ] End-to-end test verifies local mode workflow execution (Task 5 - manual verification)

## Tasks

See `tasks.md` for detailed task breakdown and progress tracking.

## Implementation Status

**Completed** (Tasks 1-4):
- ✅ FilesystemStore implementation (`filesystem_store.go`)
- ✅ Config & Manager updates (storage selection)
- ✅ Comprehensive unit tests (21/21 passing)
- ✅ Documentation updated (`README.md`)

**Remaining** (Task 5):
- ⏸️ Integration testing (manual verification when needed)

**Ready for Use**: Developers can use filesystem mode immediately for local development.

## Quick Navigation

- **Completion Summary**: See `COMPLETION-SUMMARY.md`
- **Latest Checkpoint**: `checkpoints/2026-01-19-filesystem-storage-complete.md`
- **Changelog**: `_changelog/2026-01/2026-01-19-031115-implement-workflow-runner-filesystem-storage.md`
- **Tasks**: See `tasks.md`
- **Notes**: See `notes.md`
- **Integration Testing**: See `next-task.md` (Task 5)

## Related Documentation

- ADR: `docs/adr/20260119-011111-workflow-runner-config.md`
- Claim Check Package: `backend/services/workflow-runner/pkg/claimcheck/README.md`
- Agent Runner Local Mode: `_projects/2026-01/20260119.01.agent-runner-local-mode/` (Python equivalent)
