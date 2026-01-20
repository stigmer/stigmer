# Next Task: CLI Embedded Binary Packaging

**Project**: CLI Embedded Binary Packaging  
**Current Status**: 🚧 In Progress  
**Last Updated**: 2026-01-21

## 📍 Where We Are

**Task 2 completed!** Binary embedding infrastructure fully implemented and tested.

**Completed:**
- ✅ Task 1: Design embedding strategy (platform detection, extraction logic, error handling)
- ✅ Task 2: Implement binary embedding with Go embed

**Implementation highlights:**
- Created `client-apps/cli/embedded/` package with 3 core files
- Added embed directives for all 3 platforms (darwin_arm64, darwin_amd64, linux_amd64)
- Implemented version checking with `.version` file (prevents unnecessary re-extraction)
- Built extraction logic for both binaries and tarballs
- Code compiles successfully with placeholder binaries

## 🎯 Next Task: Task 3 - Update Daemon Management to Use Extracted Binaries

**Goal**: Modify daemon management code to use extracted binaries ONLY (no dev fallbacks).

**What to change:**
1. **Add extraction call**: Call `embedded.EnsureBinariesExtracted()` on daemon start
2. **Rewrite finders**: Update `findServerBinary()`, `findWorkflowRunnerBinary()`, `findAgentRunnerScript()`
3. **Remove fallbacks**: Delete all development path searches
4. **Add dev mode**: Support env vars (`STIGMER_SERVER_BIN`, etc.) for development

**Deliverable**: Daemon uses only extracted binaries, with clean error messages if missing.

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
> "Let's continue with Task 1 - design the embedding strategy"

Or jump to any task:
> "Let's work on Task 3 - updating daemon management"

## 📂 Project Files

- `README.md` - Full project overview and goals
- `tasks.md` - All 6 tasks with detailed breakdowns
- `notes.md` - Design decisions and learnings (populate as we go)
- `next-task.md` - **You are here!**

## 🚀 Ready to Start?

Say: **"Let's start with Task 1"** and we'll begin!
