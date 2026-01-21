# Optimize Agent-Runner Binary Workflow

**Date**: 2026-01-21  
**Type**: feat(agent-runner), refactor(workflow)  
**Scope**: agent-runner, CLI daemon, GitHub workflow, Makefiles  
**Impact**: Developer experience, deployment reliability

## Summary

Streamlined agent-runner standalone binary workflow by removing unnecessary complexity, adding automatic download fallback, enhancing developer Makefile targets, and cleaning up CI/CD pipeline. This completes Phase 2.75 of the agent-runner standalone binary project.

## Context

After implementing the BusyBox pattern (Phase 2.5) that reduced CLI size by 24MB, we identified opportunities to simplify the developer workflow and improve end-user reliability:

1. **Environment variable complexity**: `STIGMER_AGENT_RUNNER_BIN` added an extra code path without clear benefit
2. **Missing fallback**: No automatic recovery if agent-runner binary was deleted
3. **Developer workflow gaps**: No clean way to rebuild just agent-runner
4. **CI/CD inefficiency**: Still building obsolete stigmer-server/workflow-runner binaries
5. **Docker remnants**: Agent-runner Makefile still had Docker logic

## What Changed

### 1. Simplified Binary Resolution (`daemon.go`)

**Removed**: `STIGMER_AGENT_RUNNER_BIN` environment variable logic
- Eliminated unnecessary code path
- Reduced developer cognitive load
- Cleaner developer experience using Makefile instead

**Added**: Version-based download fallback
```go
func findAgentRunnerBinary(dataDir string) (string, error) {
    // 1. Check extracted binary (embedded in CLI)
    binPath := filepath.Join(dataDir, "bin", "agent-runner")
    if _, err := os.Stat(binPath); err == nil {
        return binPath, nil
    }
    
    // 2. Download from GitHub releases (fallback)
    version := embedded.GetBuildVersion()
    return downloadAgentRunnerBinary(dataDir, version)
}
```

**Rationale**: Uses CLI version for compatibility - ensures CLI and agent-runner are always from same release.

### 2. Automatic Download Fallback (`download.go`)

**Added**: `downloadAgentRunnerBinary()` function
- Downloads agent-runner from GitHub releases if missing
- Uses CLI version to download matching binary
- Format: `https://github.com/stigmer/stigmer/releases/download/v1.0.0/agent-runner-v1.0.0-darwin-arm64`
- Installs directly to `~/.stigmer/bin/agent-runner`

**Benefit**: Automatic recovery if user accidentally deletes binary (no reinstall needed).

### 3. Enhanced Developer Workflow (Root `Makefile`)

**Added three new targets**:

```makefile
build-agent-runner:         # Build PyInstaller binary
install-agent-runner:       # Build and install to ~/.stigmer/bin
release-local-full:         # Build everything (CLI + agent-runner)
```

**Developer workflows now supported**:
```bash
# Quick CLI rebuild (reuse existing agent-runner)
make release-local

# Full rebuild including agent-runner
make release-local-full

# Just rebuild agent-runner
make install-agent-runner
```

**Benefit**: Clear, documented workflow for agent-runner development iterations.

### 4. Cleaned Up Agent-Runner Makefile

**Removed**: All Docker-related targets
- `docker-build` (obsolete)
- `docker-push` (obsolete)
- `build` (Docker type-checking target)

**Kept**: Only PyInstaller binary targets
- `build-binary`
- `clean-binary`
- `test-binary`
- `rebuild-binary`

**Updated**: Help text to focus on binary builds and reference root Makefile

**Rationale**: Agent-runner is now a standalone binary, not a Docker container.

### 5. Optimized GitHub Workflow (`.github/workflows/release-embedded.yml`)

**Removed obsolete steps** (all three build jobs):
- `Build stigmer-server binary` - Now part of CLI (BusyBox pattern)
- `Build workflow-runner binary` - Now part of CLI (BusyBox pattern)

**Fixed version embedding**:
- Changed: `-X github.com/stigmer/stigmer/client-apps/cli/internal/cli/version.Version=...`
- To: `-X github.com/stigmer/stigmer/client-apps/cli/embedded.buildVersion=...`

**Added agent-runner binary publishing**:
- Creates versioned standalone binaries: `agent-runner-v1.0.0-darwin-arm64`
- Generates SHA256 checksums
- Uploads to GitHub releases as separate artifacts
- **Purpose**: Enables download fallback for corrupted installations

**Benefit**: CI only builds what's actually needed, releases include fallback binaries.

### 6. Updated Version Extraction Logic (`version.go`)

**Changed** binary existence check:
```go
// Before: Check 3 binaries
requiredBinaries := []string{
    "stigmer-server",    // ❌ Now part of CLI
    "workflow-runner",   // ❌ Now part of CLI
    "agent-runner/run.sh", // ❌ Wrong path
}

// After: Check 1 binary
agentRunnerBinary := filepath.Join(binDir, "agent-runner")
if _, err := os.Stat(agentRunnerBinary); os.IsNotExist(err) {
    return true, nil // Need extraction
}
```

**Rationale**: Only agent-runner is embedded now (BusyBox pattern for Go services).

## Technical Details

### Version Strategy

**Q: How do we determine which agent-runner version to download?**

**A: Use the CLI's version**
- CLI version embedded at build time: `-X github.com/stigmer/stigmer/client-apps/cli/embedded.buildVersion=v1.2.3`
- Agent-runner binary built from same commit/tag as CLI
- Download URL uses CLI version for compatibility
- Development builds (version="dev") always re-extract embedded binaries (no download)

### GitHub Release Assets

Each release now includes:
```
# CLI with embedded binaries
stigmer-v1.0.0-darwin-arm64.tar.gz
stigmer-v1.0.0-darwin-amd64.tar.gz
stigmer-v1.0.0-linux-amd64.tar.gz

# Standalone binaries (for download fallback)
agent-runner-v1.0.0-darwin-arm64
agent-runner-v1.0.0-darwin-amd64
agent-runner-v1.0.0-linux-amd64

# Checksums
*.sha256 files for all above
```

### Architecture

**BusyBox Pattern** (Go components):
```
stigmer CLI (single binary)
├── stigmer-server code (compiled in)
├── workflow-runner code (compiled in)
└── agent-runner (embedded PyInstaller binary)
    ↓
    Extracted to ~/.stigmer/bin/agent-runner on first run
```

**Fallback Download Logic**:
```
1. Check ~/.stigmer/bin/agent-runner
   ↓ exists?
   ├─ YES → Use it
   └─ NO → Download from GitHub releases
           ↓
           Format: agent-runner-{CLI_VERSION}-{OS}-{ARCH}
           ↓
           Install to ~/.stigmer/bin/agent-runner
           ↓
           Use it
```

## End-User Impact

### Homebrew Install (No Change Needed)
```bash
brew install stigmer
stigmer server
# ✓ Works as before - extracts embedded binary
```

### Automatic Recovery (NEW)
```bash
# User accidentally deletes binary
rm ~/.stigmer/bin/agent-runner

# CLI automatically recovers
stigmer server
# ✓ Detects missing binary
# ✓ Downloads from GitHub releases (matching CLI version)
# ✓ Continues startup normally
```

**Benefit**: No reinstall needed for corrupted installations.

## Developer Impact

### Before (No Clean Workflow)
```bash
# Developer changes agent-runner code
# How to test?
# → Set STIGMER_AGENT_RUNNER_BIN env var? (confusing)
# → Manually copy binary? (error-prone)
# → Rebuild entire CLI? (slow)
```

### After (Clean Makefile Workflow)
```bash
# Quick CLI rebuild
make release-local

# Full rebuild (CLI + agent-runner)
make release-local-full

# Just rebuild agent-runner
make install-agent-runner
stigmer server  # Uses updated binary
```

**Benefit**: Clear, documented workflow for rapid iteration.

## Design Decisions

### Why Remove STIGMER_AGENT_RUNNER_BIN?

**Before**: Developer sets env var
```bash
export STIGMER_AGENT_RUNNER_BIN=/path/to/dist/agent-runner
stigmer server
```

**After**: Developer uses Makefile
```bash
make install-agent-runner
stigmer server
```

**Benefits**:
- ✅ One less code path to maintain
- ✅ Cleaner developer experience
- ✅ Consistent with BusyBox philosophy
- ✅ YAGNI principle (You Aren't Gonna Need It)

### Why Version-Based Downloads?

**Alternative**: Always download latest version

**Chosen**: Download version matching CLI

**Benefits**:
- ✅ Ensures compatibility (same release = same components)
- ✅ Predictable behavior
- ✅ Users can stay on specific versions
- ✅ CI/CD releases are atomic

### Why Publish Standalone Agent-Runner Binaries?

**Purpose**: Fallback for corrupted installations

**Alternative**: Force user to reinstall via Homebrew

**Benefits**:
- ✅ Better UX (automatic recovery)
- ✅ No need to reinstall entire CLI
- ✅ Faster recovery (download single binary vs full reinstall)

## Files Modified

```
✅ client-apps/cli/internal/cli/daemon/daemon.go
✅ client-apps/cli/internal/cli/daemon/download.go
✅ client-apps/cli/embedded/version.go
✅ Makefile (root)
✅ backend/services/agent-runner/Makefile
✅ .github/workflows/release-embedded.yml
```

## Testing

### Verified Compilation
```bash
cd client-apps/cli
go build -o /tmp/stigmer .
# ✓ Compiles without errors
```

### Testing Checklist Created
Comprehensive testing guide documented in:
- `_projects/2026-01/20260121.03.agent-runner-standalone-binary/tasks/TESTING_CHECKLIST.md`

Covers:
- Developer workflow tests (quick rebuild, full rebuild, agent-runner only)
- Daemon startup tests (normal path, download fallback)
- Version extraction tests
- BusyBox pattern verification
- Clean build from scratch
- GitHub workflow validation

## Phase Progression

**Project**: Agent-Runner Standalone Binary  
**Phase 2.75**: ✅ **Complete** - Workflow Optimization

**Previous phases**:
- ✅ Phase 1: PyInstaller binary build infrastructure
- ✅ Phase 2: Hybrid PyInstaller embedding
- ✅ Phase 2.5: BusyBox pattern refactoring (24MB reduction)

**Next phase**:
- ⏳ Phase 3: Testing and release (local tests, CI tests, v2.0.0 release)

## Metrics

**Code simplification**:
- Removed: 1 environment variable code path
- Removed: 1 obsolete function (`findAgentRunnerScript`)
- Removed: 6 GitHub workflow build steps (2 per platform × 3 platforms)
- Removed: 3 Docker-related Makefile targets
- Added: 1 download fallback function
- Added: 3 developer Makefile targets

**Developer experience**:
- **Before**: Unclear how to rebuild agent-runner
- **After**: `make install-agent-runner`

**End-user experience**:
- **Before**: Corrupted installation requires full reinstall
- **After**: Automatic recovery via download

## References

- **Implementation Summary**: `_projects/2026-01/20260121.03.agent-runner-standalone-binary/tasks/IMPLEMENTATION_SUMMARY.md`
- **Testing Guide**: `_projects/2026-01/20260121.03.agent-runner-standalone-binary/tasks/TESTING_CHECKLIST.md`
- **Project README**: `_projects/2026-01/20260121.03.agent-runner-standalone-binary/README.md`
- **ADR**: `_cursor/adr-use-python-binary.md`

## Future Considerations

**When to revisit**:
- If download fallback proves unreliable (network issues, rate limiting)
- If developers need more flexible binary management (custom builds)
- If agent-runner moves to different distribution model

**Potential enhancements**:
- Cache downloaded binaries across versions
- Support custom binary URLs (for enterprise deployments)
- Add binary verification (signature checking)

## Related Changes

This change builds on:
- Phase 2: Hybrid PyInstaller embedding (embedded agent-runner in CLI)
- Phase 2.5: BusyBox pattern (eliminated Go runtime duplication)

This change enables:
- Phase 3: Testing and release (CI workflow is now clean)
- Future: Homebrew formula simplicity (single binary installation)

---

**Result**: Clean, maintainable workflow for agent-runner binary management with automatic recovery for corrupted installations. Developer experience improved with clear Makefile targets. CI/CD streamlined by removing obsolete builds.
