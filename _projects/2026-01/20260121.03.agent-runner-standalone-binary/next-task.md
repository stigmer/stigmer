# Agent-Runner Standalone Binary - Resume Point

**To resume this project in any session, drag this file into chat.**

## Project Overview
Transform agent-runner into standalone PyInstaller binary, following Temporal's "download binary → run" pattern.

## Current Status
✅ **Phase 1 Complete** - PyInstaller binary build infrastructure ready  
✅ **Phase 2 Complete** - Hybrid PyInstaller embedding implemented  
✅ **Phase 2.5 Complete** - BusyBox pattern refactoring (24MB size reduction)  
✅ **Phase 2.75 Complete** - Workflow optimization (env vars, downloads, Makefiles)  
✅ **Build Infrastructure Fixed** - Bazel 8.0.0 pinned (was blocking all builds)  
🚀 **Phase 3 Ready** - Testing and release (unblocked, ready to proceed)

## Quick Links
- Project README: `_projects/2026-01/20260121.03.agent-runner-standalone-binary/README.md`
- Phase 1 Validation: `_projects/2026-01/20260121.03.agent-runner-standalone-binary/tasks/T01_VALIDATION_REPORT.md`
- Phase 2 Plan: `_projects/2026-01/20260121.03.agent-runner-standalone-binary/tasks/T02_0_plan.md`
- Phase 2 Testing Guide: `_projects/2026-01/20260121.03.agent-runner-standalone-binary/tasks/T02_TESTING_GUIDE.md`
- **Phase 2.75 Summary**: `_projects/2026-01/20260121.03.agent-runner-standalone-binary/tasks/IMPLEMENTATION_SUMMARY.md`
- **Build Fix Checkpoint**: `_projects/2026-01/20260121.03.agent-runner-standalone-binary/checkpoints/2026-01-21-build-infrastructure-fixed.md`
- ADR Reference: `_cursor/adr-use-python-binary.md`
- **Build Fix Details**: `_cursor/bazel-fix.md` | `_changelog/2026-01/2026-01-21-085212-fix-bazel-build-pin-version-8.md`

## What's Done

### Phase 1 (Complete ✅)
✅ PyInstaller installed and configured  
✅ Optimized spec file with hidden imports and excludes  
✅ Binary builds successfully: **59MB** single-file executable  
✅ All dependencies bundled (temporalio, langchain, grpc, etc.)  
✅ Makefile targets: `make build-binary`, `make test-binary`, `make clean-binary`  
✅ Validation report completed

### Phase 2 (Complete ✅)
✅ **Hybrid "Fat Binary" approach implemented**  
✅ Updated Go embed files (binary instead of tarball)  
✅ Simplified extraction logic (write binary vs unpack tarball)  
✅ Updated `release-embedded.yml` (builds PyInstaller binary)  
✅ Deleted obsolete workflows (`release.yml`, `build-agent-runner-binaries.yml`)  
✅ Python version updated to 3.13  
✅ Comprehensive documentation created  
✅ **Result**: 100MB CLI with zero Python dependency ✨

### Phase 2.5 (Complete ✅) - BusyBox Pattern Refactoring
✅ **Eliminated Go runtime duplication** (3 copies → 1 shared)  
✅ Refactored stigmer-server to importable library (`pkg/server/server.go`)  
✅ Refactored workflow-runner to importable library (`pkg/runner/runner.go`)  
✅ Added hidden CLI commands (`internal-server`, `internal-workflow-runner`)  
✅ Updated daemon to spawn CLI itself (BusyBox pattern)  
✅ Simplified embedded binaries (only agent-runner Python binary)  
✅ **Result**: 126MB CLI (24MB smaller, 16% reduction) ✨

### Phase 2.75 (Complete ✅) - Workflow Optimization
✅ **Removed env var complexity** (`STIGMER_AGENT_RUNNER_BIN`)  
✅ **Version-based download fallback** (uses CLI version for compatibility)  
✅ **Enhanced developer workflow** (Makefile targets: `install-agent-runner`, `release-local-full`)  
✅ **Cleaned GitHub workflow** (removed obsolete stigmer-server/workflow-runner builds)  
✅ **Removed Docker logic** from agent-runner Makefile  
✅ **Standalone agent-runner binaries** published to GitHub releases  
✅ **Result**: Clean, maintainable workflow with automatic recovery ✨

## Context for AI
This project implements PyInstaller-based standalone binary approach for agent-runner:
- **Goal**: Architecture consistency with Temporal (both are downloaded binaries)
- **Key Insight**: Don't manage Python environments, manage binaries
- **User Benefit**: Zero Python installation required
- **Timeline**: 2 weeks, 5 phases (Phase 2 of 5 in progress)

## Next Actions (Phase 3: Testing & Release)

### Immediate Testing (Local)
```bash
# 1. Build agent-runner binary (Python)
cd backend/services/agent-runner
make build-binary

# 2. Copy to embedded directory
mkdir -p ../../client-apps/cli/embedded/binaries/darwin_arm64
cp dist/agent-runner ../../client-apps/cli/embedded/binaries/darwin_arm64/

# 3. Build CLI (includes server + workflow-runner via BusyBox pattern)
cd ../../client-apps/cli
go build -o ../../bin/stigmer .

# 4. Test CLI
../../bin/stigmer server
# Should work WITHOUT Python! 🎉
# CLI now 126MB (includes all Go code in single binary)
```

**Note:** With BusyBox pattern, stigmer-server and workflow-runner are compiled INTO the CLI (not as separate binaries). Only agent-runner is embedded as a separate Python binary.

### CI Testing
1. Push changes to branch
2. Trigger `release-embedded.yml` workflow (manual or tag)
3. Verify builds for darwin-arm64, darwin-amd64, linux-amd64
4. Download and test artifacts

### Release
1. Tag `v2.0.0` when ready
2. Verify Homebrew formula update
3. Test full user flow: `brew install stigmer && stigmer server`
4. Celebrate zero Python dependency! 🎉

**Documentation**:
- Implementation details: `IMPLEMENTATION_COMPLETE.md`
- Hybrid approach: `HYBRID_APPROACH.md`
- Workflow analysis: `WORKFLOW_ANALYSIS.md`

## Related Context
- Previous (obsolete) Docker approach: `_projects/2026-01/20260121.02.agent-runner-container-architecture/`
- Gemini conversation insights captured in `_cursor/adr-use-python-binary.md`
