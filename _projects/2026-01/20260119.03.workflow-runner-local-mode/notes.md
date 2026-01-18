# Implementation Notes

## Project Setup
**Date**: January 19, 2026  
**Type**: Quick Project (1-2 sessions)

## Context

This project implements ADR 015 requirements for the Go workflow-runner service. The agent-runner (Python) already has local mode implemented via Graphton's FilesystemBackend, but the workflow-runner needs its own filesystem store for the Claim Check pattern.

## Key Differences: Agent Runner vs Workflow Runner

### Agent Runner (Python)
- **Purpose**: Execute Graphton agents
- **Storage Need**: Sandbox filesystem for agent workspace
- **Implementation**: Graphton's `FilesystemBackend` with execute() for shell commands
- **Already Complete**: Local mode fully functional

### Workflow Runner (Go)
- **Purpose**: Orchestrate Temporal workflows
- **Storage Need**: Blob storage for large payloads (claim check pattern)
- **Implementation**: `FilesystemStore` for claim check blobs (this project)
- **Status**: Hardcoded to R2, needs filesystem alternative

## Architecture Decisions

### Why Not Reuse Agent Runner's Approach?

Agent runner uses Graphton (Python library) for sandboxed execution. Workflow runner is Go-based and uses the Claim Check pattern for a different purpose (payload overflow prevention vs code execution).

### Storage Interface Design

The `ObjectStore` interface is already well-designed:
- Simple key/value operations
- Context-aware
- Suitable for both R2 and filesystem

No interface changes needed - just add a new implementation.

### Backward Compatibility

Defaulting `StorageType` to "r2" ensures existing deployments continue working without config changes. Local mode is opt-in via `BLOB_STORAGE_TYPE=filesystem`.

## Implementation Notes

### Task 1: FilesystemStore Implementation

**Key Files**:
- Reference: `backend/services/workflow-runner/pkg/claimcheck/r2_store.go`
- Create: `backend/services/workflow-runner/pkg/claimcheck/filesystem_store.go`
- Test: `backend/services/workflow-runner/pkg/claimcheck/filesystem_store_test.go`

**Patterns to Follow**:
- Error wrapping with context (e.g., "filesystem put failed: %w")
- UUID key generation (same as R2Store)
- Defensive programming (check nil, validate inputs)

**Security Considerations**:
- File permissions: 0755 directories, 0644 files
- Path validation: Ensure keys don't escape basePath
- No special characters in keys (UUID is safe)

### Task 2: Config & Manager Updates

**Key Files**:
- `backend/services/workflow-runner/pkg/claimcheck/store.go` - Add Config fields
- `backend/services/workflow-runner/pkg/claimcheck/manager.go` - Add store selection
- Find config loading code (likely `main.go` or separate config package)

**Migration Strategy**:
- Add fields to Config struct
- Update NewManager to switch on StorageType
- Default to "r2" for backward compatibility
- Validate unknown storage types

### Testing Strategy

**Unit Tests** (Task 3):
- Use `t.TempDir()` for isolated test directories
- Test all interface methods
- Test error cases (nonexistent files, invalid paths)
- Test round-trips (Put → Get → verify data)

**Integration Testing** (Task 5):
- Manual testing with real workflow execution
- Verify file creation in filesystem
- Verify payload retrieval works
- Check metrics tracking

## Lessons Learned

### Task 1: FilesystemStore Implementation
**Completed**: January 19, 2026

**What Went Well**:
- Clean implementation following R2Store patterns
- All ObjectStore interface methods implemented
- Proper error handling with context wrapping
- Edge cases handled (ignore not-found in Delete, filter directories in ListKeys)

**Implementation Details**:
- Created: `backend/services/workflow-runner/pkg/claimcheck/filesystem_store.go`
- Pattern: Mirrored R2Store structure for consistency
- Validation: Checks basePath not empty, creates directory if needed
- Permissions: 0755 for directories, 0644 for files
- Key Generation: UUID v4 (same as R2Store)

**Code Quality**:
- Single responsibility: File only handles filesystem operations
- Error wrapping: Consistent "filesystem <op> failed: %w" pattern
- Defensive: Validates inputs, handles edge cases

### Task 2: Update Config & Manager
**Completed**: January 19, 2026

**What Changed**:
- Updated `store.go`: Added `StorageType` and `FilesystemBasePath` fields to Config
- Updated `manager.go`: Added storage selection logic in NewManager
- Backward compatible: Defaults to "r2" when StorageType is empty

**Implementation Details**:
- Storage selection via switch statement
- Validates unknown storage types with clear error message
- Preserves all existing R2 initialization code
- No changes to compressor or other manager logic

**Code Quality**:
- Clean switch pattern for extensibility (easy to add S3, GCS, etc.)
- Explicit default for backward compatibility
- Clear error messages listing supported types

### Task 3: Add Unit Tests
**Completed**: January 19, 2026

**Test Coverage**:
- Created: `backend/services/workflow-runner/pkg/claimcheck/filesystem_store_test.go`
- 11 test functions with 21 sub-tests
- All ObjectStore interface methods tested
- Error cases covered (nonexistent files, missing directories)
- Round-trip tests for various payload sizes
- Concurrent operation testing
- Large payload testing (10MB)

**Test Results**:
- All tests passing (21/21)
- Execution time: ~0.7s
- Uses `t.TempDir()` for isolation
- Follows same patterns as `r2_store_test.go`

**Key Test Cases**:
- Constructor validation (empty path, nested directories)
- CRUD operations (Put, Get, Delete)
- Health checks (healthy/unhealthy states)
- ListKeys (empty, multiple items, ignores directories)
- Edge cases (nonexistent keys, empty payloads, binary data)
- Performance (concurrent ops, large payloads)

### Task 4: Update Documentation
**Completed**: January 19, 2026

**Updates to README.md**:
- Added FilesystemStore to Components section
- Split Configuration into Common Settings + Backend-specific sections
- Added Local Mode (Filesystem) configuration with examples
- Updated Cloud Mode (R2) section for clarity
- Added separate usage examples for both storage backends
- Created Storage Backends comparison section
- Updated Testing section with filesystem-specific test commands

**Documentation Quality**:
- Clear differentiation between local and cloud modes
- When to use guidance for each backend
- Environment variable examples for both modes
- Code examples showing Config setup for both backends
- Advantages and limitations clearly stated

## Open Questions

1. Should we add TTL cleanup for filesystem mode?
   - R2 uses object lifecycle policies
   - Filesystem could use background goroutine or manual cleanup
   - Decision: Defer to future enhancement (not critical for local dev)

2. Should filesystem mode support compression?
   - ClaimCheckManager already handles compression before calling store
   - Decision: Yes, compression is transparent to store implementation

## Related Projects

- **Agent Runner Local Mode**: `_projects/2026-01/20260119.01.agent-runner-local-mode/`
  - Python/Graphton implementation
  - Completed T1-T3, different architecture
  
- **Open Source Stigmer**: `_projects/2026-01/20260118.03.open-source-stigmer/`
  - OSS extraction project
  - Uses BadgerDB for state storage (different from claim check)

## References

- ADR 015: `docs/adr/20260119-011111-workflow-runner-config.md`
- Claim Check README: `backend/services/workflow-runner/pkg/claimcheck/README.md`
- ObjectStore interface: `backend/services/workflow-runner/pkg/claimcheck/store.go`
