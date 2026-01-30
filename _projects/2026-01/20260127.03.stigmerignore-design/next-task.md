# Next Task: 20260127.03.stigmerignore-design

## 🎯 Quick Resume Instructions

**Simply drop this file into your conversation to quickly resume work on this project.**

All the context you need is right here with absolute paths to project files.

---

## Project Overview

**Name**: 20260127.03.stigmerignore-design  
**Description**: Design and implement a .stigmerignore file system for controlling which files are included when pushing skills and other artifacts  
**Goal**: Create a flexible, Git-inspired ignore system that respects .gitignore semantics while providing Stigmer-specific overrides  
**Tech Stack**: Go/Bazel  
**Components**: client-apps/cli/pkg/ignore, client-apps/cli/internal/cli/artifact

**Created**: 2026-01-27  
**Type**: ⚡ Quick Project (1-2 sessions)

---

## Project Location

**Project Root**: 
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.03.stigmerignore-design
```

---

## Essential Files

### 📋 Tasks (Check current progress here)
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.03.stigmerignore-design/tasks.md
```
All tasks are tracked in this single file. Check status and continue where you left off.

### 📖 Project README
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.03.stigmerignore-design/README.md
```
Project overview, goals, and success criteria.

### 📝 Quick Notes
```
/Users/suresh/scm/github.com/stigmer/stigmer/_projects/2026-01/20260127.03.stigmerignore-design/notes.md
```
Important decisions, learnings, and gotchas captured during development.

---

## Resume Checklist

When starting a new session, quickly review:

1. [ ] Open `tasks.md` and check current task status
2. [ ] Review any recent notes in `notes.md`
3. [ ] Continue with the current task or move to next

That's it! No complex structure - just focused work.

---

## Current Status

**Last Updated**: 2026-01-30 (Session 4 - Wrap-up)
**Status**: ✅ Task 4 Complete - Tests and Documentation
**Current Focus**: Ready for use! Task 5 (backend support) is optional/future work

### Session Progress (2026-01-30 - Session 4)

**Accomplishments**:
- ✅ **Created comprehensive integration tests** (`skill_test.go` - 25+ tests):
  - Basic skill creation and zip statistics
  - .gitignore pattern respect
  - .stigmerignore pattern application
  - Precedence: .stigmerignore overriding .gitignore with negation
  - Security defaults (60+ patterns protecting credentials)
  - CLI flags (--ignore, --include, --no-gitignore, --verbose)
  - Directory skipping optimization
  - Edge cases: empty files, invalid patterns, Unicode filenames, symlinks
  - Real-world scenarios: Python, Node.js, Go skills
- ✅ **Updated BUILD.bazel** with go_test target for artifact package
- ✅ **Created `.stigmerignore` reference documentation**:
  - Overview and quick start
  - Pattern syntax reference table
  - Precedence rules explanation
  - Security defaults documentation
  - CLI flags reference
  - Common scenarios (Python, Node.js, Go, full-stack)
  - Directory skipping behavior
  - Dry-run analysis guide
  - Best practices and troubleshooting
- ✅ **All tests passing** - Both ignore package (30+) and artifact package (25+) tests

**Files Created**:
- `client-apps/cli/internal/cli/artifact/skill_test.go` (650+ lines)
- `docs/guides/stigmerignore-reference.md` (comprehensive guide)

**Files Modified**:
- `client-apps/cli/internal/cli/artifact/BUILD.bazel` (added go_test)
- `_projects/2026-01/20260127.03.stigmerignore-design/tasks.md` (updated status)

### Session Progress (2026-01-30 - Session 3)

**Accomplishments**:
- ✅ **Completed full integration of pkg/ignore with skill push workflow**
- ✅ **Added production-grade structs to artifact package**:
  - `IgnoreOptions` - Comprehensive configuration for file filtering
  - `ZipStats` - Detailed statistics (files included/ignored, dirs skipped, size, source tracking)
  - `DryRunAnalysis` - Full analysis capability with pattern sources and samples
- ✅ **Refactored `createSkillZip()` with world-class implementation**:
  - Signature: `(sourceDir, zipWriter, opts) → (*ZipStats, error)`
  - Directory-level skipping with `filepath.SkipDir` for performance
  - Real-time statistics tracking during zip creation
  - Verbose mode showing INCLUDE/IGNORE/SKIP DIR decisions
- ✅ **Added 4 new CLI flags to skill push**:
  - `--ignore` (repeatable) - Additional patterns to ignore
  - `--include` (repeatable) - Force-include patterns (highest priority)
  - `--no-gitignore` - Disable .gitignore respect
  - `--verbose` - Show detailed ignore decisions
- ✅ **Enhanced dry-run with comprehensive analysis**:
  - Shows pattern sources and counts
  - Displays sample ignored/included files
  - Configuration summary
  - Estimated artifact size
- ✅ **Updated option structs throughout stack**:
  - `SkillArtifactOptions.Ignore` - Artifact layer
  - `SkillFromGitOptions.Ignore` - Git push variant
  - `skillPushOptions` - CLI layer (local)
  - `remotePushOptions` - CLI layer (remote)
- ✅ **Removed legacy `shouldExclude()` function** - Fully replaced with ignore.Matcher
- ✅ **All tests passing** - 30+ ignore package tests, artifact package builds clean
- ✅ **Zero linter errors** - Production-ready code

**Implementation Highlights**:
- **Directory-level optimization**: Skip entire trees when directory matches (critical for node_modules, .venv)
- **Statistics transparency**: Users see exactly what was included/excluded and why
- **Diagnostic capability**: MatchWithReason() integration for verbose output
- **Backward compatible**: Default behavior unchanged, all new flags optional
- **Layered precedence maintained**: defaults → .gitignore → .stigmerignore → CLI flags
- **Dry-run enhancement**: Full analysis without creating artifact

**Files Modified** (445 insertions, 116 deletions):
- `client-apps/cli/internal/cli/artifact/skill.go` (+330 lines)
  - Added IgnoreOptions, ZipStats, DryRunAnalysis structs
  - Refactored createSkillZip() with ignore.Matcher integration
  - Added AnalyzeDryRun() for dry-run analysis
  - Updated PushSkill() and PushSkillFromGit() to use ignore options
  - Removed legacy shouldExclude() function
- `client-apps/cli/cmd/stigmer/root/skill.go` (+114 lines)
  - Added 4 CLI flags (--ignore, --include, --no-gitignore, --verbose)
  - Updated skillPushOptions and remotePushOptions structs
  - Enhanced dry-run output with detailed analysis
  - Wired ignore options through to artifact layer
- `client-apps/cli/internal/cli/artifact/BUILD.bazel` (+1 line)
  - Added dependency: `//client-apps/cli/pkg/ignore`

**Key Decisions Made**:
1. **DefaultIgnoreOptions()** factory pattern for standard usage
2. **Statistics tracking** during zip creation (not after)
3. **Verbose output format**: Aligned with cliprint patterns (ℹ prefix)
4. **Dry-run analysis**: Separate function (AnalyzeDryRun) for reusability
5. **Option passing**: Via pointer to allow nil check for defaults

**Committed**: ✅ c50f77f - "feat(cli): integrate pkg/ignore with skill push workflow"

### Session Progress (2026-01-30 - Session 2)

**Accomplishments**:
- ✅ **Implemented complete `pkg/ignore` package** with production-grade quality
- ✅ **Added go-git dependency** to go.mod and configured Bazel MODULE
- ✅ **Created 7 source files** with comprehensive implementation:
  - `doc.go` - Package documentation with usage examples
  - `defaults.go` - 60+ security-first built-in patterns
  - `result.go` - MatchResult and Reason types for diagnostics
  - `pattern.go` - Path conversion and parsing helpers
  - `source.go` - Loaders for .gitignore, .stigmerignore, and CLI patterns
  - `matcher.go` - Core Matcher with New(), Match(), MatchWithReason()
  - `matcher_test.go` - 30+ comprehensive test cases
- ✅ **All tests passing** - Comprehensive coverage of patterns, precedence, edge cases
- ✅ **Zero linter errors** - Clean, production-ready code
- ✅ **Proper Bazel integration** - BUILD.bazel configured, gazelle run, module registered

**Implementation Highlights**:
- **Security defaults**: 60+ patterns protecting against credential leaks (.env, *.pem, *.key, etc.)
- **Layered precedence**: defaults → .gitignore → .stigmerignore → CLI flags (last wins)
- **Full gitignore syntax**: `**`, `!` negation, trailing `/`, comments via go-git library
- **Diagnostic capability**: MatchWithReason() returns source, pattern, reason for debugging
- **Two constructors**: New() for full control, NewWithDefaults() for standard usage
- **30+ test cases**: Validation, defaults, gitignore, stigmerignore, precedence, negation, edge cases

**Files Created**:
- `client-apps/cli/pkg/ignore/BUILD.bazel`
- `client-apps/cli/pkg/ignore/doc.go`
- `client-apps/cli/pkg/ignore/defaults.go`
- `client-apps/cli/pkg/ignore/result.go`
- `client-apps/cli/pkg/ignore/pattern.go`
- `client-apps/cli/pkg/ignore/source.go`
- `client-apps/cli/pkg/ignore/matcher.go`
- `client-apps/cli/pkg/ignore/matcher_test.go`

**Files Modified**:
- `MODULE.bazel` - Added com_github_go_git_go_git_v5 to use_repo
- `client-apps/cli/go.mod` - Added go-git v5.16.4 dependency
- `client-apps/cli/go.sum` - Updated checksums

### Session Progress (2026-01-27 - Session 1)

**Accomplishments**:
- ✅ Completed comprehensive research on Git, Docker, and Buf ignore implementations
- ✅ Documented architectural decisions (ADR-000 through ADR-004)
- ✅ Designed pkg/ignore package structure and API
- ✅ Selected go-git library for pattern matching
- ✅ Defined built-in default patterns for security
- ✅ Created detailed implementation roadmap in tasks.md
- ✅ Enhanced notes.md with deep research findings

**Key Decisions Made**:
1. **Client-side filtering** (industry standard - Git, Docker, Buf all do this)
2. **Shared library approach** (`pkg/ignore`) for both CLI and backend
3. **Precedence model**: Built-in defaults < `.gitignore` < `.stigmerignore` < CLI flags
4. **Git-compatible syntax** using `github.com/go-git/go-git/v5/plumbing/format/gitignore`
5. **Respect .gitignore by default** with override capability via `.stigmerignore`

### Next Steps (When Ready to Continue)

1. **Task 4**: Tests and documentation - ✅ COMPLETE
   - All integration tests created and passing
   - Documentation created at `docs/guides/stigmerignore-reference.md`

2. **Task 5**: Backend support (Future/Optional)
   - Modify backend skill push handler to apply ignore filtering
   - Test remote git push with .stigmerignore
   - Ensure consistent behavior between CLI and backend filtering

3. **Code Review** (Optional)
   - Review test coverage for any gaps
   - Validate documentation accuracy

### Context for Resume

**Research Summary**: All three industry tools (Git, Docker, Buf) use client-side filtering. Stigmer needs filtering in both CLI (local push) and backend (remote git push), hence the shared library approach.

**Pattern Matching**: Using go-git's wildmatch implementation (same as Git) ensures developers can use familiar syntax. Supports `**`, `!` negation, trailing `/` for directories, etc.

**Security-First**: Built-in defaults prevent accidental credential/secret inclusion (`.env`, `*.pem`, etc.)

**Gitignore Integration**: Users who already maintain `.gitignore` get automatic ignore behavior. `.stigmerignore` is only needed for Stigmer-specific overrides.

### Quick Data Flow

```
Local Push:  CLI filters → ZIP → Backend stores
Remote Push: Backend fetches → Backend filters → ZIP → Backend stores
```

Both paths use the same `pkg/ignore` library for consistency.

---

## Quick Commands

After loading this file into chat, you can say:

- **"Show current status"** - Get overview of all tasks and progress
- **"Continue with current task"** - Resume work on in-progress task
- **"What's next?"** - Move to next task
- **"Update task X to done"** - Mark a task complete
- **"Add a note"** - Capture a quick learning or decision
- **"Complete project"** - Final wrap-up when all tasks done

---

## Framework Benefits

Even with minimal overhead, you still get:
- ✅ Clear goal and structured tasks
- ✅ Progress tracking
- ✅ Context persistence across sessions
- ✅ Learning capture
- ✅ Quick resume (via this file!)

---

*Quick Project Framework: Minimal overhead, maximum focus. When structure helps, not hinders.*

