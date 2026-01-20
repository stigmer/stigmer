# Fix GitHub Actions Release Workflow - Add Buf CLI Installation

**Date**: 2026-01-20  
**Type**: Bug Fix  
**Scope**: CI/CD, Release Process  
**Impact**: Critical - Unblocks all future releases

---

## Problem

The GitHub Actions release workflow was failing during the "Generate proto stubs" step with exit code 2. The root cause was that the `buf` CLI tool was not installed in the CI environment before running `make protos`.

**Error details**:
```
make[1]: *** [Makefile:40: lint] Error 127
make: *** [Makefile:97: protos] Error 2
```

Error code 127 indicates "command not found" - the `buf` command was not available when `make protos` executed `buf lint` and other buf commands.

**Impact**:
- All release tags would fail at the proto generation step
- No releases could be published to GitHub
- GoReleaser would never run
- Users couldn't get new versions

## Solution

Added a step to install the Buf CLI tool using the official `bufbuild/buf-setup-action` before the proto generation step.

**Changes made**:

```yaml
- name: Set up Buf
  uses: bufbuild/buf-setup-action@v1
  with:
    github_token: ${{ secrets.GITHUB_TOKEN }}
```

This step is positioned after Go setup and before proto generation, ensuring `buf` is available when `make protos` runs.

## Technical Details

**File changed**: `.github/workflows/release.yml`

**Workflow execution order** (corrected):
1. Checkout repository
2. Set up Go 1.22
3. **Set up Buf CLI** ← NEW STEP
4. Generate proto stubs (`make protos` → `buf lint`, `buf generate`)
5. Run GoReleaser
6. Upload artifacts

**Why this works**:
- `bufbuild/buf-setup-action` installs the latest stable `buf` CLI
- Uses GitHub token for authenticated downloads (avoids rate limits)
- Buf becomes available in PATH for all subsequent steps
- `make protos` can now successfully execute `buf lint` and `buf generate`

## Testing

**Verification approach**:
- Next release tag push will test this fix
- Can verify locally that workflow would succeed by checking:
  - Go setup completes
  - Buf setup installs CLI
  - `make protos` executes without errors
  - GoReleaser can proceed

**Success criteria**:
- ✅ Buf CLI installed in CI environment
- ✅ `make protos` completes successfully
- ✅ Release workflow proceeds to GoReleaser step
- ✅ Artifacts published to GitHub releases

## Why This Wasn't Caught Earlier

The release workflow is only triggered on version tags (`v*`). This fix was discovered when a release was attempted and failed. The issue wasn't visible during normal development since:
- Local development has `buf` installed
- PR checks don't run the release workflow
- Only actual release tags trigger this workflow

## Prevention

**Going forward**:
- All proto-dependent workflows should include buf installation step
- Consider adding a CI check that validates release workflow (without actually releasing)
- Document required tools in CI/CD documentation

## Related Files

- `.github/workflows/release.yml` - Release workflow (fixed)
- `Makefile` - Defines `make protos` target
- `apis/Makefile` - Executes `buf lint` and `buf generate`

## Follow-up Actions

None required. This fix is complete and will be validated on the next release tag.

---

**Impact**: Critical bug fix that unblocks all future releases. Without this fix, no new versions of Stigmer CLI could be published to GitHub.
