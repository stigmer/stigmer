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

**Last Updated**: 2026-01-27 (Session 1)
**Status**: Research Complete - Ready for Implementation
**Current Focus**: Ready to start Task 2 - Implement pkg/ignore package

### Session Progress (2026-01-27)

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

**Files Updated**:
- `tasks.md` - Refined with detailed implementation subtasks
- `notes.md` - Enhanced with deep research findings and ADRs
- `README.md` - Updated status to "Research Complete"

### Next Steps (When Ready to Implement)

1. **Start Task 2**: Create `pkg/ignore` package
   - Create package structure with BUILD.bazel
   - Implement defaults.go with built-in patterns
   - Implement parser.go for .stigmerignore file parsing
   - Implement ignore.go with Matcher interface
   - Add comprehensive tests

2. **Task 3**: Integrate with skill push
   - Modify `client-apps/cli/internal/cli/artifact/skill.go`
   - Replace hardcoded `shouldExclude()` with new Matcher
   - Test with real skill directories

3. **Task 4**: Tests and documentation

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

