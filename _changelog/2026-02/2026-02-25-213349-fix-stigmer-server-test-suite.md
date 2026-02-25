# Fix Stigmer Server Test Suite -- 7 Failures Across 6 Packages

**Date**: February 25, 2026

## Summary

Fixed all 7 failing test packages (8 test cases) in the stigmer-server test suite. Fixes span environment controller, mcpserver/workflow/workflowinstance GetByReference tests, skill storage zip bomb protection, encryption empty-string handling, and seedpack version alignment. One production bug was fixed (GCM empty plaintext decryption) and one production improvement was made (early exit in ZIP bomb validation).

## Problem Statement

`make test` was failing with 7 test package failures in stigmer-server, blocking CI and development flow.

### Pain Points

- Environment controller test asserted on non-existent owner scope validation feature
- Three GetByReference tests omitted the required `org` field on `ApiResourceReference`, causing proto validation failures
- Zip bomb protection test created 550MB of DEFLATE-compressed data, exceeding the 30s race-detector timeout
- Encryption service rejected empty plaintext due to an off-by-one in the minimum ciphertext length check
- Seedpack test expected an outdated MCP server version (v0.0.14 vs v0.0.17)

## Solution

Each failure was root-caused individually and fixed with minimal, targeted changes. No architectural changes were required -- the issues were a mix of test bugs, a production bug in encryption, and a performance issue in test data generation.

## Implementation Details

### 1. Environment Controller -- Removed aspirational test

Removed the `validation_error_-_invalid_owner_scope` sub-test that tested a feature (owner scope CEL validation) that does not exist in the proto schema. Updated the README to remove the corresponding false documentation claim.

**Files**: `environment_controller_test.go`, `README.md`

### 2-4. GetByReference -- Added required `Org` field

Added `Org: "test-org"` to `ApiResourceReference` in three test files, matching the pattern already used in passing project and skill domain tests. The proto requires both `org` and `slug` with `buf.validate.field.required = true`.

**Files**: `mcpserver_controller_test.go`, `workflow_controller_test.go`, `workflowinstance_controller_test.go`

### 5. Zip Bomb Test -- Production early exit + test optimization

**Production code**: Moved the `totalUncompressedSize > maxUncompressedSize` check inside the loop in `validateZipContent` for fail-fast behavior -- no need to iterate remaining files once the limit is exceeded.

**Test code**: Reduced file count from 50 to 6 (85MB each, 510MB total), reduced random bytes per 1KB block from 100 to 15 for faster DEFLATE, and registered `flate.BestSpeed` compressor. Test now completes in ~15s under race detector vs the previous 30s+ timeout.

**Files**: `zip_extractor.go`, `testutil.go`

### 6. Encryption -- Fixed GCM empty plaintext support

Changed the minimum ciphertext length check from `GCMNonceSize + 1 + gcm.Overhead()` to `GCMNonceSize + gcm.Overhead()`. GCM validly encrypts empty plaintext, producing nonce + tag with zero ciphertext bytes. The `+ 1` was an incorrect assumption that at least one byte of ciphertext must exist.

**Files**: `encryption.go`

### 7. Seedpack -- Version alignment

Updated test expectation from `v0.0.14` to `v0.0.17` to match the YAML source file.

**Files**: `seedpack_test.go`

## Benefits

- All 21 stigmer-server test packages now pass under `make test` (with `-race -timeout 30s`)
- Production encryption service correctly handles empty string values
- ZIP bomb validation fails faster by short-circuiting on size limit
- Removed misleading documentation about non-existent features

## Impact

- **CI/CD**: Unblocks the test pipeline for stigmer-server
- **Encryption**: Empty secret values (valid in environment configurations) can now be encrypted and decrypted correctly
- **Security**: ZIP bomb detection is marginally faster due to early exit optimization
- **Documentation**: README no longer claims owner scope validation exists

## Related Work

- Preceded by `fix(backend/stigmer-server): align skill domain tests with org and frontmatter requirements`
- Preceded by `fix(backend/stigmer-server): bump mcp-server to v0.0.17`

---

**Status**: ✅ Production Ready
**Timeline**: Single session
