# Tasks

## Task 1: Research and Design Embedding Strategy
**Status**: ✅ COMPLETED

### Goals
- Finalize platform detection strategy (macOS arm64/amd64, Linux amd64)
- Design extraction logic (where, when, error handling)
- Decide on checksum verification approach
- Design clean error messages for missing binaries

### Subtasks
- [x] Document platform detection logic
- [x] Design extraction directory structure (`~/.stigmer/bin/`)
- [x] Define extraction triggers (first run, version mismatch)
- [x] Design error messages (binary missing, extraction failed)
- [x] Decide on checksum approach (SHA256 verification?)

### Acceptance Criteria
- [x] Clear design document in `notes.md`
- [x] Platform detection strategy defined
- [x] Extraction flow documented
- [x] Error handling strategy clear

### Key Decisions Made
1. **Platform Detection**: Use `runtime.GOOS` and `runtime.GOARCH`
2. **Extraction**: First run + version mismatch detection
3. **Location**: `~/.stigmer/bin/` with `.version` marker file
4. **Checksums**: Skip for v1 (can add in v2 if needed)
5. **No Fallbacks**: Production uses only extracted binaries
6. **Dev Mode**: Use env vars only (`STIGMER_SERVER_BIN`, etc.)

---

## Task 2: Implement Binary Embedding with Go Embed
**Status**: ✅ COMPLETED

### Goals
- Create `client-apps/cli/embedded/` directory structure
- Add Go embed directives for all 4 binaries
- Implement platform selection logic
- Add extraction functions

### Subtasks
- [x] Create `client-apps/cli/embedded/` directory
- [x] Add embed directives for stigmer-server (per platform)
- [x] Add embed directives for workflow-runner (per platform)
- [x] Add embed directive for agent-runner.tar.gz
- [x] Implement `GetStigmerServerBinary()` (platform detection)
- [x] Implement `GetWorkflowRunnerBinary()` (platform detection)
- [x] Implement `extractBinary()` function
- [x] Implement `extractTarball()` function (for agent-runner)
- [x] Add version checking with `.version` file
- [x] Add `EnsureBinariesExtracted()` orchestrator function
- [x] Skip checksum verification (v1 decision)

### Acceptance Criteria
- [x] All binaries embedded correctly
- [x] Platform detection works (darwin_arm64, darwin_amd64, linux_amd64)
- [x] Extraction functions implemented
- [x] Binaries executable after extraction (0755 permissions)
- [x] Version checking prevents unnecessary re-extraction
- [x] Code compiles successfully

### Files Created
- `client-apps/cli/embedded/embedded.go` - Platform detection, embed directives, binary getters
- `client-apps/cli/embedded/extract.go` - Extraction logic for binaries and tarballs
- `client-apps/cli/embedded/version.go` - Version checking and comparison
- `client-apps/cli/embedded/README.md` - Comprehensive package documentation
- `client-apps/cli/embedded/binaries/` - Directory structure for embedded binaries (with placeholders)

---

## Task 3: Update Daemon Management to Use Extracted Binaries
**Status**: ⏸️ TODO

### Goals
- Modify `daemon.go` to use extracted binaries ONLY
- Remove all development fallback paths
- Add `ensureBinariesExtracted()` call on daemon start
- Update `findServerBinary()`, `findWorkflowRunnerBinary()`, `findAgentRunnerScript()`

### Subtasks
- [ ] Add `ensureBinariesExtracted(dataDir)` to `Start()` function
- [ ] Rewrite `findServerBinary()` - use only `~/.stigmer/bin/stigmer-server`
- [ ] Rewrite `findWorkflowRunnerBinary()` - use only `~/.stigmer/bin/workflow-runner`
- [ ] Rewrite `findAgentRunnerScript()` - use only `~/.stigmer/bin/agent-runner/run.sh`
- [ ] Remove ALL development path searches (no fallbacks!)
- [ ] Add clean error messages if binaries missing
- [ ] Support dev mode via env vars ONLY (`STIGMER_DEV_MODE=true`)

### Acceptance Criteria
- Daemon only uses extracted binaries
- No fallback paths in production code
- Clear errors if binaries missing
- Dev mode optional (env var only)

---

## Task 4: Update Build Scripts (Makefile)
**Status**: ⏸️ TODO

### Goals
- Add targets to build embedded binaries
- Integrate embedding into release process
- Test multi-platform builds

### Subtasks
- [ ] Add `build-embedded-stigmer-server` target (per platform)
- [ ] Add `build-embedded-workflow-runner` target (per platform)
- [ ] Add `build-embedded-agent-runner` target (tarball creation)
- [ ] Update `release-local` to build embedded binaries first
- [ ] Test builds for macOS arm64, macOS amd64
- [ ] Document build process in Makefile comments
- [ ] Ensure Bazel compatibility (if needed)

### Acceptance Criteria
- `make release-local` produces CLI with embedded binaries
- Binaries correct for target platform
- Build process documented
- Works on developer machines

---

## Task 5: Remove Development Fallbacks (Clean Production Code)
**Status**: ⏸️ TODO

### Goals
- Audit all binary search code
- Remove development paths from production
- Ensure dev mode uses env vars only
- Update documentation

### Subtasks
- [ ] Audit `daemon.go` for any remaining fallback paths
- [ ] Remove `findWorkspaceRoot()` usage in production paths
- [ ] Remove Bazel build path searches in production
- [ ] Ensure env vars work for dev mode (`STIGMER_SERVER_BIN`, etc.)
- [ ] Update code comments to explain production vs dev
- [ ] Add runtime check: warn if dev env vars set in production build

### Acceptance Criteria
- No development paths in binary search logic
- Production build ignores dev paths
- Dev mode clearly separated (env vars only)
- Code is clean and maintainable

---

## Task 6: Test Single-Binary Distribution
**Status**: ⏸️ TODO

### Goals
- Test fresh install scenario
- Test binary extraction
- Test daemon startup with extracted binaries
- Measure binary size and extraction time

### Subtasks
- [ ] Build release binary with embedded components
- [ ] Delete `~/.stigmer/` to simulate fresh install
- [ ] Run `stigmer server` and verify extraction
- [ ] Verify all 4 components start correctly
- [ ] Test `stigmer server stop` and `stigmer server restart`
- [ ] Measure final binary size (should be < 200 MB)
- [ ] Measure extraction time (should be < 5 seconds)
- [ ] Test on clean macOS VM (no dev environment)

### Acceptance Criteria
- Fresh install works perfectly
- All components extracted and running
- Binary size acceptable (< 200 MB)
- Extraction fast (< 5 seconds)
- No errors or warnings
- Ready for Homebrew distribution

---

## Summary

**Total Tasks**: 6  
**Completed**: 2  
**In Progress**: 0  
**Todo**: 4

**Estimated Time**: 3-4 hours total  
**Time Spent**: ~1.5 hours (Tasks 1-2)
