# Next Task: CLI Embedded Binary Packaging

**Project**: CLI Embedded Binary Packaging  
**Current Status**: 🚧 In Progress  
**Last Updated**: 2026-01-21

## 📍 Where We Are

**Task 3 completed!** Daemon management now uses extracted binaries exclusively.

**Completed:**
- ✅ Task 1: Design embedding strategy (platform detection, extraction logic, error handling)
- ✅ Task 2: Implement binary embedding with Go embed
- ✅ Task 3: Update daemon management to use extracted binaries

**Task 3 implementation highlights:**
- Added `embedded.EnsureBinariesExtracted(dataDir)` call in daemon startup
- Rewrote `findServerBinary()` to use only `dataDir/bin/stigmer-server`
- Rewrote `findWorkflowRunnerBinary()` to use only `dataDir/bin/workflow-runner`
- Rewrote `findAgentRunnerScript()` to use only `dataDir/bin/agent-runner/run.sh`
- Removed ALL development fallback paths (no workspace root detection, no bazel paths)
- Removed `findWorkspaceRoot()` function (no longer needed)
- Added dev mode support via env vars (`STIGMER_SERVER_BIN`, `STIGMER_WORKFLOW_RUNNER_BIN`, `STIGMER_AGENT_RUNNER_SCRIPT`)
- Clear error messages guide users to reinstall if binaries missing
- Code compiles successfully

## 🎯 Next Task: Task 4 - Update Build Scripts (Makefile)

**Goal**: Add Makefile targets to build and embed binaries before CLI compilation.

**What to add:**
1. **Build targets**: Create targets for stigmer-server, workflow-runner, agent-runner
2. **Copy to embedded/**: Move built binaries to `client-apps/cli/embedded/binaries/{platform}/`
3. **Platform detection**: Build for correct platform (darwin_arm64, darwin_amd64, linux_amd64)
4. **Tarball creation**: Package agent-runner directory as tar.gz
5. **Update release-local**: Integrate embedding into main build flow

**Deliverable**: `make release-local` produces a CLI with all binaries embedded and ready to extract.

## 🔄 Quick Context

**The Problem:**
- Current CLI searches development paths (`~/bin/`, `backend/services/`, bazel output)
- This breaks Homebrew distribution (users don't have local builds)
- Version mismatches happen when rebuilding only one component

**The Solution:**
- Embed all 4 binaries in CLI at compile time
- Extract to `~/.stigmer/bin/` on first run
- Production code uses ONLY extracted binaries (NO FALLBACKS!)
- Dev mode via env vars: `STIGMER_SERVER_BIN`, `STIGMER_WORKFLOW_RUNNER_BIN`, etc.

**The Architecture:**
```
stigmer (CLI binary ~150 MB)
  ├── Embedded: stigmer-server, workflow-runner, agent-runner.tar.gz
  └── Extracts to: ~/.stigmer/bin/
```

## 📝 How to Resume

Drag this file into any chat and say:
> "Let's continue with Task 4 - updating the Makefile"

Or jump to any task:
> "Let's work on Task 4 - build script integration"

## 📂 Project Files

- `README.md` - Full project overview and goals
- `tasks.md` - All 6 tasks with detailed breakdowns
- `notes.md` - Design decisions and learnings (populate as we go)
- `next-task.md` - **You are here!**

## 🚀 Ready to Start?

Say: **"Let's start with Task 1"** and we'll begin!
