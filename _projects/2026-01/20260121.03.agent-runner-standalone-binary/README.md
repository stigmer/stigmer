# Agent-Runner Standalone Binary

**Created**: 2026-01-21  
**Completed**: 2026-01-21 (Phase 2.75)  
**Status**: ✅ Workflow Optimization Complete  
**Type**: Multi-day Project (2 weeks, Phase 2.75 of 5 complete)  
**Project Path**: `_projects/2026-01/20260121.03.agent-runner-standalone-binary/`

## Overview

Transform agent-runner from shell script + Poetry architecture to standalone executable binary using PyInstaller. Follow Temporal's pattern: "Download binary → Run". Eliminate Python environment management for users.

## Problem Statement

**Current architecture** (inconsistent and fragile):
```
stigmer-server:    Go binary (self-contained) ✅
workflow-runner:   Go binary (self-contained) ✅
temporal:          Downloaded binary ✅
agent-runner:      Shell script → Poetry → Python ❌
```

**The Pattern We Want**:
```
temporal:       Download binary → Run ✅
agent-runner:   Download binary → Run 🎯
```

**Current failure modes**:
- User doesn't have Python
- User has wrong Python version
- User doesn't have Poetry or it's not in PATH
- `poetry install` fails (network issues, conflicting dependencies)
- Platform-specific Python environment issues

## Goal

**Architecture Consistency**: Make agent-runner behave exactly like Temporal.

Both are downloaded binaries managed by the stigmer daemon. User never sees "Python" - just two processes downloading and running.

**Key Insight** (from ADR and Gemini conversation):
- We don't need to manage Python environments (venvs/pip) on user machines
- PyInstaller bundles Python interpreter + dependencies into single executable
- Daemon downloads platform-specific binary to `~/.stigmer/bin/agent-runner`
- Zero dependencies, uniform lifecycle management

## Timeline

**2 weeks** (5 phases)

## Technology Stack

- **PyInstaller** - Python-to-binary compilation
- **Python** - agent-runner implementation (unchanged)
- **Go** - Daemon integration for binary download/management
- **GitHub Actions** - Multi-platform binary compilation
- **R2/S3** - Binary distribution (e.g., releases.stigmer.ai)
- **Bazel/Make** - Build orchestration

## Project Type

**Refactoring/Migration** - Architectural transformation

## Affected Components

1. **backend/services/agent-runner/** - PyInstaller config, build scripts, optimization
2. **.github/workflows/** - Multi-platform binary compilation workflow
3. **client-apps/cli/** - Binary download logic, lifecycle management
4. **Build system** - Makefile targets for binary builds
5. **Distribution** - R2/S3 bucket setup for hosting binaries
6. **Homebrew formula** - Version coordination with binary releases
7. **Documentation** - Developer guide, user guide, troubleshooting

## Success Criteria

### Binary Build
- ✅ PyInstaller produces single-file executables
- ✅ Multi-platform support:
  - Linux: amd64, arm64
  - macOS: amd64 (Intel), arm64 (Apple Silicon)
  - Windows: amd64
- ✅ Binary size acceptable (<100MB with bundled Python interpreter)
- ✅ All dependencies bundled (langchain, temporalio, etc.)

### Local Development
- ✅ `make build-agent-runner-binary` - Build binary locally for testing
- ✅ `make run-agent-runner-binary` - Test local binary
- ✅ Poetry still works for Python development workflow
- ✅ Can test entire flow locally without GitHub push

### Daemon Integration
- ✅ Daemon downloads correct binary for OS/arch
- ✅ Binary stored at `~/.stigmer/bin/agent-runner`
- ✅ Version checking and auto-update logic
- ✅ Daemon starts binary with `exec.Command()` (same as Temporal)
- ✅ Environment variables passed correctly (ANTHROPIC_API_KEY, etc.)

### User Experience
- ✅ `brew install stigmer` installs CLI with embedded version
- ✅ First `stigmer server start` downloads agent-runner binary automatically
- ✅ Subsequent starts use cached binary (fast)
- ✅ `stigmer server update` downloads latest binary
- ✅ **Zero Python installation required**
- ✅ Works on fresh machine with no Python

### CI/CD Automation
- ✅ Git tag push triggers GitHub Actions workflow
- ✅ Workflow builds binaries for all platforms (matrix build)
- ✅ Binaries uploaded to GitHub Releases or R2/S3
- ✅ Semantic versioning (v1.2.3)
- ✅ Automated Brew formula update on release

### Integration
- ✅ `stigmer server logs --all` shows agent-runner logs
- ✅ `stigmer server stop` properly terminates binary
- ✅ Binary communicates with Temporal correctly
- ✅ Graceful shutdown handling

## Key Workflows

### Workflow 1: Developer Building Locally
```bash
cd backend/services/agent-runner

# Build binary for current platform
make build-binary
# Creates: dist/agent-runner (or agent-runner.exe on Windows)

# Test locally
./dist/agent-runner
# Or let daemon use it
stigmer server start --use-local-binary
```

### Workflow 2: CI/CD Automated Release
```bash
# Developer creates release
git tag v1.2.3
git push origin v1.2.3

# GitHub Actions automatically:
# 1. Builds binaries for all platforms (Linux/Mac/Windows, amd64/arm64)
# 2. Uploads to releases.stigmer.ai/v1.2.3/{platform}-{arch}/agent-runner
# 3. Updates Brew formula with new version
```

### Workflow 3: User Installation (Brew)
```bash
# User installs from Brew
brew install stigmer

# First run
stigmer server start
# Daemon: "Downloading agent-runner v1.2.3 for darwin-arm64..."
# Daemon: "Starting agent-runner..."
# Daemon: "✓ All services running"

# Subsequent runs (fast, uses cached binary)
stigmer server start
# Daemon: "✓ All services running"
```

### Workflow 4: Manual Distribution Testing
```bash
# Build for specific platform
make build-binary PLATFORM=linux ARCH=amd64

# Upload to test bucket
make upload-binary VERSION=dev-test

# Test download from daemon
stigmer server start --version dev-test
```

## Architecture Comparison

### Before (Complex, Fragile)
```
User Machine:
├── stigmer-server (Go binary) ✅
├── temporal-cli (Downloaded binary) ✅
└── agent-runner
    ├── bash script (fragile)
    ├── Python 3.x (user must have)
    ├── Poetry (user must install)
    └── poetry install (network + dependencies)
```

### After (Consistent, Robust)
```
User Machine:
├── stigmer-server (Go binary) ✅
├── temporal-cli (Downloaded binary) ✅
└── agent-runner (Downloaded binary) ✅

~/.stigmer/bin/:
├── temporal → Downloads/temporal-v1.2.3
└── agent-runner → Downloads/agent-runner-v1.2.3
```

**Daemon manages TWO binaries with IDENTICAL logic.**

## Implementation Phases

### Phase 1: PyInstaller Setup & Optimization (Days 1-2) ✅ COMPLETE
- ✅ Install PyInstaller, create spec file
- ✅ Single-file executable configuration
- ✅ Optimize bundle size (exclude unnecessary packages)
- ✅ Test on current platform (macOS ARM64)
- ✅ Document binary size (59MB) and startup time
- **Validation Report**: `tasks/T01_VALIDATION_REPORT.md`

### Phase 2: Hybrid PyInstaller Embedding (Days 3-4) ✅ COMPLETE
- ✅ Embed PyInstaller binary in CLI (Go embed directive)
- ✅ Extract binary to `~/.stigmer/bin/` on first run
- ✅ Update GitHub workflow to build agent-runner binary
- ✅ Delete obsolete workflows (release.yml, build-agent-runner-binaries.yml)
- ✅ Update Python version to 3.13
- ✅ Create comprehensive documentation
- **Result**: 100MB CLI with zero Python dependency ✨

### Phase 2.5: BusyBox Pattern Refactoring (Days 5-6) ✅ COMPLETE
- ✅ Refactored stigmer-server to importable library (`pkg/server/server.go`)
- ✅ Refactored workflow-runner to importable library (`pkg/runner/runner.go`)
- ✅ Added hidden CLI commands (`internal-server`, `internal-workflow-runner`)
- ✅ Updated daemon to spawn CLI itself (BusyBox pattern)
- ✅ Eliminated Go runtime duplication (3 copies → 1 shared)
- ✅ Simplified embedded binaries (only agent-runner Python binary)
- **Result**: 126MB CLI (24MB smaller, 16% reduction) ✨

### Phase 2.75: Workflow Optimization (Day 7) ✅ COMPLETE
- ✅ Removed `STIGMER_AGENT_RUNNER_BIN` environment variable complexity
- ✅ Added version-based download fallback (uses CLI version for compatibility)
- ✅ Enhanced developer workflow (Makefile targets: `install-agent-runner`, `release-local-full`)
- ✅ Cleaned GitHub workflow (removed obsolete stigmer-server/workflow-runner builds)
- ✅ Removed Docker logic from agent-runner Makefile
- ✅ Standalone agent-runner binaries published to GitHub releases
- **Checkpoint**: `checkpoints/2026-01-21-workflow-optimization-complete.md`
- **Documentation**: `tasks/IMPLEMENTATION_SUMMARY.md`, `tasks/TESTING_CHECKLIST.md`
- **Result**: Clean, maintainable workflow with automatic recovery ✨

### Phase 3: Testing & Release (Days 8-14)
- End-to-end testing on all platforms
- Fresh machine testing (no Python installed)
- Brew formula update and testing
- Developer documentation:
  - Building binaries locally
  - PyInstaller configuration
  - Troubleshooting binary issues
- User documentation:
  - Installation guide
  - Troubleshooting (if binary doesn't start)
- Update ADR with final decisions

## Risks and Mitigations

### Risk 1: Binary Size
**Risk**: Python binaries with dependencies can be large (60-100MB)

**Mitigation**: 
- Acceptable for developer tools (Temporal binary is similar size)
- Optimize with PyInstaller excludes
- Use UPX compression if needed
- One-time download, cached locally

**Status**: ACCEPTED - 60-100MB is standard and acceptable

### Risk 2: Platform-Specific Build Issues
**Risk**: PyInstaller may have platform-specific quirks

**Mitigation**:
- Use GitHub Actions runners for native compilation
- Test on actual platforms (not cross-compilation)
- Document known issues in troubleshooting guide
- Community support for PyInstaller is strong

### Risk 3: Dependency Compatibility
**Risk**: Some Python packages may not work when frozen

**Mitigation**:
- Test thoroughly with all dependencies (langchain, temporalio)
- Use PyInstaller hooks for problematic packages
- agent-runner is relatively simple (no exotic dependencies)
- Many projects successfully bundle these packages

### Risk 4: Startup Time
**Risk**: Frozen Python binaries can have slower startup

**Mitigation**:
- Long-running process (started once, runs continuously)
- Startup time less critical than for CLI tools
- Optimize with PyInstaller options if needed
- Acceptable trade-off for zero dependencies

## Related Work

- **ADR**: `_cursor/adr-use-python-binary.md` - Decision rationale from Gemini conversation
- **Previous Project (obsolete)**: `_projects/2026-01/20260121.02.agent-runner-container-architecture/` - Docker approach (wrong direction)
- **Previous Project**: `_projects/2026-01/20260121.01.cli-embedded-binary-packaging/` - Related binary packaging work

## Design Decisions

See `design-decisions/` folder for detailed ADRs:
- PyInstaller vs alternatives (Nuitka, etc.)
- Single-file vs folder bundle
- Distribution strategy (R2 vs GitHub Releases)
- Version coordination between CLI and binary

## Notes

- This project supersedes the Docker container approach
- The key insight: **Don't manage Python environments, manage binaries**
- Pattern consistency with Temporal is the north star
- User should NEVER see "Python" in error messages or setup
