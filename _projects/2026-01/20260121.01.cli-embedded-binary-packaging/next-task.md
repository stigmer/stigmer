# Next Task: CLI Embedded Binary Packaging

**Project**: CLI Embedded Binary Packaging  
**Current Status**: ✅ COMPLETE (Ready for Testing)  
**Last Updated**: 2026-01-21

## 📍 Where We Are

**Task 4 completed + GitHub Actions workflow created!** Full CI/CD pipeline ready for releases.

**Completed:**
- ✅ Task 1: Design embedding strategy (platform detection, extraction logic, error handling)
- ✅ Task 2: Implement binary embedding with Go embed
- ✅ Task 3: Update daemon management to use extracted binaries
- ✅ Task 4: Update build scripts (Makefile + GitHub Actions)

**Task 4 extended implementation:**
- ✅ Makefile targets for local builds (`embed-binaries`, `release-local`)
- ✅ GitHub Actions workflow: `.github/workflows/release-embedded.yml`
- ✅ Platform-specific builds (darwin-arm64, darwin-amd64, linux-amd64)
- ✅ Automatic GitHub Releases with checksums
- ✅ Homebrew tap auto-update
- ✅ Release documentation: `client-apps/cli/RELEASE.md`

**Results:**
- **Local**: `make release-local` produces 123 MB CLI with embedded binaries
- **CI/CD**: Push tag → 3 platform builds → GitHub Release → Homebrew update
- **Distribution**: Single self-contained binary per platform
- **User experience**: `brew install stigmer` → just works!

## 🎯 Next Task: Task 5 - Audit & Clean (Optional)

**Status**: May already be complete! Task 3 removed all development fallbacks.

**Quick verification:**
1. **Check binary finders**: Ensure no development paths remain
2. **Verify `.gitignore`**: Binaries properly ignored ✅ (already done)
3. **Test dev mode**: Environment variables work correctly
4. **Documentation**: Code comments explain production vs dev mode

**Expected**: Likely no changes needed - Task 3 already cleaned everything.

## 🎯 Next Task: Task 6 - Final Testing & Documentation

**Goal**: Comprehensive end-to-end validation and polish.

**What to test:**
1. **Fresh install simulation**: Delete `~/.stigmer`, run `stigmer server`
2. **Version upgrade**: Change version, verify re-extraction
3. **All platforms**: Test on macOS (arm64/amd64) and Linux
4. **Dev mode**: Verify env vars work (`STIGMER_SERVER_BIN`, etc.)
5. **Binary size**: Measure and document final sizes
6. **Extraction performance**: Time first run vs subsequent runs

**What to document:**
1. Update main README with new distribution approach
2. Add "How It Works" section explaining embedding
3. Document troubleshooting steps
4. Create migration guide from old separate-binary approach

**Deliverable**: Production-ready system with comprehensive documentation.

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
