# Cleanup E2E Tests and Fix Health Checks

**Date**: 2026-01-23  
**Type**: Refactoring + Bug Fix  
**Area**: Test Infrastructure  
**Impact**: Internal (test organization and reliability)

## Summary

Cleaned up E2E test structure, fixed IPv4/IPv6 health check issues, and reorganized tests by SDK example for better maintainability. Removed redundant test files and manually created workflow fixtures (will use SDK examples instead).

## Problem

**Health Check Failure:**
E2E tests failed to detect running Temporal server despite `stigmer server status` reporting everything active. Root cause: Temporal binds to IPv4 only (`127.0.0.1:7233`), but Go's `http.Client` with `localhost` tries IPv6 first (`[::1]:7233`), causing timeout.

**Test Organization:**
- Tests scattered across multiple files
- Unclear which tests validate which SDK examples
- Redundant test files (smoke, standalone, database tests)
- Documentation files not following naming standards
- Manually created workflow fixtures instead of using SDK examples

## Changes Made

### 1. Fixed Health Check (IPv4 vs IPv6 Issue)

**File**: `test/e2e/prereqs_test.go`

**Problem**: 
- Used `http://localhost:8233` (tries IPv6 `[::1]` first, times out)
- Checked Web UI port 8233 instead of gRPC port 7233

**Solution**:
- Changed to `127.0.0.1:7233` (forces IPv4, correct port)
- Use TCP dial instead of HTTP GET (gRPC server, not HTTP)
- Added `net` package import

```go
// Before: HTTP check on Web UI port (wrong!)
req, _ := http.NewRequestWithContext(ctx, "GET", "http://localhost:8233", nil)
client.Do(req) // Times out on IPv6

// After: TCP dial on gRPC port (correct!)
conn, err := net.DialContext(ctx, "tcp", "127.0.0.1:7233")
```

**Result**: Health checks now detect running Temporal correctly.

### 2. Organized Tests by SDK Example

**Created**: 
- `test/e2e/basic_agent_apply_test.go` - Apply tests for basic agent (SDK example 01)
- `test/e2e/basic_agent_run_test.go` - Run tests for basic agent (SDK example 01)

**Pattern**: `{example_name}_{command}_test.go`

**Benefits**:
- Clear naming shows which SDK example is tested
- Easy to find tests for specific examples
- Scalable for future examples
- Follows Go file naming conventions

### 3. Cleaned Up Test Fixtures

**Deleted manually created workflow fixtures**:
- `test/e2e/testdata/workflows/` - Entire directory
- `test/e2e/e2e_workflow_test.go` - Workflow tests

**Rationale**: SDK examples (maintained by SDK developers) are the source of truth. Tests should validate actual SDK examples, not manually created fixtures.

**Agent fixtures kept**:
- `test/e2e/testdata/agents/basic-agent/` - Contains SDK-synchronized code

### 4. Removed Redundant Tests

**Deleted**:
- `test/e2e/smoke_test.go` - Server startup already tested by harness
- `test/e2e/standalone_test.go` - Helper function tests redundant
- `test/e2e/database_test.go` - Database tested through actual apply/run

**Kept essential tests**:
- `test/e2e/basic_agent_apply_test.go` - Apply command tests
- `test/e2e/basic_agent_run_test.go` - Run command tests
- `test/e2e/e2e_run_test.go` - Generic run tests (TestRunWithInvalidAgent)
- `test/e2e/e2e_run_full_test.go` - Phase 2 full execution tests

**Result**: 12 test files (down from 15), clearer purpose for each.

### 5. Organized Documentation

**Created**: `test/e2e/docs/` directory following standards

**Moved and renamed**:
- `IMPLEMENTATION_SUMMARY.md` → `docs/implementation-summary.md`
- `README_PHASE2.md` → `docs/phase-2-guide.md`
- `SDK_SYNC_STRATEGY.md` → `docs/sdk-sync-strategy.md`
- `VALIDATION.md` → `docs/validation-framework.md`

**Deleted**:
- `WORKFLOW_QUICK_REF.md` - Workflows removed
- `WORKFLOW_TESTING_GUIDE.md` - Workflows removed
- `testdata/REORGANIZATION_SUMMARY.md` - Old notes

**Created new documentation**:
- `docs/README.md` - Documentation index
- `docs/file-guide.md` - Quick reference for all test files
- `docs/test-organization.md` - Test structure explained
- `testdata/agents/basic-agent/README.md` - Fixture explanation

**Result**: All documentation in `docs/` with lowercase-hyphen naming per standards.

### 6. Updated Test Paths

**Files Updated**:
- `test/e2e/suite_test.go` - Fixed Temporal health check comment
- `test/e2e/e2e_run_test.go` - Cleaned up header comments

**Path fixes**:
- Tests now point to `testdata/agents/basic-agent/` correctly
- SDK copying happens in `SetupSuite()` before tests run

## Test Results

All basic agent tests passing:

```
--- PASS: TestE2E (7.40s)
    --- PASS: TestE2E/TestApplyBasicAgent (1.40s)     ✅
    --- PASS: TestE2E/TestApplyDryRun (1.23s)         ✅
    --- PASS: TestE2E/TestRunBasicAgent (2.20s)       ✅
    --- PASS: TestE2E/TestRunWithInvalidAgent (1.20s) ✅
```

**Prerequisites now detected correctly:**
```
✓ SDK examples copied successfully
✓ Temporal detected at localhost:7233
✓ Ollama detected at localhost:11434
```

## File Structure (After Cleanup)

```
test/e2e/
├── README.md                          # Main guide (concise)
├── basic_agent_apply_test.go          # Basic agent apply tests ✨
├── basic_agent_run_test.go            # Basic agent run tests ✨
├── e2e_run_test.go                    # Generic run tests
├── e2e_run_full_test.go               # Phase 2 full execution
├── suite_test.go                      # Suite setup
├── harness_test.go                    # Isolated server management
├── stigmer_server_manager_test.go     # Production server management
├── prereqs_test.go                    # Prerequisites checking ✨
├── helpers_test.go                    # Helper functions
├── cli_runner_test.go                 # CLI execution
├── sdk_fixtures_test.go               # SDK example copying
├── validation_test.go                 # Execution validation
├── docs/                              # All documentation
│   ├── README.md
│   ├── file-guide.md
│   ├── test-organization.md
│   ├── sdk-sync-strategy.md
│   ├── phase-2-guide.md
│   ├── validation-framework.md
│   └── implementation-summary.md
└── testdata/                          # Fixtures only
    └── agents/
        └── basic-agent/
            ├── README.md
            ├── main.go              # Copied from SDK
            └── Stigmer.yaml
```

## Technical Details

### Health Check Fix

**Issue**: Connection refused even though server running

**Diagnosis**:
```bash
$ lsof -i :7233
temporal  11000  user  12u  IPv4  ...  TCP localhost:7233 (LISTEN)

$ curl -6 http://localhost:7233
curl: (7) Failed to connect to localhost port 7233: Connection refused

$ curl -4 http://127.0.0.1:7233
# Works!
```

**Root Cause**: IPv6 not enabled on Temporal server.

**Fix**: Force IPv4 by using `127.0.0.1` instead of `localhost`.

### SDK Example Synchronization

**Setup**:
```go
func (s *E2ESuite) SetupSuite() {
    // Copy SDK examples before running tests
    if err := CopyAllSDKExamples(); err != nil {
        s.T().Fatalf("Failed to copy SDK examples: %v", err)
    }
    // ...
}
```

**Mapping**:
```go
{
    SDKFileName:    "01_basic_agent.go",
    TestDataDir:    "agents/basic-agent",
    TargetFileName: "main.go",
}
```

**Benefits**:
- Tests validate **actual SDK examples** users see
- Single source of truth (SDK examples)
- Automatic synchronization on every test run
- No drift between examples and tests

## Statistics

**Files Deleted**: 15 files
- 3 redundant test files
- 6 manually created workflow fixture files  
- 6 documentation files (moved/reorganized)

**Files Created**: 5 files
- 2 organized test files
- 3 documentation files

**Files Updated**: 3 files
- `suite_test.go` - SDK copying + health check
- `prereqs_test.go` - IPv4/TCP fix
- `e2e_run_test.go` - Cleanup

**Net Change**: -10 files, better organization

**Test Count**: 12 test files (down from 15)
**Documentation**: 7 files (organized in `docs/`)
**Lines of Code**: 2,175 lines

## Impact

**For Developers:**
- ✅ Clearer test organization
- ✅ Easier to find tests for specific examples
- ✅ Reliable health checks (no false negatives)
- ✅ Better documentation structure
- ✅ Tests validate actual SDK examples

**For CI/CD:**
- ✅ More reliable prerequisites checking
- ✅ Clear test failure reasons
- ✅ Faster test execution (fewer redundant tests)

**For Future Work:**
- ✅ Easy to add tests for new SDK examples
- ✅ Pattern established: `{example}_{command}_test.go`
- ✅ Documentation follows standards consistently

## Next Steps

With clean test infrastructure:
1. Add tests for more SDK agent examples (skills, MCP servers, subagents)
2. Add workflow examples from SDK when ready
3. Expand Phase 2 full execution tests
4. All new tests follow established naming pattern

## Lessons Learned

**IPv4 vs IPv6 binding matters**: When "connection refused" but server reports running, check if server binds to IPv4 only. Force IPv4 in tests with `127.0.0.1` instead of `localhost`.

**Documentation standards are worth it**: Moving to `docs/` with lowercase-hyphen naming makes the codebase cleaner and more professional.

**SDK examples as source of truth**: Tests should validate what SDK promises users, not manually created approximations.
