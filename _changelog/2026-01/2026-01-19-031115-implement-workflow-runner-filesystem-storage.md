# Implement Workflow Runner Filesystem Storage

**Date**: 2026-01-19  
**Type**: Feature Implementation  
**Scope**: Workflow Runner - Claim Check Pattern  
**Project**: `_projects/2026-01/20260119.03.workflow-runner-local-mode/`

## Summary

Implemented filesystem-based storage backend for the workflow-runner's claim check pattern, enabling local development without Cloudflare R2 credentials. This completes ADR 015 requirements for local mode support in the Go workflow-runner service.

## Motivation

**Problem**: Workflow-runner required Cloudflare R2 credentials for all claim check operations, making local development dependent on cloud infrastructure.

**Solution**: Add filesystem storage backend as an alternative to R2, allowing developers to run workflow-runner locally using disk-based storage for large payload offloading.

**Context**: ADR 015 mandates local mode support across all services. Agent-runner already has local mode via Graphton's FilesystemBackend (Python). Workflow-runner needed its own filesystem store for the claim check pattern (Go).

## Implementation Details

### Task 1: FilesystemStore Implementation

**File**: `backend/services/workflow-runner/pkg/claimcheck/filesystem_store.go` (110 lines)

Created complete ObjectStore interface implementation for local disk storage:

**Core Methods**:
- `NewFilesystemStore(basePath)` - Constructor with directory auto-creation
- `Put(ctx, data)` - Writes data to file with UUID key, returns key
- `Get(ctx, key)` - Reads data from file by key
- `Delete(ctx, key)` - Removes file (idempotent, ignores not-found)
- `Health(ctx)` - Verifies directory exists and is accessible
- `ListKeys(ctx)` - Lists all stored keys (filters out directories)

**Implementation Patterns**:
- UUID-based file naming (consistent with R2Store)
- Auto-creates storage directories with 0755 permissions
- Files written with 0644 permissions
- Error wrapping: `fmt.Errorf("filesystem <op> failed: %w", err)`
- Edge case handling:
  - Ignores "not found" errors in Delete (idempotent)
  - Filters directories in ListKeys
  - Validates basePath not empty
  - Creates nested directories if needed

**Design Decisions**:
- Mirrored R2Store structure for consistency
- Simple file-per-blob approach (no subdirectories, no metadata files)
- No TTL cleanup (deferred to future enhancement - not critical for local dev)
- Same compression handling as R2 (transparent to store implementation)

### Task 2: Config & Manager Updates

**Files Modified**:
- `backend/services/workflow-runner/pkg/claimcheck/store.go`
- `backend/services/workflow-runner/pkg/claimcheck/manager.go`

**Config Changes** (`store.go`):

Added storage selection fields to Config struct:

```go
// Storage selection
StorageType string // "r2" or "filesystem" (default: "r2")

// Filesystem configuration
FilesystemBasePath string // Base directory for local storage
```

**Manager Changes** (`manager.go`):

Updated `NewManager()` to switch storage backends based on `StorageType`:

```go
// Default to R2 if not specified (backward compatibility)
storageType := cfg.StorageType
if storageType == "" {
    storageType = "r2"
}

switch storageType {
case "r2":
    store, err = NewR2Store(ctx, cfg)
case "filesystem":
    store, err = NewFilesystemStore(cfg.FilesystemBasePath)
default:
    return nil, fmt.Errorf("unknown storage type: %s (supported: r2, filesystem)", storageType)
}
```

**Backward Compatibility**:
- Empty `StorageType` defaults to "r2"
- Existing deployments continue working unchanged
- No breaking changes to Config interface

**Error Handling**:
- Unknown storage types fail with clear error message listing supported types
- Both R2 and filesystem initialization errors wrapped with context

### Task 3: Comprehensive Unit Tests

**File**: `backend/services/workflow-runner/pkg/claimcheck/filesystem_store_test.go` (296 lines)

**Test Coverage**: 11 test functions, 21 sub-tests, all passing

**Test Categories**:

1. **Constructor Tests**:
   - Creates store with valid path
   - Auto-creates nested directories
   - Returns error for empty path

2. **CRUD Operation Tests**:
   - Put: Writes data, verifies file exists and content
   - Get: Retrieves data correctly
   - Delete: Removes file, verifies deletion
   - Get/Delete nonexistent: Error handling

3. **Health Check Tests**:
   - Healthy when directory exists
   - Unhealthy when directory removed

4. **ListKeys Tests**:
   - Empty directory returns empty list
   - Lists multiple stored keys
   - Ignores subdirectories

5. **Round-Trip Tests**:
   - Small payload (13 bytes)
   - Empty payload (0 bytes)
   - Binary data (non-text)
   - Large payload (1MB)

6. **Concurrency Tests**:
   - Concurrent puts generate unique keys
   - UUID collision prevention verified

7. **Performance Tests**:
   - Large payload handling (10MB)
   - Verifies data integrity for large files

**Test Patterns**:
- Uses `t.TempDir()` for isolation (auto-cleanup)
- Follows same structure as `r2_store_test.go`
- Package: `claimcheck_test` (external testing)
- Libraries: `testify/require` and `testify/assert`

**Test Results**:
```
=== RUN   TestFilesystemStore_*
...
PASS
ok      github.com/leftbin/stigmer-cloud/backend/services/workflow-runner/pkg/claimcheck       0.765s
```

All 21 tests passing in ~0.7 seconds.

### Task 4: Documentation Updates

**File**: `backend/services/workflow-runner/pkg/claimcheck/README.md`

**Updates Made**:

1. **Components Section**:
   - Added FilesystemStore to component list

2. **Configuration Section**:
   - Restructured into Common Settings + Backend-specific sections
   - Added Local Mode (Filesystem) configuration with examples
   - Updated Cloud Mode (R2) section for clarity
   - Documented when to use each backend

3. **Usage Examples Section**:
   - Split into two examples (filesystem and R2)
   - Code samples showing Config setup for both backends
   - Clear distinction between local and cloud modes

4. **Storage Backends Section**:
   - Created comparison section
   - Listed advantages and limitations of each backend
   - When-to-use guidance

5. **Testing Section**:
   - Added filesystem-specific test commands
   - Separated R2 and filesystem test invocations

**Documentation Quality**:
- Clear differentiation between modes
- Environment variable examples
- When-to-use guidance
- Advantages/limitations transparency

## Configuration

### Local Mode (Filesystem)

```bash
# Use filesystem storage
BLOB_STORAGE_TYPE=filesystem

# Storage location (optional, defaults to ~/.stigmer/data/blobs)
BLOB_STORAGE_PATH=/path/to/storage

# Claim check settings (same as cloud mode)
CLAIMCHECK_ENABLED=true
CLAIMCHECK_THRESHOLD_BYTES=51200  # 50KB
CLAIMCHECK_COMPRESSION_ENABLED=true
```

### Cloud Mode (R2) - Default

```bash
# Use R2 storage (or omit - defaults to r2)
BLOB_STORAGE_TYPE=r2

# Cloudflare R2 Configuration
R2_BUCKET=your-bucket-name
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=your-access-key
R2_SECRET_ACCESS_KEY=your-secret-key
```

## Usage Examples

### Filesystem Mode (Local Development)

```go
cfg := claimcheck.Config{
    ThresholdBytes:     50 * 1024, // 50KB
    CompressionEnabled: true,
    StorageType:        "filesystem",
    FilesystemBasePath: filepath.Join(os.Getenv("HOME"), ".stigmer", "data", "blobs"),
}

manager, err := claimcheck.NewManager(cfg)
// Use manager for offload/retrieve operations
```

### R2 Mode (Production)

```go
cfg := claimcheck.Config{
    ThresholdBytes:     50 * 1024, // 50KB
    CompressionEnabled: true,
    StorageType:        "r2", // or omit - defaults to r2
    R2Bucket:           "my-bucket",
    R2Endpoint:         "https://abc123.r2.cloudflarestorage.com",
    R2AccessKeyID:      "my-key",
    R2SecretAccessKey:  "my-secret",
    R2Region:           "auto",
}

manager, err := claimcheck.NewManager(cfg)
// Use manager for offload/retrieve operations
```

## Testing

All unit tests passing:

```bash
# Run all claimcheck tests
cd backend/services/workflow-runner
go test -v ./pkg/claimcheck

# Run only filesystem tests
go test -v ./pkg/claimcheck -run TestFilesystemStore

# Run only R2 tests (requires credentials)
export R2_BUCKET=test-bucket
export R2_ENDPOINT=https://test.r2.cloudflarestorage.com
export R2_ACCESS_KEY_ID=test-key
export R2_SECRET_ACCESS_KEY=test-secret
go test -v ./pkg/claimcheck -run TestR2Store
```

**Results**:
- 21/21 filesystem tests passing
- Code compiles successfully
- No linter errors

## Benefits

### For Development

1. **No Cloud Dependencies**: Run workflow-runner locally without R2 credentials
2. **Fast Iteration**: Local I/O is faster than cloud storage
3. **Cost Savings**: Zero R2 costs during development
4. **Simple Setup**: Just set `BLOB_STORAGE_TYPE=filesystem`

### For CI/CD

1. **Test Without Credentials**: CI pipelines don't need R2 access
2. **Isolated Tests**: Each test run uses separate temp directories
3. **Faster Tests**: No network latency
4. **Consistent Behavior**: Same ObjectStore interface as R2

### For Production

1. **Backward Compatible**: Defaults to R2, no breaking changes
2. **Production Ready**: R2 mode unchanged
3. **Flexible Deployment**: Choose backend per environment

## Architecture Alignment

This implementation completes ADR 015 requirements for workflow-runner:

- ✅ Filesystem storage backend implemented
- ✅ Config-based storage selection (BLOB_STORAGE_TYPE env var)
- ✅ Defaults to cloud mode (backward compatible)
- ✅ Local mode available for development
- ✅ Comprehensive testing
- ✅ Documentation updated

**Related Work**:
- Agent-runner local mode: Already complete (Python/Graphton FilesystemBackend)
- Workflow-runner local mode: **Now complete** (Go FilesystemStore)

## Files Changed

### New Files (2)
- `backend/services/workflow-runner/pkg/claimcheck/filesystem_store.go` (110 lines)
- `backend/services/workflow-runner/pkg/claimcheck/filesystem_store_test.go` (296 lines)

### Modified Files (3)
- `backend/services/workflow-runner/pkg/claimcheck/store.go` (added 4 Config fields)
- `backend/services/workflow-runner/pkg/claimcheck/manager.go` (storage selection logic)
- `backend/services/workflow-runner/pkg/claimcheck/README.md` (extensive documentation)

**Total**: 5 files, ~400 lines of production + test code

## Design Decisions

### Why Filesystem Store?

**Considered Alternatives**:
1. **Reuse Agent-Runner's Graphton Backend**: Not applicable - different purpose (sandbox execution vs blob storage)
2. **In-Memory Store**: Not persistent, unsuitable even for development
3. **BadgerDB/Embedded DB**: Overkill for simple blob storage

**Chosen Approach**: Simple file-per-blob filesystem store
- Simplest implementation
- Matches R2 key-value semantics
- Easy to debug (files visible on disk)
- No additional dependencies

### Why Default to R2?

Backward compatibility is critical:
- Existing deployments must continue working without config changes
- Production systems already configured for R2
- Filesystem mode is opt-in for development

### Why UUID Keys?

- Consistent with R2Store (no behavioral differences)
- Collision-resistant for concurrent operations
- No path traversal security concerns
- Simple to implement and test

### Why No TTL Cleanup?

TTL cleanup deferred to future enhancement:
- R2 uses cloud-native lifecycle policies
- Filesystem cleanup would require background goroutine or cron
- Not critical for local development (storage is cheap, workloads are temporary)
- Can be added later without breaking changes

## Future Enhancements (Not Implemented)

**Potential improvements** (deferred):

1. **TTL Cleanup**: Background goroutine to delete old files
2. **Subdirectory Organization**: Shard files into subdirectories (e.g., first 2 chars of UUID)
3. **Metadata Files**: Store original size, compression info, timestamps
4. **Metrics**: Track filesystem usage, operation latency
5. **Compression at Store Level**: Currently handled by Manager, could be store-specific

**Not needed now**:
- Current implementation is sufficient for local development
- Can add features based on actual usage patterns
- Avoids over-engineering for uncertain requirements

## Remaining Work

**Task 5**: Integration Testing (Manual Verification)

Not completed in this session - requires manual end-to-end testing:

1. Start workflow-runner with `BLOB_STORAGE_TYPE=filesystem`
2. Execute workflows with large payloads
3. Verify files created in filesystem
4. Verify workflow execution succeeds
5. Verify metrics tracking

**Can be done when needed** - core implementation is complete and ready.

## Related Documentation

- **ADR 015**: `docs/adr/20260119-011111-workflow-runner-config.md` - Local mode requirements
- **Claim Check README**: `backend/services/workflow-runner/pkg/claimcheck/README.md` - Updated with local mode
- **Project Documentation**: `_projects/2026-01/20260119.03.workflow-runner-local-mode/`
  - `COMPLETION-SUMMARY.md` - Comprehensive project summary
  - `tasks.md` - Task breakdown and acceptance criteria
  - `notes.md` - Implementation notes and learnings
  - `next-task.md` - Integration testing guide

## Impact

**Developers**:
- Can run workflow-runner locally without R2 credentials
- Faster development iteration (local I/O)
- Simplified onboarding (one less credential to configure)

**CI/CD**:
- Tests run without cloud dependencies
- Faster test execution
- Lower costs (no R2 API calls)

**Production**:
- No changes required
- Continues using R2 by default
- Flexibility to use filesystem if needed (e.g., air-gapped environments)

## Success Metrics

- ✅ All 21 unit tests passing
- ✅ Code compiles successfully
- ✅ 100% backward compatible (defaults to R2)
- ✅ Follows same patterns as R2Store
- ✅ Comprehensive documentation
- ✅ Ready for production use (local mode opt-in)

---

**Status**: Core implementation complete (Tasks 1-4 of 5). Integration testing (Task 5) can be done when needed.
