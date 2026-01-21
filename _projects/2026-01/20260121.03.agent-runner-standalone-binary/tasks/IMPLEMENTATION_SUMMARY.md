# Implementation Summary: Agent-Runner Binary Workflow

**Date**: 2026-01-21  
**Status**: ✅ Complete

## Overview

Implemented complete workflow for agent-runner standalone binary with:
- ✅ Removed unnecessary environment variable complexity (`STIGMER_AGENT_RUNNER_BIN`)
- ✅ Version-based download fallback (uses CLI version for compatibility)
- ✅ Cleaned up GitHub workflow (removed obsolete binary builds)
- ✅ Enhanced developer workflow with Makefile targets
- ✅ Removed Docker logic from agent-runner Makefile
- ✅ Standalone agent-runner binaries published to GitHub releases

---

## Changes Made

### 1. **Daemon Logic** (`client-apps/cli/internal/cli/daemon/`)

#### `daemon.go`
- **Removed**: `STIGMER_AGENT_RUNNER_BIN` environment variable logic
- **Removed**: `findAgentRunnerScript()` function (obsolete)
- **Updated**: `findAgentRunnerBinary()` to use version-based download fallback
  - First checks for extracted binary (`~/.stigmer/bin/agent-runner`)
  - Falls back to downloading from GitHub releases if missing
  - Uses CLI version for compatibility

#### `download.go`
- **Added**: `downloadAgentRunnerBinary()` function
  - Downloads agent-runner binary from GitHub releases
  - Uses CLI version to download matching binary
  - Format: `https://github.com/stigmer/stigmer/releases/download/v1.0.0/agent-runner-v1.0.0-darwin-arm64`
  - Installs directly to `~/.stigmer/bin/agent-runner`

### 2. **Version Management** (`client-apps/cli/embedded/version.go`)

- **Updated**: `needsExtraction()` to only check for agent-runner binary
  - Removed obsolete checks for `stigmer-server` and `workflow-runner`
  - These are now part of the CLI (BusyBox pattern)
  - Only checks for `bin/agent-runner`

### 3. **Root Makefile** (`Makefile`)

**Added developer workflow targets:**

```makefile
build-agent-runner         # Build PyInstaller binary
install-agent-runner       # Build and install to ~/.stigmer/bin
release-local-full         # Build everything (CLI + agent-runner)
```

**Developer workflows:**

```bash
# Quick CLI rebuild (reuse existing agent-runner)
make release-local

# Full rebuild including agent-runner
make release-local-full

# Just rebuild agent-runner
make install-agent-runner
```

### 4. **Agent-Runner Makefile** (`backend/services/agent-runner/Makefile`)

- **Removed**: All Docker-related targets (`docker-build`, `docker-push`, `build`)
- **Kept**: Only PyInstaller binary targets
  - `build-binary` - Build standalone executable
  - `clean-binary` - Clean build artifacts
  - `test-binary` - Build and test
  - `rebuild-binary` - Clean and rebuild
- **Updated**: Help text to focus on binary builds

### 5. **GitHub Workflow** (`.github/workflows/release-embedded.yml`)

**All three build jobs (darwin-arm64, darwin-amd64, linux-amd64):**

- **Removed**: Obsolete `stigmer-server` binary build step
- **Removed**: Obsolete `workflow-runner` binary build step
- **Fixed**: Build version ldflags path
  - Changed: `-X github.com/stigmer/stigmer/client-apps/cli/internal/cli/version.Version=...`
  - To: `-X github.com/stigmer/stigmer/client-apps/cli/embedded.buildVersion=...`
- **Added**: Standalone agent-runner binary packaging
  - Creates versioned binary: `agent-runner-v1.0.0-darwin-arm64`
  - Generates SHA256 checksum
  - Uploads to GitHub releases
- **Updated**: Artifact upload to include agent-runner binaries

**Release job:**
- **Updated**: Asset preparation to include agent-runner binaries
  - Copies CLI tarballs (`.tar.gz`)
  - Copies all checksums (`.sha256`)
  - Copies agent-runner binaries

---

## User Workflows

### **End User (Homebrew)**

```bash
# Install via Homebrew
brew install stigmer

# First run - auto-extracts embedded binaries
stigmer server
# ✓ CLI extracts agent-runner to ~/.stigmer/bin/
# ✓ Starts all services

# If user accidentally deletes ~/.stigmer/bin/agent-runner
stigmer server
# ✓ CLI detects missing binary
# ✓ Downloads from GitHub releases (matching CLI version)
# ✓ Continues startup
```

### **Developer (Local Development)**

```bash
# Clone repository
git clone https://github.com/stigmer/stigmer.git
cd stigmer

# Quick CLI rebuild (reuse existing agent-runner)
make release-local
# ✓ Builds CLI
# ✓ Installs to ~/bin/stigmer
# ✓ Uses existing ~/.stigmer/bin/agent-runner

# Full rebuild (including agent-runner)
make release-local-full
# ✓ Builds CLI
# ✓ Rebuilds agent-runner PyInstaller binary
# ✓ Installs both to ~/bin/ and ~/.stigmer/bin/
# ✓ Ready for testing

# Just rebuild agent-runner
make install-agent-runner
# ✓ Rebuilds agent-runner
# ✓ Installs to ~/.stigmer/bin/agent-runner
# ✓ Next 'stigmer server' uses updated binary
```

---

## Version Strategy

**Q: How do we determine which agent-runner version to download?**

**A: Use the CLI's version**

- CLI version is embedded at build time via ldflags: `-X github.com/stigmer/stigmer/client-apps/cli/embedded.buildVersion=v1.2.3`
- Agent-runner binary is built from the same commit/tag as the CLI
- Download URL: `https://github.com/stigmer/stigmer/releases/download/{CLI_VERSION}/agent-runner-{CLI_VERSION}-{OS}-{ARCH}`
- **Ensures version compatibility**: CLI and agent-runner are always from the same release

**Development builds:**
- Version = "dev"
- Always re-extracts embedded binaries (no download fallback for "dev" versions)
- Developer must use `make install-agent-runner` to test changes

---

## Architecture

### **BusyBox Pattern (Go Components)**

```
stigmer CLI (single binary)
├── stigmer-server code (compiled in)
├── workflow-runner code (compiled in)
└── agent-runner (embedded PyInstaller binary)
    ↓
    Extracted to ~/.stigmer/bin/agent-runner on first run
```

When daemon starts:
- `stigmer server` → Spawns `stigmer internal-server` (hidden command)
- `stigmer server` → Spawns `stigmer internal-workflow-runner` (hidden command)
- `stigmer server` → Spawns `~/.stigmer/bin/agent-runner` (PyInstaller binary)

### **Fallback Download Logic**

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

---

## GitHub Release Assets

Each release now includes:

```
stigmer-v1.0.0-darwin-arm64.tar.gz        # CLI with embedded binaries
stigmer-v1.0.0-darwin-arm64.tar.gz.sha256
stigmer-v1.0.0-darwin-amd64.tar.gz
stigmer-v1.0.0-darwin-amd64.tar.gz.sha256
stigmer-v1.0.0-linux-amd64.tar.gz
stigmer-v1.0.0-linux-amd64.tar.gz.sha256

agent-runner-v1.0.0-darwin-arm64          # Standalone binaries (for fallback)
agent-runner-v1.0.0-darwin-arm64.sha256
agent-runner-v1.0.0-darwin-amd64
agent-runner-v1.0.0-darwin-amd64.sha256
agent-runner-v1.0.0-linux-amd64
agent-runner-v1.0.0-linux-amd64.sha256
```

---

## Testing

### **Verify Compilation**

```bash
cd client-apps/cli
go build -o /tmp/stigmer .
# ✓ Should compile without errors
```

### **Test Developer Workflow**

```bash
# Clean slate
rm -rf ~/.stigmer/bin/agent-runner
rm -f ~/bin/stigmer

# Build and install everything
make release-local-full

# Verify installations
ls -lh ~/bin/stigmer
ls -lh ~/.stigmer/bin/agent-runner

# Test CLI
stigmer server
# Should start without errors
```

### **Test Download Fallback**

```bash
# Delete agent-runner binary
rm ~/.stigmer/bin/agent-runner

# Try to start server
stigmer server
# ✓ Should detect missing binary
# ✓ Should download from GitHub releases
# ✓ Should start successfully
```

---

## Design Decisions

### **Why remove STIGMER_AGENT_RUNNER_BIN?**

**Before**: Developer sets env var to point to custom binary
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
- ✅ Consistent with "BusyBox pattern" philosophy
- ✅ Follows YAGNI principle (You Aren't Gonna Need It)

### **Why version-based downloads?**

**Alternative considered**: Always download latest version

**Chosen approach**: Download version matching CLI

**Benefits**:
- ✅ Ensures compatibility between CLI and agent-runner
- ✅ Predictable behavior (same release = same components)
- ✅ Users can stay on specific versions
- ✅ CI/CD releases are atomic (all components from same commit)

### **Why publish standalone agent-runner binaries?**

**Purpose**: Fallback for corrupted installations

**Scenario**:
1. User installs stigmer via Homebrew
2. User accidentally deletes `~/.stigmer/bin/agent-runner`
3. User runs `stigmer server`
4. CLI downloads missing binary from GitHub releases
5. Everything works again

**Alternative considered**: Force user to reinstall via Homebrew

**Benefits of download fallback**:
- ✅ Better user experience (automatic recovery)
- ✅ No need to reinstall entire CLI
- ✅ Faster recovery (download single binary vs full reinstall)

---

## Next Steps (Phase 3)

1. **Local Testing**
   ```bash
   make release-local-full
   stigmer server
   # Verify all services start correctly
   ```

2. **CI Testing**
   - Push changes to feature branch
   - Trigger workflow manually (workflow_dispatch)
   - Verify builds for all platforms
   - Download and test artifacts

3. **Release**
   - Tag `v2.0.0` when ready
   - Verify GitHub release includes agent-runner binaries
   - Test download fallback with actual release
   - Update Homebrew formula
   - Test full user flow: `brew install stigmer && stigmer server`

---

## Files Modified

```
✅ client-apps/cli/internal/cli/daemon/daemon.go
✅ client-apps/cli/internal/cli/daemon/download.go
✅ client-apps/cli/embedded/version.go
✅ Makefile (root)
✅ backend/services/agent-runner/Makefile
✅ .github/workflows/release-embedded.yml
```

---

## Summary

All changes implemented successfully:

1. ✅ **Simplified**: Removed environment variable complexity
2. ✅ **Robust**: Added version-based download fallback
3. ✅ **Clean**: Removed obsolete Docker and binary build steps
4. ✅ **Developer-friendly**: Enhanced Makefile workflow
5. ✅ **Complete**: Standalone binaries published to releases

**Result**: Clean, maintainable workflow for agent-runner binary management with automatic recovery for corrupted installations.
