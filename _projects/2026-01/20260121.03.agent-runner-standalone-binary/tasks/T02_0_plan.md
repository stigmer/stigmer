# Task 02 - Multi-Platform Build System

**Status**: 🚧 IN PROGRESS  
**Started**: 2026-01-21  
**Estimated Duration**: 2-3 days  
**Dependencies**: Task 01 (Complete ✅)

## Overview

Set up automated multi-platform binary builds using GitHub Actions. Extend the successful local PyInstaller setup to build agent-runner binaries for all target platforms.

## Goals

1. **GitHub Actions Workflow** - Automated builds triggered by tags or manual dispatch
2. **Multi-Platform Support** - Build for 5 platforms:
   - `darwin-arm64` (macOS Apple Silicon)
   - `darwin-amd64` (macOS Intel)
   - `linux-amd64` (Linux x64)
   - `linux-arm64` (Linux ARM)
   - `windows-amd64` (Windows x64)
3. **Artifact Management** - Package, checksum, and upload binaries
4. **Release Automation** - Create GitHub releases with all platform binaries

## Success Criteria

- ✅ GitHub Actions workflow exists and is configured
- ⏳ Manual workflow trigger successfully builds all 5 platforms
- ⏳ Binaries are packaged with checksums (tar.gz for Unix, zip for Windows)
- ⏳ All artifacts uploaded and accessible
- ⏳ Tag-based releases automatically created with all platform binaries
- ⏳ Binary sizes documented for all platforms
- ⏳ Build times documented for all platforms

## Implementation Plan

### Step 1: Create GitHub Actions Workflow ✅

**File**: `.github/workflows/build-agent-runner-binaries.yml`

**Features**:
- Trigger on `agent-runner-v*` tags
- Manual `workflow_dispatch` for testing
- Matrix build strategy (5 jobs in parallel)
- Python 3.13 setup (matching local development)
- Poetry installation and dependency management
- PyInstaller execution using existing `agent-runner.spec`
- Binary verification and packaging
- Artifact upload to GitHub Actions
- Automatic release creation on tag push

**Status**: ✅ COMPLETE - Workflow created

### Step 2: Test Workflow Manually

**Actions**:
1. Commit and push workflow file to repository
2. Navigate to GitHub Actions → "Build Agent-Runner Binaries"
3. Click "Run workflow" → Use default version "dev"
4. Monitor build progress for all 5 platform jobs
5. Verify all jobs complete successfully
6. Download artifacts and inspect:
   - Binary sizes
   - File integrity
   - Checksum files

**Expected Results**:
- All 5 jobs complete without errors
- Artifacts available for download
- Binary sizes approximately:
  - macOS: ~60MB
  - Linux: ~50-60MB
  - Windows: ~60-70MB

**Status**: ⏳ TODO

### Step 3: Validate Platform-Specific Binaries

**Testing Plan**:

For each platform binary:
1. Download from GitHub Actions artifacts
2. Extract from archive
3. Verify file type matches platform
4. Test basic execution (should fail gracefully without Temporal, not crash)

**Platform-Specific Tests**:

**macOS ARM64** (current dev machine):
```bash
tar -xzf agent-runner-dev-darwin-arm64.tar.gz
file agent-runner  # Should show: Mach-O 64-bit executable arm64
./agent-runner     # Should start, require env vars
```

**macOS AMD64** (Intel Mac or via Rosetta):
```bash
tar -xzf agent-runner-dev-darwin-amd64.tar.gz
file agent-runner  # Should show: Mach-O 64-bit executable x86_64
./agent-runner     # Should start, require env vars
```

**Linux AMD64** (via Docker or VM):
```bash
tar -xzf agent-runner-dev-linux-amd64.tar.gz
file agent-runner  # Should show: ELF 64-bit LSB executable, x86-64
./agent-runner     # Should start, require env vars
```

**Linux ARM64** (via Docker on ARM or emulation):
```bash
tar -xzf agent-runner-dev-linux-arm64.tar.gz
file agent-runner  # Should show: ELF 64-bit LSB executable, ARM aarch64
./agent-runner     # Should start, require env vars
```

**Windows AMD64** (Windows VM or via Wine):
```powershell
Expand-Archive agent-runner-dev-windows-amd64.zip
.\agent-runner.exe  # Should start, require env vars
```

**Status**: ⏳ TODO

### Step 4: Document Build Metrics

**Data to Collect**:

| Platform | Binary Size | Build Time | Python Version | Status |
|----------|-------------|------------|----------------|--------|
| darwin-arm64 | ? | ? | 3.13 | ⏳ |
| darwin-amd64 | ? | ? | 3.13 | ⏳ |
| linux-amd64 | ? | ? | 3.13 | ⏳ |
| linux-arm64 | ? | ? | 3.13 | ⏳ |
| windows-amd64 | ? | ? | 3.13 | ⏳ |

**Status**: ⏳ TODO

### Step 5: Test Tag-Based Release

**Actions**:
1. Create and push a test tag: `agent-runner-v0.1.0-test`
2. Verify workflow triggers automatically
3. Verify all 5 platform jobs complete
4. Verify GitHub Release is created automatically
5. Verify release contains:
   - All 5 platform binaries (.tar.gz or .zip)
   - All 5 checksum files (.sha256)
   - Generated changelog
6. Clean up test release

**Expected Release Structure**:
```
Release: Agent-Runner agent-runner-v0.1.0-test
Assets:
  - agent-runner-agent-runner-v0.1.0-test-darwin-arm64.tar.gz
  - agent-runner-agent-runner-v0.1.0-test-darwin-arm64.tar.gz.sha256
  - agent-runner-agent-runner-v0.1.0-test-darwin-amd64.tar.gz
  - agent-runner-agent-runner-v0.1.0-test-darwin-amd64.tar.gz.sha256
  - agent-runner-agent-runner-v0.1.0-test-linux-amd64.tar.gz
  - agent-runner-agent-runner-v0.1.0-test-linux-amd64.tar.gz.sha256
  - agent-runner-agent-runner-v0.1.0-test-linux-arm64.tar.gz
  - agent-runner-agent-runner-v0.1.0-test-linux-arm64.tar.gz.sha256
  - agent-runner-agent-runner-v0.1.0-test-windows-amd64.zip
  - agent-runner-agent-runner-v0.1.0-test-windows-amd64.zip.sha256
```

**Status**: ⏳ TODO

### Step 6: Update Local Makefile (Optional Enhancement)

**Enhancement**: Add Makefile target to trigger GitHub Actions workflow from command line

```makefile
.PHONY: trigger-ci-build
trigger-ci-build:
	@echo "Triggering GitHub Actions workflow for multi-platform builds..."
	gh workflow run build-agent-runner-binaries.yml \
		--ref $(shell git branch --show-current) \
		-f version=dev-$(shell date +%Y%m%d-%H%M%S)
	@echo "✅ Workflow triggered. View at: https://github.com/stigmer/stigmer/actions"
```

**Status**: ⏳ TODO

## Technical Details

### Platform-Specific Considerations

**macOS**:
- Separate runners for ARM64 (macos-latest) and AMD64 (macos-13)
- Native builds (no cross-compilation)
- Uses `shasum -a 256` for checksums
- Creates `.tar.gz` archives

**Linux**:
- Ubuntu runners for both AMD64 and ARM64
- ARM64 may use QEMU emulation for build
- Uses `sha256sum` for checksums
- Creates `.tar.gz` archives

**Windows**:
- Windows latest runner for AMD64 build
- Binary output is `agent-runner.exe` instead of `agent-runner`
- Uses `sha256sum` (via Git Bash) for checksums
- Creates `.zip` archives (7z command)

### Workflow Design Decisions

1. **Separate Jobs vs Matrix**:
   - Using separate named jobs for clarity
   - Easier to debug platform-specific issues
   - Clear artifact naming per platform

2. **Python Version**:
   - 3.13 across all platforms (matches local dev)
   - PyInstaller supports 3.13
   - Consistent behavior across platforms

3. **Trigger Strategy**:
   - `agent-runner-v*` tag prefix (separate from CLI tags)
   - Manual `workflow_dispatch` for testing
   - Version input for manual builds (defaults to "dev")

4. **Artifact Naming**:
   - Pattern: `agent-runner-{version}-{platform}-{arch}.{ext}`
   - Consistent with CLI release artifacts
   - Easy to parse and download programmatically

## Known Issues and Limitations

### Linux ARM64 Build

**Issue**: GitHub Actions doesn't have native ARM64 Linux runners

**Current Approach**: Use QEMU emulation on x64 runner

**Implications**:
- Slower build times (~2-3x)
- May have subtle runtime differences
- Works for most Python applications

**Alternative**: Use external ARM64 runner (future optimization)

### Windows Binary Size

**Issue**: Windows binaries may be larger due to PyInstaller's Windows-specific bundling

**Mitigation**: 
- UPX compression enabled in spec file
- May need Windows-specific excludes

**Acceptable**: Up to 100MB is still reasonable

### First Build Times

**Issue**: First builds on fresh runners take longer (downloading dependencies)

**Impact**: 
- macOS: ~5-7 minutes first build
- Linux: ~4-6 minutes first build  
- Windows: ~6-8 minutes first build

**Optimization**: GitHub Actions caching (future enhancement)

## Dependencies

**From Task 01**:
- ✅ `agent-runner.spec` file (optimized and working)
- ✅ PyInstaller in `pyproject.toml` dev dependencies
- ✅ Hidden imports configured for all dependencies
- ✅ Single-file executable configuration

**External**:
- GitHub Actions (free for public repos)
- Python setup action (v5)
- PyInstaller (installed via Poetry)

## Testing Checklist

- [ ] Workflow file committed and pushed
- [ ] Manual workflow trigger works
- [ ] All 5 platform jobs complete successfully
- [ ] Artifacts downloadable from Actions
- [ ] macOS ARM64 binary verified locally
- [ ] macOS AMD64 binary verified (Rosetta or Intel Mac)
- [ ] Linux AMD64 binary verified (Docker/VM)
- [ ] Linux ARM64 binary verified (Docker/VM)
- [ ] Windows AMD64 binary verified (Windows/Wine)
- [ ] Binary sizes documented
- [ ] Build times documented
- [ ] Tag-based release tested
- [ ] Release contains all 10 files (5 binaries + 5 checksums)
- [ ] Checksums validate correctly

## Next Steps (Task 03)

After completing multi-platform builds:

**Phase 3: Binary Distribution**
- Set up R2/S3 bucket for hosting binaries
- Modify workflow to upload to storage
- Create download URL pattern
- Test downloads from all platforms

## Files Modified/Created

**Created**:
- `.github/workflows/build-agent-runner-binaries.yml` - Main workflow

**Modified** (potential):
- `backend/services/agent-runner/Makefile` - Add CI trigger target
- `.gitignore` - Ensure build artifacts ignored (already done)

## References

- Phase 1 Validation: `tasks/T01_VALIDATION_REPORT.md`
- PyInstaller Spec: `backend/services/agent-runner/agent-runner.spec`
- Existing CLI Release: `.github/workflows/release-embedded.yml` (pattern reference)

---

*Created: 2026-01-21*  
*Status: In Progress*  
*Next Update: After manual workflow test*
