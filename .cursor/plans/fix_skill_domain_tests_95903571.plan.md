---
name: Fix Skill Domain Tests
overview: "Fix all failing tests in the skill domain (controller + storage packages) by aligning test data with the two schema evolutions that occurred: (1) `org` became a required field on `PushSkillRequest` and `ApiResourceReference`, and (2) `ExtractSkillMd` now validates YAML frontmatter in SKILL.md."
todos:
  - id: add-valid-skill-content-helper
    content: Add ValidSkillContent helper to storage/testutil.go and fix CreateLargeUncompressedZip chunked writes
    status: completed
  - id: fix-zip-extractor-tests
    content: Fix 4 failing tests in storage/zip_extractor_test.go to use ValidSkillContent
    status: completed
  - id: fix-skill-controller-test
    content: "Fix skill_controller_test.go: add Org to createTestSkill/createTestAuditRecord calls and ApiResourceReference instances"
    status: completed
  - id: fix-push-test
    content: "Fix push_test.go: add Org, use valid frontmatter content, fix assertions, fix false-positive negative tests"
    status: completed
  - id: fix-integration-test
    content: "Fix integration_test.go: add Org to all requests/references, use valid frontmatter content, fix assertions"
    status: completed
  - id: verify-tests-pass
    content: Run go test ./pkg/domain/skill/... and verify all tests pass
    status: completed
isProject: false
---

# Fix Skill Domain Test Failures

## Root Causes (3 distinct issues)

### 1. Missing `org` in proto validation

`PushSkillRequest.org` and `ApiResourceReference.org` now have `[(buf.validate.field).required = true]` (`[apis/ai/stigmer/agentic/skill/v1/io.proto](apis/ai/stigmer/agentic/skill/v1/io.proto)`, `[apis/ai/stigmer/commons/apiresource/io.proto](apis/ai/stigmer/commons/apiresource/io.proto)`). Tests that omit `org` fail at the `ValidateProtoConstraints` pipeline step.

### 2. SKILL.md frontmatter now required

`[storage/frontmatter.go](backend/services/stigmer-server/pkg/domain/skill/storage/frontmatter.go)` requires SKILL.md to start with `---` YAML frontmatter containing a kebab-case `name` field. `[storage/zip_extractor.go](backend/services/stigmer-server/pkg/domain/skill/storage/zip_extractor.go)` calls `ParseFrontmatter()` during extraction. Test content like `"# Calculator Skill"` no longer passes.

### 3. `CreateLargeUncompressedZip` timeout

`[storage/testutil.go:244](backend/services/stigmer-server/pkg/domain/skill/storage/testutil.go)` writes 550MB byte-by-byte (`f.Write([]byte{b})`), which takes >30s and panics with a test timeout.

---

## Design Decision: Test Helper Strategy

Rather than silently wrapping content with "magic" frontmatter inside `CreateTestZip`, we add an explicit helper:

```go
func ValidSkillContent(name, body string) string
```

This keeps `CreateTestZip(content)` as a raw, "put exactly this in SKILL.md" function (useful for negative tests), and makes test intent visible: every test that expects success explicitly constructs valid content.

---

## Scope: Files to Change


| File                                                                                                                          | Changes                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `[storage/testutil.go](backend/services/stigmer-server/pkg/domain/skill/storage/testutil.go)`                                 | Add `ValidSkillContent` helper; fix `CreateLargeUncompressedZip` to write in chunks                   |
| `[storage/zip_extractor_test.go](backend/services/stigmer-server/pkg/domain/skill/storage/zip_extractor_test.go)`             | 4 tests: use `ValidSkillContent` for frontmatter-compliant content                                    |
| `[controller/push_test.go](backend/services/stigmer-server/pkg/domain/skill/controller/push_test.go)`                         | ~20 tests: add `Org`, use valid frontmatter content, fix assertions                                   |
| `[controller/integration_test.go](backend/services/stigmer-server/pkg/domain/skill/controller/integration_test.go)`           | ~11 tests: add `Org` to requests + references, use valid content                                      |
| `[controller/skill_controller_test.go](backend/services/stigmer-server/pkg/domain/skill/controller/skill_controller_test.go)` | Add `Org` to `createTestSkill`/`createTestAuditRecord` calls and all `ApiResourceReference` instances |


---

## Quality Flag: False-Positive Negative Tests

Three tests currently pass but for the **wrong reason** -- they get `InvalidArgument` from missing `org` (proto validation) instead of the actual validation they intend to test:

- `TestPush_EmptyName` - intends to test empty-name rejection, actually caught by missing org
- `TestPush_EmptyArtifact` - intends to test empty-artifact rejection, actually caught by missing org
- `TestPush_InvalidName` - intends to test invalid-name rejection, actually caught by missing org

These need `Org: "test-org"` added so they test the **correct** validation path. We should fix these too, even though they technically "pass" today.

---

## Step-by-Step Execution

### Step 1: Add `ValidSkillContent` helper + fix `CreateLargeUncompressedZip`

In `[storage/testutil.go](backend/services/stigmer-server/pkg/domain/skill/storage/testutil.go)`:

- Add `ValidSkillContent(name, body string) string` that produces `---\nname: {name}\n---\n{body}`
- Fix `CreateLargeUncompressedZip()`: replace byte-by-byte writes (line 244-246) with chunked writes (e.g., 1MB chunks of varying bytes)

### Step 2: Fix `zip_extractor_test.go`

Update 4 tests to use `ValidSkillContent`:

- `TestExtractSkillMd_Success` 
- `TestExtractSkillMd_ReturnsHash`
- `TestExtractSkillMd_MultipleFiles`
- `TestExtractSkillMd_PreservesContent`

Also update the result assertions -- `result.Name` should now match the frontmatter name, and `result.Content` includes the frontmatter.

### Step 3: Fix `controller/skill_controller_test.go`

- Add `Org: "test-org"` to `createTestSkill` and `createTestAuditRecord` helper calls
- Add `Org: "test-org"` to all `ApiResourceReference` instances in `TestSkillController_GetByReference` and `TestSkillController_GetByReference_AuditVersions`

### Step 4: Fix `controller/push_test.go`

For every test:

- Add `Org: "test-org"` to `PushSkillRequest` where missing
- Replace raw markdown strings with `storage.ValidSkillContent(...)` calls
- Update `Metadata.Name` assertions to expect the kebab-case frontmatter name
- Update `Spec.SkillMd` assertions to expect full content with frontmatter
- Fix the 3 false-positive negative tests (`EmptyName`, `EmptyArtifact`, `InvalidName`)

### Step 5: Fix `controller/integration_test.go`

For every test:

- Add `Org: "test-org"` to `PushSkillRequest` where missing
- Add `Org: "test-org"` to all `ApiResourceReference` instances
- Replace raw markdown with `storage.ValidSkillContent(...)` calls
- Update `Spec.SkillMd` assertions

### Step 6: Run tests and verify

Run the targeted test suites to confirm all fixes:

```bash
cd backend/services/stigmer-server && go test -v -race -timeout 30s ./pkg/domain/skill/...
```

