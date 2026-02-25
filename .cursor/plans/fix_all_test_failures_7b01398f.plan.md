---
name: Fix all test failures
overview: Fix 7 failing test packages (8 test cases) across environment controller, mcpserver/workflow/workflowinstance GetByReference, skill storage zip bomb, encryption empty string, and seedpack version mismatch.
todos:
  - id: env-remove-test
    content: Remove the aspirational `invalid_owner_scope` sub-test and update README to remove false CEL claim
    status: completed
  - id: getbyref-add-org
    content: "Add `Org: \"test-org\"` to ApiResourceReference in mcpserver, workflow, and workflowinstance GetByReference tests"
    status: completed
  - id: zip-early-exit
    content: Add early exit in `validateZipContent` when totalUncompressedSize exceeds limit
    status: completed
  - id: zip-optimize-test
    content: Reduce `CreateLargeUncompressedZip` from 550MB to ~510MB (6 x 85MB)
    status: completed
  - id: encryption-fix
    content: Fix minimum ciphertext length check to allow empty plaintext (remove `+ 1`)
    status: completed
  - id: seedpack-version
    content: Update TestLoadMcpServerYAML expected version from v0.0.14 to v0.0.17
    status: completed
  - id: verify-tests
    content: Run `make test` to verify all failures are resolved
    status: completed
isProject: false
---

# Fix All Test Failures

## Failure 1: Environment Controller -- Remove aspirational test

**Root cause**: The test `validation_error_-_invalid_owner_scope` tests a feature that does not exist. There is no `owner_scope` field in `ApiResourceMetadata` and no CEL validation rule in the proto. The test creates a valid environment (`Org: "test-org"`) and expects it to fail, which it never will.

**Fix**:

- Remove the sub-test at lines 180-197 in [environment_controller_test.go](backend/services/stigmer-server/pkg/domain/environment/controller/environment_controller_test.go)
- Update the README at lines 101-107 in [README.md](backend/services/stigmer-server/pkg/domain/environment/controller/README.md) to remove the false claim about owner scope validation via CEL rules

---

## Failure 2-4: GetByReference tests -- Add missing `Org` field

**Root cause**: Three `GetByReference` tests omit the required `Org` field on `ApiResourceReference`. The proto requires both `org` and `slug` (with `buf.validate.field.required = true`). Working tests in the project and skill domains correctly set `Org: "test-org"`.

**Fix** -- add `Org: "test-org"` to the `ApiResourceReference` in each test:

- [mcpserver_controller_test.go](backend/services/stigmer-server/pkg/domain/mcpserver/controller/mcpserver_controller_test.go) -- `TestMcpServerController_GetByReference/successful_get_by_reference`
- [workflow_controller_test.go](backend/services/stigmer-server/pkg/domain/workflow/controller/workflow_controller_test.go) -- `TestWorkflowController_GetByReference/successful_get_by_slug`
- [workflowinstance_controller_test.go](backend/services/stigmer-server/pkg/domain/workflowinstance/controller/workflowinstance_controller_test.go) -- `TestWorkflowInstanceController_GetByReference/successful_get_by_slug`

---

## Failure 5: Skill storage zip bomb test timeout

**Root cause**: `TestExtractSkillMd_ZipBomb_LargeUncompressed` creates a 550MB ZIP (50 files x 11MB, DEFLATE-compressed) in memory. With `-race` enabled and a 30s timeout, creation + parsing exceeds the time limit. The test already has a `testing.Short()` skip guard but the Makefile doesn't pass `-short`.

**Fix** -- two changes:

1. **Production code improvement** in [zip_extractor.go](backend/services/stigmer-server/pkg/domain/skill/storage/zip_extractor.go): Add early exit in `validateZipContent` -- return the error as soon as `totalUncompressedSize > maxUncompressedSize` inside the loop rather than after iterating all files. This is correct behavior regardless of the test issue.
2. **Optimize test data creation** in [testutil.go](backend/services/stigmer-server/pkg/domain/skill/storage/testutil.go): Reduce `CreateLargeUncompressedZip` from 50 files x 11MB (550MB) to 6 files x 85MB (510MB) -- just barely over the 500MB limit. This cuts ZIP creation time significantly while still validating the same boundary.

---

## Failure 6: Encryption -- empty string decryption

**Root cause**: In [encryption.go](backend/services/stigmer-server/pkg/encryption/encryption.go) line 177, `Decrypt` requires minimum `GCMNonceSize + 1 + gcm.Overhead()` = 29 bytes. But encrypting an empty string produces `nonce(12) + tag(16)` = 28 bytes -- no ciphertext bytes. GCM validly encrypts empty plaintext; the `+ 1` in the minimum length check is incorrect.

**Fix**: Change line 177 from:

```go
minLen := GCMNonceSize + 1 + s.gcm.Overhead()
```

to:

```go
minLen := GCMNonceSize + s.gcm.Overhead()
```

This fixes both `TestEncryptDecrypt/empty_string` and `TestCrossLanguageCompatibility/#00`.

---

## Failure 7: Seedpack version mismatch

**Root cause**: The YAML file [stigmer-mcp-server.yaml](backend/services/stigmer-server/pkg/seedpack/mcp-servers/stigmer-mcp-server.yaml) was updated to `v0.0.17` but the test in [seedpack_test.go](backend/services/stigmer-server/pkg/seedpack/seedpack_test.go) line 580 still expects `v0.0.14`.

**Fix**: Update the expected version string on line 580 from `v0.0.14` to `v0.0.17`.